import { createServerFn } from '@tanstack/react-start'
import { hashJsonRecordTuple } from './json-record-token'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { coilRestorationEvents, dispatcherAcceptedWarnings, generatedDocumentWeldJoints, linePrograms, weldJointProgramStates, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ProgramChainState } from '@/lib/line-program-chain-state'
import { getCoilRestorationBlockReason } from '@/lib/coil-restoration'
import { programJointIdentity } from '@/lib/line-program-topology'
import { summarizeLineProgram } from '@/lib/line-program-overview'
import { calculateLineProgram } from '@/lib/line-program-calculation'
import { EARLY_COIL_DECISION_KIND, getEarlyCoilDecisionKey, parseEarlyCoilDecisionKey } from '@/lib/early-coil-decision'
import { buildCoilCorrectionChecklist } from '@/lib/coil-correction-checklist'
import { assertSecurityScope } from './security-functions'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { lockWeldLineMemberships, haveSameWeldLineMemberships } from './weld-line-membership-lock'
import { WELD_TABLE_RETURNING } from './weld-server-shared'
import { loadLineProgramRows, loadProgramSystemIndexSettings, toLineProgramRecord } from './line-program'
import { loadProgramApprovals } from './program-approval-lifecycle'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from './dispatcher-task-index-dirty'
import { lockAcceptedWarningWrites } from './accepted-warning-objects'
import { isClearedErroneousCoilRow } from '@/lib/early-coil-candidate'
import { revokeEarlyCoilDecisionInTransaction } from './early-coil-workflow'
import { loadControlProcessSettingsFromTransaction } from './control-process-settings'
import { attachHeatTreatmentControlRelations } from './heat-treatment-control-relations'
import { attachDuplicateControlRelations } from './duplicate-control-relations'

type Tx = SystemDocumentSequenceTransaction
const changedMessage = 'Цепочка или расчёт изменились. Повторно откройте проверку отмены катушки; ничего не изменено.'

function rootId(value: unknown) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Не передан исходный стык.')
  return id
}

/** Indexed ID traversal, including deleted intermediate nodes. UNION bounds cycles.
 * No full journal read and no per-node SQL calls. */
export async function loadCoilRestorationGraph(tx: Pick<Tx, 'execute'>, id: number) {
  const result = await tx.execute(sql`with recursive branch(id) as (
    select ${id}::integer
    union
    select s.weld_joint_id from weld_joint_program_states s join branch b
      on (s.coil_parent_id = b.id or s.physical_root_id = b.id or s.source_row_id = b.id)
      where s.weld_joint_id <> b.id
  ) select s.weld_joint_id as "weldJointId", s.kind, s.physical_root_id as "physicalRootId",
      s.source_row_id as "sourceRowId", s.coil_parent_id as "coilParentId", s.coil_side as "coilSide",
      s.replaced_by_coil as "replacedByCoil", s.replacement_coil_ids as "replacementCoilIds"
    from branch b join weld_joint_program_states s on s.weld_joint_id = b.id order by s.weld_joint_id`)
  return result.rows as ProgramChainState[]
}

