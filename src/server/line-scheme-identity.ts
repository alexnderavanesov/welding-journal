import { and, sql } from 'drizzle-orm'
import { duplicateControls, lineSchemeMembers, lineSchemePhysicals, preHeatTreatmentControls, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { captureProgramChainStates, type ProgramChainState } from '@/lib/line-program-chain-state'
import { buildSchemePhysicalGroups, type SchemePhysicalGroup } from '@/lib/line-scheme-physical'
import { DEFAULT_SYSTEM_INDEX_SETTINGS, type SystemIndexSettings } from '@/lib/system-index-settings'
import { isUnofficialJoint } from '@/lib/joint-display'
import { programJointIdentity } from '@/lib/line-program-topology'
import { getPrimaryRejectedLnkResult } from '@/lib/repeated-joint-task-helpers'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { isActiveOfficialWeld } from '@/lib/control-assignment-eligibility'
import { compareJointChainRows } from '@/lib/repeated-joint-row-utils'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'

/** Canonical official namesakes need the source's rejection fact. Fetch only
 * missing evidence for live candidate pairs, never all control history. This
 * compact projection is not used for final-status calculation.
 */
export async function attachSchemeAliasEvidence(db: Pick<SystemDocumentSequenceTransaction, 'select'>, input: readonly WeldRow[]) {
  const officialNames = new Set(input.filter(row => !isUnofficialJoint(row)).map(row => programJointIdentity(row)))
  const candidates = input.filter(row => isUnofficialJoint(row) && officialNames.has(programJointIdentity(row)) && !getPrimaryRejectedLnkResult(row))
  if (!candidates.length) return [...input]
  const enriched = new Map(candidates.map(row => [row.id, { ...row }]))
  const missing = candidates.filter(row => ['vikResult', 'rkResult', 'uzkResult', 'pvkResult', 'hasVik', 'hasRk', 'hasUzk', 'hasPvk'].some(key => !(key in row)))
  if (missing.length) {
    const primary = await db.select({ id: weldJoints.id, vikResult: weldJoints.vikResult, rkResult: weldJoints.rkResult, uzkResult: weldJoints.uzkResult, pvkResult: weldJoints.pvkResult,
      hasVik: weldJoints.hasVik, hasRk: weldJoints.hasRk, hasUzk: weldJoints.hasUzk, hasPvk: weldJoints.hasPvk })
      .from(weldJoints).where(buildNumberArrayMatch(weldJoints.id, missing.map(row => row.id)))
    for (const row of primary) if (enriched.has(row.id)) Object.assign(enriched.get(row.id)!, row)
  }
  const pending = () => [...enriched.values()].filter(row => !getPrimaryRejectedLnkResult(row)).map(row => row.id)
  const preIds = pending()
  if (preIds.length) {
    const records = await db.select({ id: preHeatTreatmentControls.id, weldJointId: preHeatTreatmentControls.weldJointId, method: preHeatTreatmentControls.method, result: preHeatTreatmentControls.result })
      .from(preHeatTreatmentControls).where(and(buildNumberArrayMatch(preHeatTreatmentControls.weldJointId, preIds), sql`lower(btrim(${preHeatTreatmentControls.result})) in ('ремонт','вырез')`))
    for (const record of records) { const row = enriched.get(record.weldJointId); if (row) row.preHeatTreatmentControls = [...(row.preHeatTreatmentControls ?? []), record] }
  }
  const duplicateIds = pending()
  if (duplicateIds.length) {
    const records = await db.select({ id: duplicateControls.id, weldJointId: duplicateControls.weldJointId, method: duplicateControls.method, result: duplicateControls.result })
      .from(duplicateControls).where(and(buildNumberArrayMatch(duplicateControls.weldJointId, duplicateIds), sql`lower(btrim(${duplicateControls.result})) in ('ремонт','вырез')`))
    for (const record of records) {
      const row = enriched.get(record.weldJointId)
      if (row) row.duplicateControls = [...(row.duplicateControls ?? []), { ...record, method: record.method as DuplicateControlRecord['method'], result: record.result as DuplicateControlRecord['result'], controlDate: '', conclusion: '', conclusionDate: '' }]
    }
  }
  return input.map(row => enriched.get(row.id) ?? row)
}

export async function ensureSchemePhysicals(tx: SystemDocumentSequenceTransaction, input: SchemePhysicalGroup[], lineId: number) {
  const groups = [...new Map(input.map(group => [group.key, group])).values()]
  if (!groups.length) return new Map<string, number>()
  const seeds = groups.map(group => group.memberIds.reduce((min, id) => Math.min(min, id), group.rootId)).sort((a, b) => a - b)
  await tx.execute(sql`select pg_advisory_xact_lock(84192720, id) from unnest(${sql.param([...new Set(seeds)])}::integer[]) as locks(id) order by id`)
  const ids = [...new Set(groups.flatMap(group => group.memberIds))]
  const members = await tx.select().from(lineSchemeMembers).where(buildNumberArrayMatch(lineSchemeMembers.weldJointId, ids))
  const byNode = new Map(members.map(member => [member.weldJointId, member.physicalId])), result = new Map<string, number>()
  const pending: { group: SchemePhysicalGroup; seedNodeId: number }[] = []
  for (const group of groups) {
    const existing = new Set(group.memberIds.flatMap(id => byNode.has(id) ? [byNode.get(id)!] : []))
    if (existing.size > 1) throw new Error('Неоднозначная физическая связь стыка. Обновите состояния и проверьте историю.')
    if (existing.size) result.set(group.key, [...existing][0])
    else pending.push({ group, seedNodeId: group.memberIds.reduce((min, id) => Math.min(min, id), group.rootId) })
  }
  for (let offset = 0; offset < pending.length; offset += 1000) {
    const batch = pending.slice(offset, offset + 1000)
    const inserted = await tx.insert(lineSchemePhysicals).values(batch.map(({ group, seedNodeId }) => ({ seedNodeId, lastLabel: group.label, lastLineProgramId: lineId })))
      .returning({ id: lineSchemePhysicals.id, seed: lineSchemePhysicals.seedNodeId })
    const bySeed = new Map(inserted.map(row => [row.seed, row.id]))
    for (const item of batch) result.set(item.group.key, bySeed.get(item.seedNodeId)!)
  }
  const additions = new Map<number, number>()
  for (const group of groups) for (const node of group.memberIds) {
    const id = result.get(group.key)!
    if (additions.has(node) && additions.get(node) !== id) throw new Error('Физические истории пересекаются. Проверьте связи стыков.')
    additions.set(node, id)
  }
  const records = [...additions].map(([weldJointId, physicalId]) => ({ weldJointId, physicalId }))
  for (let offset = 0; offset < records.length; offset += 1000) await tx.insert(lineSchemeMembers).values(records.slice(offset, offset + 1000)).onConflictDoNothing()
  const assigned = await tx.select().from(lineSchemeMembers).where(buildNumberArrayMatch(lineSchemeMembers.weldJointId, ids))
  if (assigned.some(member => member.physicalId !== additions.get(member.weldJointId))) throw new Error('Связь стыка изменилась параллельно. Обновите схему и повторите сохранение.')
  return result
}

/** Called from existing structural transaction hooks. One mapping per journal
 * node; no query/update of points or archived PDFs. Officiality-only rebuilds
 * preserve memberships even when their computational root changes.
 */
export async function syncSchemePhysicalMembership(
  tx: SystemDocumentSequenceTransaction, rows: readonly WeldRow[],
  states: ReadonlyMap<number, ProgramChainState>, previous: ReadonlyMap<number, Partial<WeldRow> & { id: number }> = new Map(),
  settings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
) {
  const ids = new Set<number>(previous.keys())
  for (const row of rows) { ids.add(row.id); const root = states.get(row.id)?.physicalRootId; if (root) ids.add(root) }
  if (!ids.size) return
  const members = await tx.select().from(lineSchemeMembers).where(buildNumberArrayMatch(lineSchemeMembers.weldJointId, [...ids]))
  if (!members.length) return
  const known = new Map(members.map(member => [member.weldJointId, member.physicalId]))
  const contextual = await attachSchemeAliasEvidence(tx, rows.map(row => ({ ...row, programChainState: states.get(row.id) ?? row.programChainState })))
  const groups = buildSchemePhysicalGroups(contextual, settings, known, states)
  const additions: { weldJointId: number; physicalId: number }[] = []
  for (const group of groups) {
    if (!group.physicalId || group.issue) continue // Never guess or merge competing identities.
    for (const weldJointId of group.memberIds) {
      if (known.has(weldJointId)) continue
      additions.push({ weldJointId, physicalId: group.physicalId }); known.set(weldJointId, group.physicalId)
    }
  }
  for (let offset = 0; offset < additions.length; offset += 1000) await tx.insert(lineSchemeMembers).values(additions.slice(offset, offset + 1000)).onConflictDoNothing()
  if (additions.length) {
    const assigned = await tx.select().from(lineSchemeMembers).where(buildNumberArrayMatch(lineSchemeMembers.weldJointId, additions.map(row => row.weldJointId)))
    const owners = new Map(assigned.map(row => [row.weldJointId, row.physicalId]))
    if (additions.some(row => owners.get(row.weldJointId) !== row.physicalId)) throw new Error('Физическая связь стыка изменилась параллельно. Обновите данные и повторите действие.')
  }
  // Preserve the deleted current label, once per physical identity, in the
  // same transaction. Remaining live representatives override it when read.
  const currentIds = new Set(rows.map(row => row.id)), deleted = new Map<number, WeldRow[]>()
  for (const [id, row] of previous) if (!currentIds.has(id) && known.has(id)) {
    const physicalId = known.get(id)!, bucket = deleted.get(physicalId) ?? []
    bucket.push(row as WeldRow); deleted.set(physicalId, bucket)
  }
  const beforeStates = deleted.size ? captureProgramChainStates([...previous.values()] as WeldRow[], settings) : new Map<number, ProgramChainState>()
  const tombstones = [...deleted].map(([id, candidates]) => {
    const predecessors = new Set(candidates.flatMap(row => { const source = beforeStates.get(row.id)?.sourceRowId; return source == null ? [] : [source] }))
    const active = candidates.filter(isActiveOfficialWeld), eligible = active.length ? active : candidates
    const leaves = eligible.filter(row => !predecessors.has(row.id))
    // The stable edges select the last representative even if imported IDs or
    // renamed numbers are out of order. Canonical order resolves legacy ties.
    const row = (leaves.length ? leaves : eligible).sort((a, b) => compareJointChainRows(a, b, settings)).at(-1)!
    return [id, row] as const
  })
  for (let offset = 0; offset < tombstones.length; offset += 1000) {
    const values = tombstones.slice(offset, offset + 1000).map(([id, row]) => sql`(${id}::integer, ${String(row.joint ?? `#${row.id}`)}::text, ${row.lineProgramId ?? null}::integer)`)
    await tx.execute(sql`update ${lineSchemePhysicals} as p set last_label=v.label, last_line_program_id=v.line_id from (values ${sql.join(values, sql`, `)}) as v(id,label,line_id) where p.id=v.id`)
  }
}
