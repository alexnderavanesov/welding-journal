import { and, asc, inArray, or, sql } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'

import { requireDb } from '@/db'
import {
  dispatcherAcceptedWarnings,
  weldJoints,
  type WeldJoint,
} from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  EARLY_COIL_DECISION_KIND,
  getEarlyCoilDecisionKey,
  getEarlyCoilDecisionSourceRowIds,
} from '@/lib/early-coil-decision'
import {
  buildLnkOfficialityChainPlan,
  type LnkOfficialityChangeRequest,
  type LnkOfficialityChangeResult,
  type LnkOfficialityChainPlan,
} from '@/lib/lnk-officiality-chain-plan'
import {
  getPstoLineIdentityKey,
  normalizePstoLineIdentity,
  normalizePstoLineIdentityPart,
} from '@/lib/psto-line-assignment'
import type { WeldInput } from '@/lib/weld-fields'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { buildEarlyCoilDecisionContext } from '@/server/early-coil-workflow'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { assertSecurityScope } from '@/server/security-functions'
import {
  getDispatcherDirtyScopes,
  markDispatcherTaskIndexDirty,
} from '@/server/dispatcher-task-index-dirty'
import {
  assertEarlyCoilDecisionSourcesRemainValid,
  refreshEarlyCoilDecisionContextsInTransaction,
} from '@/server/early-coil-decision-guard'
import { syncSystemDocumentsForWeldChangesInTransaction } from '@/server/system-document-index'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import {
  updateWeldJointsInBatches,
  WELD_TABLE_RETURNING,
} from '@/server/weld-persistence'
import {
  loadServerWeldValidationContext,
  prepareServerWeldRecords,
  validateServerWeldRecords,
} from '@/server/weld-save-validation'
import { lockWeldLineMemberships } from '@/server/weld-line-membership-lock'
import { assertExpectedInteractiveWeldVersions } from '@/server/weld-row-version'
import { splitNumberBatches } from '@/server/weld-request-utils'
import { loadWeldWorkflowSettingsFromTransaction } from '@/server/weld-workflow-settings'

const MAX_OFFICIALITY_TARGETS = 1_000
const LINE_QUERY_BATCH_SIZE = 200

export const previewLnkOfficialityChange = createServerFn({ method: 'POST' })
  .validator(normalizeRequest)
  .handler(async ({ data }): Promise<LnkOfficialityChainPlan> => {
    await assertSecurityScope('edit')
    return requireDb().transaction(async (tx) => {
      const targetRows = await loadTargetRows(tx, data)
      const scopeRows = await loadLineRows(tx, targetRows, false)
      assertTargetsRemainInScope(targetRows, scopeRows)
      assertExpectedInteractiveWeldVersions(
        targetRows.map((row) => row.id),
        data.targets,
        targetRows,
      )
      const hydratedRows = await hydrateRows(tx, scopeRows)
      const settings = await loadWeldWorkflowSettingsFromTransaction(tx)
      const earlyCoilDecisionSourceRowIds = await loadEarlyCoilDecisionSourceRowIds(tx, scopeRows)
      return buildLnkOfficialityChainPlan(
        hydratedRows,
        data.targets.map((target) => target.id),
        data.officiality,
        {
          earlyCoilDecisionSourceRowIds,
          systemIndexSettings: settings.systemIndexSettings,
        },
      )
    })
  })