async function readContext(tx: Tx, id: number) {
  const initialStates = await loadCoilRestorationGraph(tx, id)
  const initialIds = [...new Set([id, ...initialStates.map(state => state.weldJointId)])]
  const initial = await tx.select(WELD_TABLE_RETURNING).from(weldJoints).where(inArray(weldJoints.id, initialIds)).orderBy(asc(weldJoints.id))
  const reference = initial.find(row => row.id === id)
  if (!reference) throw new Error('Исходный стык больше не существует.')
  if (!String(reference.line ?? '').trim()) throw new Error('Сначала укажите линию исходного соединения.')
  await lockWeldLineMemberships(tx, initial)
  const states = await loadCoilRestorationGraph(tx, id)
  const ids = [...new Set([id, ...states.map(state => state.weldJointId)])]
  const live = await tx.select(WELD_TABLE_RETURNING).from(weldJoints).where(inArray(weldJoints.id, ids)).orderBy(asc(weldJoints.id)).for('update')
  if (!haveSameWeldLineMemberships(initial, live)) throw new Error(changedMessage)
  const root = live.find(row => row.id === id)!
  const identity = { projectTitle: String(root.projectTitle ?? ''), subtitleCode: String(root.subtitleCode ?? ''), line: String(root.line ?? '') }
  const rows = await loadLineProgramRows(tx, identity)
  const byId = new Map(rows.map(row => [row.id, row]))
  const outside = live.filter(row => !byId.has(row.id))
  if (outside.length) for (const row of await attachDuplicateControlRelations(await attachHeatTreatmentControlRelations(outside as WeldRow[], tx), tx)) byId.set(row.id, row)
  const branch = live.map(row => byId.get(row.id) ?? row as WeldRow)
  const settings = await loadProgramSystemIndexSettings(tx)
  const decisions = await loadProgramApprovals(tx, rows.map(row => row.id), { includeEarlyCoil: true })
  const approved = new Set(decisions.map(decision => decision.key))
  const [line] = root.lineProgramId == null ? [] : await tx.select().from(linePrograms).where(eq(linePrograms.id, root.lineProgramId))
  const program = line && programJointIdentity(line as unknown as WeldRow, '') === programJointIdentity(root, '')
    ? toLineProgramRecord(line) : { id: 0, ...identity,
      category: null, groupName: null, weldControlPercent: null, pvkControlPercent: null, configurationIssue: 'Программа не настроена', version: '' }
  const early = await tx.select().from(dispatcherAcceptedWarnings).where(and(
    eq(dispatcherAcceptedWarnings.kind, EARLY_COIL_DECISION_KIND),
    inArray(dispatcherAcceptedWarnings.key, ids.map(getEarlyCoilDecisionKey)),
  )).orderBy(asc(dispatcherAcceptedWarnings.key))
  const reason = getCoilRestorationBlockReason(byId.get(id) ?? root, branch, states, approved, settings, rows)
  const restored = rows.map(row => row.id === id && row.programChainState ? { ...row, programChainState: { ...row.programChainState, replacedByCoil: false } } : row)
  const calculate = (input: WeldRow[]) => program.weldControlPercent == null || program.pvkControlPercent == null || program.configurationIssue
    ? [] : calculateLineProgram(input, program.weldControlPercent, program.pvkControlPercent, settings, approved)
  const beforeCalc = calculate(rows), afterCalc = calculate(restored)
  const before = summarizeLineProgram(rows, program, approved, beforeCalc, settings)
  const after = summarizeLineProgram(restored, program, approved, afterCalc, settings)
  const stampValues = (groups: typeof beforeCalc) => new Map(groups.map(group => [group.stamp, {
    joints: group.rowIds.length, common: group.common.required, pvk: group.pvk.required, missing: group.common.missing + group.pvk.missing,
  }]))
  const oldStamps = stampValues(beforeCalc), newStamps = stampValues(afterCalc)
  const stampChanges = [...new Set([...oldStamps.keys(), ...newStamps.keys()])].flatMap(stamp => {
    const before = oldStamps.get(stamp) ?? { joints: 0, common: 0, pvk: 0, missing: 0 }
    const after = newStamps.get(stamp) ?? { joints: 0, common: 0, pvk: 0, missing: 0 }
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ stamp, before, after }]
  })
  const token = hashJsonRecordTuple([id, states, rows, live, settings, decisions, program, early])
  const documentLinks = await tx.select({ weldJointId: generatedDocumentWeldJoints.weldJointId }).from(generatedDocumentWeldJoints)
    .where(inArray(generatedDocumentWeldJoints.weldJointId, live.map(row => row.id)))
  const liveById = new Map(live.map(row => [row.id, row]))
  const checklist = buildCoilCorrectionChecklist(id, branch.map(row => ({ ...row, ...liveById.get(row.id) })), states,
    new Set(documentLinks.map(link => link.weldJointId)), early.flatMap(item => {
      const sourceId = parseEarlyCoilDecisionKey(item.key)?.sourceRowId
      return sourceId == null ? [] : [sourceId]
    }))
  return { root, early, states, live, rows, program, approved, settings, preview: { rootId: id, joint: String(root.joint ?? id), line: String(root.line ?? ''), reason, token,
    checklist,
    chain: branch.map(row => ({ id: row.id, joint: String(row.joint ?? row.id) })),
    before, after, stampChanges, cancelledEarlyDecisions: early.length } }
}

