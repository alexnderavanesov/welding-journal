import { asc, sql } from 'drizzle-orm'

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
import { buildNumberArrayMatch, buildTextArrayMatch } from '@/server/weld-request-utils'
import { loadWeldWorkflowSettingsFromTransaction } from '@/server/weld-workflow-settings'

const MAX_OFFICIALITY_TARGETS = 1_000
export const LNK_OFFICIALITY_CHAIN_SELECT = {
  id: weldJoints.id,
  rowVersion: sql<string>`${weldJoints}.xmin::text`.as('row_version'),
  weldDate: weldJoints.weldDate,
  projectTitle: weldJoints.projectTitle,
  subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line,
  spool: weldJoints.spool,
  pstoRequired: weldJoints.pstoRequired,
  pstoControlBasis: weldJoints.pstoControlBasis,
  pstoCancellationDate: weldJoints.pstoCancellationDate,
  preHeatTreatmentLnkExempt: weldJoints.preHeatTreatmentLnkExempt,
  joint: weldJoints.joint,
  officiality: weldJoints.officiality,
  finalStatus: weldJoints.finalStatus,
  d1: weldJoints.d1,
  d2: weldJoints.d2,
  hasVik: weldJoints.hasVik,
  hasRk: weldJoints.hasRk,
  hasPvk: weldJoints.hasPvk,
  hasUzk: weldJoints.hasUzk,
  vikRequest: weldJoints.vikRequest,
  vikRequestDate: weldJoints.vikRequestDate,
  rkRequest: weldJoints.rkRequest,
  rkRequestDate: weldJoints.rkRequestDate,
  pvkRequest: weldJoints.pvkRequest,
  pvkRequestDate: weldJoints.pvkRequestDate,
  uzkRequest: weldJoints.uzkRequest,
  uzkRequestDate: weldJoints.uzkRequestDate,
  pstoRequest: weldJoints.pstoRequest,
  pstoRequestDate: weldJoints.pstoRequestDate,
  tvmtRequest: weldJoints.tvmtRequest,
  tvmtRequestDate: weldJoints.tvmtRequestDate,
  pstoDate: weldJoints.pstoDate,
  heatTreatmentDiagram: weldJoints.heatTreatmentDiagram,
  pstoResult: weldJoints.pstoResult,
  vikResult: weldJoints.vikResult,
  rkResult: weldJoints.rkResult,
  pvkResult: weldJoints.pvkResult,
  uzkResult: weldJoints.uzkResult,
  tvmtResult: weldJoints.tvmtResult,
  vikConclusionDate: weldJoints.vikConclusionDate,
  vikConclusion: weldJoints.vikConclusion,
  rkConclusionDate: weldJoints.rkConclusionDate,
  rkConclusion: weldJoints.rkConclusion,
  pvkConclusionDate: weldJoints.pvkConclusionDate,
  pvkConclusion: weldJoints.pvkConclusion,
  uzkConclusionDate: weldJoints.uzkConclusionDate,
  uzkConclusion: weldJoints.uzkConclusion,
  tvmtConclusionDate: weldJoints.tvmtConclusionDate,
  tvmtConclusion: weldJoints.tvmtConclusion,
  vikDefectDescription: weldJoints.vikDefectDescription,
  lnkDefectDescription: weldJoints.lnkDefectDescription,
  uzkDefectDescription: weldJoints.uzkDefectDescription,
  pvkDefectDescription: weldJoints.pvkDefectDescription,
  rkExposureConfirmedDiameter: weldJoints.rkExposureConfirmedDiameter,
  lnkNote: weldJoints.lnkNote,
} as const

export type LnkOfficialityChainRow = Partial<WeldRow> & {
  id: number
  rowVersion?: string
}

type HydratedWeldJoint = WeldJoint & WeldRow