export const applyLnkOfficialityChange = createServerFn({ method: 'POST' })
  .validator(normalizeRequest)
  .handler(async ({ data }): Promise<LnkOfficialityChangeResult> => {
    await assertSecurityScope('edit')
    if (!data.expectedPlanKey) {
      throw new Error('Сначала необходимо проверить последствия изменения официальности.')
    }

    return requireDb().transaction(async (tx) => {
      const targetReferences = await loadTargetRows(tx, data)
      await lockWeldLineMemberships(tx, targetReferences)
      const scopeRows = await loadLineRows(tx, targetReferences, true)
      assertTargetsRemainInScope(targetReferences, scopeRows)
      const scopeRowsById = new Map(scopeRows.map((row) => [row.id, row]))
      const targetRows = data.targets.map((target) => scopeRowsById.get(target.id)!)
      assertExpectedInteractiveWeldVersions(
        targetRows.map((row) => row.id),
        data.targets,
        targetRows,
      )

      const hydratedRows = await hydrateRows(tx, scopeRows)
      const validationContext = await loadServerWeldValidationContext(tx, scopeRows)
      const earlyCoilDecisionSourceRowIds = await loadEarlyCoilDecisionSourceRowIds(tx, scopeRows, true)
      const plan = buildLnkOfficialityChainPlan(
        hydratedRows,
        data.targets.map((target) => target.id),
        data.officiality,
        {
          earlyCoilDecisionSourceRowIds,
          systemIndexSettings: validationContext.systemIndexSettings,
        },
      )
      if (plan.planKey !== data.expectedPlanKey) {
        throw new Error(
          'Последствия изменения официальности уже изменились. Ничего не сохранено. Проверьте свежую картину стыка.',
        )
      }

      const previousRows = new Map<number, WeldJoint>()
      const recordsById = new Map<number, WeldRow>()
      const hydratedRowsById = new Map(hydratedRows.map((row) => [row.id, row]))
      const officialityById = new Map(plan.officialityChanges.map((change) => [change.rowId, change.nextOfficiality]))
      const renameById = new Map(plan.renames.map((change) => [change.rowId, change.targetJoint]))
      for (const rowId of plan.affectedRowIds) {
        const previous = scopeRowsById.get(rowId)
        const hydrated = hydratedRowsById.get(rowId)
        if (!previous || !hydrated) {
          throw new Error('Один из затронутых стыков уже недоступен. Ничего не сохранено.')
        }
        previousRows.set(rowId, previous)
        const nextOfficiality = officialityById.get(rowId)
        recordsById.set(rowId, {
          ...hydrated,
          ...(nextOfficiality
            ? { officiality: nextOfficiality === 'unofficial' ? 'неофициальный' : null }
            : {}),
          ...(renameById.has(rowId) ? { joint: renameById.get(rowId)! } : {}),
        })
      }
      const records = [...recordsById.values()]
      const allowedJointRenameRowIds = new Set(plan.renames.map((change) => change.rowId))
      await assertEarlyCoilDecisionSourcesRemainValid(tx, records, previousRows, {
        allowedJointRenameRowIds,
      })
      prepareServerWeldRecords({
        records,
        previousRows,
        context: validationContext,
      })
      validateServerWeldRecords({
        records,
        previousRows,
        context: validationContext,
        allowSystemJointNames: true,
      })

      const savedRows = await updateWeldJointsInBatches(tx, records, previousRows)
      await syncSystemDocumentsForWeldChangesInTransaction(tx, savedRows, previousRows)
      await insertEarlyCoilDecisions(tx, plan, recordsById, hydratedRowsById)
      await refreshEarlyCoilDecisionContextsInTransaction(
        tx,
        savedRows,
        validationContext.systemIndexSettings,
      )
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes(records, previousRows),
      })

      return { plan, savedRows: savedRows as WeldRow[] }
    })
  })

function normalizeRequest(data: LnkOfficialityChangeRequest): LnkOfficialityChangeRequest {
  const targets = Array.isArray(data?.targets)
    ? data.targets.map((target) => ({
        id: Number(target?.id),
        version: String(target?.version ?? '').trim(),
      }))
    : []
  const officiality = data?.officiality === 'unofficial'
    ? 'unofficial'
    : data?.officiality === 'official'
      ? 'official'
      : null
  if (
    !officiality ||
    targets.length === 0 ||
    targets.length > MAX_OFFICIALITY_TARGETS ||
    new Set(targets.map((target) => target.id)).size !== targets.length ||
    targets.some((target) => !Number.isInteger(target.id) || target.id <= 0 || !target.version)
  ) {
    throw new Error('Некорректные данные изменения официальности.')
  }
  return {
    targets,
    officiality,
    expectedPlanKey: String(data?.expectedPlanKey ?? '').trim() || undefined,
  }
}

async function loadTargetRows(
  tx: SystemDocumentSequenceTransaction,
  data: LnkOfficialityChangeRequest,
) {
  const rows: WeldJoint[] = []
  const ids = data.targets.map((target) => target.id).sort((left, right) => left - right)
  for (const batch of splitNumberBatches(ids, 1_000)) {
    rows.push(...await tx
      .select(WELD_TABLE_RETURNING)
      .from(weldJoints)
      .where(inArray(weldJoints.id, batch))
      .orderBy(asc(weldJoints.id)))
  }
  if (rows.length !== ids.length) {
    throw new Error('Один или несколько выбранных стыков больше не существуют. Обновите отчет.')
  }
  const byId = new Map(rows.map((row) => [row.id, row]))
  return data.targets.map((target) => byId.get(target.id)!)
}