async function readEarlyCorrection(tx: Tx, sourceId: number) {
  const [state] = await tx.select().from(weldJointProgramStates).where(eq(weldJointProgramStates.weldJointId, sourceId))
  const id = state?.kind === 'repair' ? state.physicalRootId : sourceId
  if (!id) throw new Error('Не найдена сохранённая связь исходного соединения. Сначала исправьте историю цепочки.')
  const context = await readContext(tx, id)
  const decision = context.early.find(item => item.key === getEarlyCoilDecisionKey(sourceId))
  if (!decision) throw new Error('Досрочное решение уже отменено. Обновите данные; дальнейший шаг указан в диспетчере.')
  const targetStates = context.states.filter(item => item.kind === 'coil' && item.coilParentId === id)
  const targetIds = new Set(targetStates.map(item => item.weldJointId))
  const liveById = new Map(context.live.map(row => [row.id, row]))
  // The calculation projection intentionally omits some document fields. Check
  // and archive complete locked records, retaining attached history relations.
  const targets = context.rows.filter(row => targetIds.has(row.id)).map(row => ({ ...row, ...liveById.get(row.id) }))
  const children = new Map<number, number[]>()
  for (const item of context.states) for (const parent of new Set([item.sourceRowId, item.coilParentId, item.physicalRootId])) {
    if (parent == null || parent === item.weldJointId) continue
    const bucket = children.get(parent) ?? []; bucket.push(item.weldJointId); children.set(parent, bucket)
  }
  const descendantIds = new Set(targetIds), queue = [...targetIds]
  for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) ?? []) {
    if (!descendantIds.has(child)) { descendantIds.add(child); queue.push(child) }
  }
  const links = targets.length ? await tx.select({ weldJointId: generatedDocumentWeldJoints.weldJointId }).from(generatedDocumentWeldJoints)
    .where(inArray(generatedDocumentWeldJoints.weldJointId, targets.map(row => row.id))) : []
  const documented = new Set(links.map(item => item.weldJointId))
  let reason: string | null = null
  if (context.live.some(row => descendantIds.has(row.id) && !targets.some(target => target.id === row.id))) {
    reason = 'Сохранились перенесённые стороны или продолжения катушки. Сначала исправьте их документы и удалите продолжения, начиная с последнего.'
  } else if (targets.length !== 0 && (targets.length !== 2 || new Set(targets.map(row => row.programChainState?.coilSide)).size !== 2)) {
    reason = 'Пара катушки неполна или содержит дубли. Сначала восстановите обе стороны и устраните дубли по ДЗ.'
  } else {
    const used = targets.filter(row => !isClearedErroneousCoilRow(row, documented))
    if (used.length) reason = `Сначала удалите ошибочные документы, результаты/историю НК, ПСТО/ТВМТ и дату сварки у ${used.map(row => row.joint).join(', ')}. Назначения и отметка ожидания сами по себе не являются выполненным контролем.`
  }
  const remaining = context.rows.filter(row => !targetIds.has(row.id))
  const after = summarizeLineProgram(remaining, context.program, context.approved, undefined, context.settings)
  const token = hashJsonRecordTuple(['cancel-early', sourceId, context.preview.token, links])
  return { context, sourceId, targets, preview: { ...context.preview, operation: 'cancel-early' as const, reason, token, after, stampChanges: [],
    cancelledEarlyDecisions: 1, targetJoints: targets.map(row => String(row.joint ?? row.id)) } }
}

export async function previewEarlyCoilCorrectionInTransaction(tx: Tx, sourceId: number) {
  return (await readEarlyCorrection(tx, rootId(sourceId))).preview
}

export async function cancelErroneousEarlyCoilInTransaction(tx: Tx, input: CoilRestorationInput) {
  const id = rootId(input.rootId), actor = String(input.confirmedBy ?? '').trim()
  if (input.confirmedNotInstalled !== true || actor.length > 120 || !/^[a-f0-9]{64}$/.test(input.token)) throw new Error('Подтвердите, что катушка фактически не врезалась. Нужен актуальный предварительный расчёт.')
  await loadControlProcessSettingsFromTransaction(tx)
  await lockAcceptedWarningWrites(tx)
  // Serialize retries on the same source before looking up the immutable event.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'early-coil-correction:' + id}, 0))`)
  const [prior] = await tx.select().from(coilRestorationEvents).where(eq(coilRestorationEvents.token, input.token))
  if (prior && JSON.parse(prior.snapshot).earlySourceId === id) return { alreadyApplied: true }
  const { context, preview, targets } = await readEarlyCorrection(tx, id)
  if (preview.token !== input.token) throw new Error(changedMessage)
  if (preview.reason) throw new Error(preview.reason)
  await revokeEarlyCoilDecisionInTransaction(tx, getEarlyCoilDecisionKey(id), { allowEditedClearedRows: true })
  await tx.insert(coilRestorationEvents).values({ token: input.token, sourceWeldJointId: context.root.id, confirmedBy: actor,
    snapshot: JSON.stringify({ ...preview, earlySourceId: id, removedRows: targets, cancelledDecision: context.early.find(item => item.key === getEarlyCoilDecisionKey(id)), statement: 'Ошибочное досрочное решение отменено; физическое восстановление не подтверждалось' }) })
  return { alreadyApplied: false }
}