export async function previewLnkOfficialityChange({
  data: input,
}: {
  data: LnkOfficialityChangeRequest
}): Promise<LnkOfficialityChainPlan> {
  const data = normalizeRequest(input)
  await assertSecurityScope('edit')
  return requireDb().transaction(async (tx) => {
    const targetRows = await loadTargetRows(tx, data)
    const scopeRows = await loadLineChainRows(tx, targetRows, false)
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
}

export async function applyLnkOfficialityChange({
  data: input,
}: {
  data: LnkOfficialityChangeRequest
}): Promise<LnkOfficialityChangeResult> {
  const data = normalizeRequest(input)
  await assertSecurityScope('edit')
  if (!data.expectedPlanKey) {
    throw new Error('Сначала необходимо проверить последствия изменения официальности.')
  }

  return requireDb().transaction(async (tx) => {
    const targetReferences = await loadTargetRows(tx, data)
    await lockWeldLineMemberships(tx, targetReferences)
    const scopeRows = await loadLineChainRows(tx, targetReferences, true)
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
    const fullAffectedRows = await loadFullRowsByIds(tx, plan.affectedRowIds, true)
    const fullAffectedRowsById = new Map(fullAffectedRows.map((row) => [row.id, row]))
    const officialityById = new Map(plan.officialityChanges.map((change) => [change.rowId, change.nextOfficiality]))
    const renameById = new Map(plan.renames.map((change) => [change.rowId, change.targetJoint]))
    for (const rowId of plan.affectedRowIds) {
      const previous = fullAffectedRowsById.get(rowId)
      const hydrated = fullAffectedRowsById.get(rowId)
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
    await insertEarlyCoilDecisions(tx, plan, recordsById, fullAffectedRowsById)
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
}

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
  const ids = data.targets.map((target) => target.id).sort((left, right) => left - right)
  const rows = await tx
    .select(LNK_OFFICIALITY_CHAIN_SELECT)
    .from(weldJoints)
    .where(buildNumberArrayMatch(weldJoints.id, ids))
    .orderBy(asc(weldJoints.id))
  if (rows.length !== ids.length) {
    throw new Error('Один или несколько выбранных стыков больше не существуют. Обновите отчет.')
  }
  const byId = new Map(rows.map((row) => [row.id, row]))
  return data.targets.map((target) => byId.get(target.id)!)
}

export function getLnkOfficialityChainSelectFieldKeysForTest() {
  return Object.keys(LNK_OFFICIALITY_CHAIN_SELECT)
}

export async function loadLnkOfficialityLineChainRowsForTest(
  tx: SystemDocumentSequenceTransaction,
  targetRows: readonly LnkOfficialityChainRow[],
  lock: boolean,
) {
  return loadLineChainRows(tx, targetRows, lock)
}

async function loadLineChainRows(
  tx: SystemDocumentSequenceTransaction,
  targetRows: readonly LnkOfficialityChainRow[],
  lock: boolean,
) {
  const identities = [...new Map(targetRows.map((row) => {
    const identity = normalizePstoLineIdentity(row)
    return [getPstoLineIdentityKey(identity), identity] as const
  })).values()]
  const projects = identities.map((identity) => normalizePstoLineIdentityPart(identity.projectTitle))
  const subtitles = identities.map((identity) => normalizePstoLineIdentityPart(identity.subtitleCode))
  const lines = identities.map((identity) => normalizePstoLineIdentityPart(identity.line))
  const query = tx
    .select(LNK_OFFICIALITY_CHAIN_SELECT)
    .from(weldJoints)
    .where(sql`exists (
      select 1
      from unnest(
        ${sql.param(projects)}::text[],
        ${sql.param(subtitles)}::text[],
        ${sql.param(lines)}::text[]
      ) as target(project_title, subtitle_code, line)
      where lower(btrim(coalesce(${weldJoints.projectTitle}, ''))) = target.project_title
        and lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))) = target.subtitle_code
        and lower(btrim(coalesce(${weldJoints.line}, ''))) = target.line
    )`)
    .orderBy(asc(weldJoints.id))
  return lock ? query.for('update') : query
}

function assertTargetsRemainInScope(
  targetRows: readonly LnkOfficialityChainRow[],
  scopeRows: readonly LnkOfficialityChainRow[],
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

async function hydrateRows(tx: SystemDocumentSequenceTransaction, rows: LnkOfficialityChainRow[]) {
  return attachDuplicateControlRelations(
    await attachHeatTreatmentControlRelations(rows as WeldRow[], tx),
    tx,
  ) as Promise<WeldRow[]>
}

async function loadFullRowsByIds(
  tx: SystemDocumentSequenceTransaction,
  rowIds: readonly number[],
  lock: boolean,
): Promise<HydratedWeldJoint[]> {
  const query = tx
    .select(WELD_TABLE_RETURNING)
    .from(weldJoints)
    .where(buildNumberArrayMatch(
      weldJoints.id,
      [...rowIds].sort((left, right) => left - right),
    ))
    .orderBy(asc(weldJoints.id))
  const rows: WeldJoint[] = lock ? await query.for('update') : await query
  return attachDuplicateControlRelations(
    await attachHeatTreatmentControlRelations(rows as WeldRow[], tx),
    tx,
  ) as Promise<HydratedWeldJoint[]>
}

async function loadEarlyCoilDecisionSourceRowIds(
  tx: SystemDocumentSequenceTransaction,
  rows: readonly { id: number }[],
  lock = false,
) {
  const keys = rows.map((row) => getEarlyCoilDecisionKey(row.id))
  if (keys.length === 0) return new Set<number>()
  const query = tx
    .select({ key: dispatcherAcceptedWarnings.key })
    .from(dispatcherAcceptedWarnings)
    .where(buildTextArrayMatch(dispatcherAcceptedWarnings.key, keys))
  const warnings = lock ? await query.for('update') : await query
  const storedKeys = warnings.map((warning) => warning.key)
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