async function loadLineRows(
  tx: SystemDocumentSequenceTransaction,
  targetRows: readonly WeldJoint[],
  lock: boolean,
) {
  const identities = [...new Map(targetRows.map((row) => {
    const identity = normalizePstoLineIdentity(row)
    return [getPstoLineIdentityKey(identity), identity] as const
  })).values()]
  const rowsById = new Map<number, WeldJoint>()
  for (let offset = 0; offset < identities.length; offset += LINE_QUERY_BATCH_SIZE) {
    const clauses = identities.slice(offset, offset + LINE_QUERY_BATCH_SIZE).map((identity) => and(
      normalizedTextEquals(weldJoints.projectTitle, identity.projectTitle),
      normalizedTextEquals(weldJoints.subtitleCode, identity.subtitleCode),
      normalizedTextEquals(weldJoints.line, identity.line),
    ))
    const query = tx
      .select(WELD_TABLE_RETURNING)
      .from(weldJoints)
      .where(or(...clauses))
      .orderBy(asc(weldJoints.id))
    const rows = lock ? await query.for('update') : await query
    rows.forEach((row) => rowsById.set(row.id, row))
  }
  return [...rowsById.values()].sort((left, right) => left.id - right.id)
}

function assertTargetsRemainInScope(
  targetRows: readonly WeldJoint[],
  scopeRows: readonly WeldJoint[],
) {
  const scopeById = new Map(scopeRows.map((row) => [row.id, row]))
  const unchanged = targetRows.every((target) => {
    const current = scopeById.get(target.id)
    return current && getPstoLineIdentityKey(current) === getPstoLineIdentityKey(target)
  })
  if (!unchanged) {
    throw new Error(
      'Один или несколько стыков были перенесены на другую линию. Ничего не сохранено. Обновите отчет.',
    )
  }
}

async function hydrateRows(tx: SystemDocumentSequenceTransaction, rows: WeldJoint[]) {
  return attachDuplicateControlRelations(
    await attachHeatTreatmentControlRelations(rows as WeldRow[], tx),
    tx,
  ) as Promise<WeldRow[]>
}

async function loadEarlyCoilDecisionSourceRowIds(
  tx: SystemDocumentSequenceTransaction,
  rows: readonly WeldJoint[],
  lock = false,
) {
  const keys = rows.map((row) => getEarlyCoilDecisionKey(row.id))
  const storedKeys: string[] = []
  for (let offset = 0; offset < keys.length; offset += 1_000) {
    const batch = keys.slice(offset, offset + 1_000)
    if (batch.length === 0) continue
    const query = tx
      .select({ key: dispatcherAcceptedWarnings.key })
      .from(dispatcherAcceptedWarnings)
      .where(inArray(dispatcherAcceptedWarnings.key, batch))
    const warnings = lock ? await query.for('update') : await query
    storedKeys.push(...warnings.map((warning) => warning.key))
  }
  return getEarlyCoilDecisionSourceRowIds(storedKeys)
}

async function insertEarlyCoilDecisions(
  tx: SystemDocumentSequenceTransaction,
  plan: LnkOfficialityChainPlan,
  recordsById: ReadonlyMap<number, WeldRow>,
  storedRowsById: ReadonlyMap<number, WeldRow>,
) {
  if (plan.earlyCoilDecisions.length === 0) return
  const values = plan.earlyCoilDecisions.map((decision) => {
    const source = recordsById.get(decision.sourceRowId) ?? storedRowsById.get(decision.sourceRowId)
    if (!source) throw new Error('Не найдено основание сохраняемой досрочной катушки.')
    return {
      key: getEarlyCoilDecisionKey(decision.sourceRowId),
      kind: EARLY_COIL_DECISION_KIND,
      code: 'ДЗ-09',
      title: `Досрочная врезка катушки ${decision.targetJoints.join(' + ')}`,
      context: buildEarlyCoilDecisionContext(source, decision.sourceJoint, decision.targetJoints),
    }
  })
  const inserted = await tx
    .insert(dispatcherAcceptedWarnings)
    .values(values)
    .onConflictDoNothing()
    .returning({ key: dispatcherAcceptedWarnings.key })
  if (inserted.length !== values.length) {
    throw new Error('Решение по катушке уже изменилось. Ничего не сохранено. Обновите картину стыка.')
  }
}

function normalizedTextEquals(
  column: typeof weldJoints.projectTitle | typeof weldJoints.subtitleCode | typeof weldJoints.line,
  value: unknown,
) {
  return sql`lower(btrim(coalesce(${column}, ''))) = ${normalizePstoLineIdentityPart(value)}`
}