export const previewEarlyCoilCorrection = createServerFn({ method: 'POST' }).validator((data: { rootId: number }) => data).handler(async ({ data }) => {
  await assertSecurityScope('entry')
  return requireDb().transaction(tx => previewEarlyCoilCorrectionInTransaction(tx, data.rootId))
})
export const cancelErroneousEarlyCoil = createServerFn({ method: 'POST' }).validator((data: CoilRestorationInput) => data).handler(async ({ data }) => {
  await assertSecurityScope('settings'); await assertSecurityScope('delete')
  return requireDb().transaction(tx => cancelErroneousEarlyCoilInTransaction(tx, data))
})

export async function previewCoilRestorationInTransaction(tx: Tx, id: number) {
  return (await readContext(tx, rootId(id))).preview
}

export type CoilRestorationInput = { rootId: number; token: string; confirmedBy?: string; confirmedNotInstalled: boolean }
export async function restoreCoilInTransaction(tx: Tx, input: CoilRestorationInput) {
  const id = rootId(input.rootId)
  const confirmedBy = String(input.confirmedBy ?? '').trim()
  if (input.confirmedNotInstalled !== true || confirmedBy.length > 120 || !/^[a-f0-9]{64}$/.test(input.token)) {
    throw new Error('Подтвердите, что катушка фактически не врезалась. Нужен актуальный предварительный расчёт.')
  }
  const existing = async () => (await tx.select().from(coilRestorationEvents).where(eq(coilRestorationEvents.token, input.token)))[0]
  const prior = await existing()
  if (prior && prior.sourceWeldJointId === id) return { alreadyApplied: true }
  // Same parent-table → owner-row → dispatcher order as other decision writes.
  // A concurrent full index refresh may update final statuses on these rows.
  await lockAcceptedWarningWrites(tx)
  const context = await readContext(tx, id)
  // Another identical request may have committed while we waited for the line lock.
  const repeated = await existing()
  if (repeated && repeated.sourceWeldJointId === id) return { alreadyApplied: true }
  if (context.preview.token !== input.token) throw new Error(changedMessage)
  if (context.preview.reason) throw new Error(context.preview.reason)
  const changed = await tx.update(weldJointProgramStates).set({ replacedByCoil: false }).where(and(
    eq(weldJointProgramStates.weldJointId, id), eq(weldJointProgramStates.replacedByCoil, true),
  )).returning({ id: weldJointProgramStates.weldJointId })
  if (changed.length !== 1) throw new Error(changedMessage)
  await tx.update(weldJoints).set({ updatedAt: sql`greatest(now(), ${weldJoints.updatedAt} + interval '1 millisecond')` }).where(eq(weldJoints.id, id))
  if (context.early.length) await tx.delete(dispatcherAcceptedWarnings).where(inArray(dispatcherAcceptedWarnings.key, context.early.map(item => item.key)))
  await tx.insert(coilRestorationEvents).values({ token: input.token, sourceWeldJointId: id, confirmedBy,
    snapshot: JSON.stringify({ ...context.preview, statement: 'Катушка фактически не врезалась; исправлена ошибочная запись', cancelledDecisions: context.early }) })
  await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes([context.root], new Map([[id, context.root]])) })
  return { alreadyApplied: false }
}

export const previewCoilRestoration = createServerFn({ method: 'POST' }).validator((data: { rootId: number }) => data).handler(async ({ data }) => {
  await assertSecurityScope('entry')
  return requireDb().transaction(tx => previewCoilRestorationInTransaction(tx, data.rootId))
})
export const restoreErroneousCoil = createServerFn({ method: 'POST' }).validator((data: CoilRestorationInput) => data).handler(async ({ data }) => {
  await assertSecurityScope('edit')
  return requireDb().transaction(tx => restoreCoilInTransaction(tx, data))
})
export const getCoilRestorationHistory = createServerFn({ method: 'GET' }).validator((data: { rootId: number }) => data).handler(async ({ data }) => {
  await assertSecurityScope('entry')
  const rows = await requireDb().select().from(coilRestorationEvents).where(eq(coilRestorationEvents.sourceWeldJointId, rootId(data.rootId)))
    .orderBy(desc(coilRestorationEvents.confirmedAt)).limit(20)
  return rows.map(row => {
    let counts = 'История расчёта недоступна', operation = 'restore'
    try {
      const snapshot = JSON.parse(row.snapshot)
      if (snapshot.operation === 'cancel-early') operation = 'cancel-early'
      if (Number.isSafeInteger(snapshot.before?.joints) && Number.isSafeInteger(snapshot.after?.joints)) counts = `${snapshot.before.joints} → ${snapshot.after.joints} соединений`
    } catch { /* Keep the confirmation visible even if its snapshot is damaged. */ }
    return { confirmedAt: row.confirmedAt.toISOString(), confirmedBy: row.confirmedBy, counts, operation }
  })
})
