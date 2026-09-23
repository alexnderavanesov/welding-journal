import { eq, sql } from 'drizzle-orm'

import type { requireDb } from '@/db'
import {
  appSettings,
  dispatcherAcceptedWarnings,
  weldJoints,
  type WeldJoint,
} from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  EARLY_COIL_DECISION_KIND,
  getEarlyCoilDecisionKey,
  parseEarlyCoilDecisionKey,
} from '@/lib/early-coil-decision'
import { isUnofficialJoint } from '@/lib/joint-display'
import {
  getCoilJointNames,
  normalizeJointChainPart,
  parseRepeatedJointName,
} from '@/lib/joint-chain'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { getPrimaryRejectedLnkResult } from '@/lib/repeated-joint-task-helpers'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  normalizeSystemIndexSettings,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { buildNumberArrayMatch, buildTextArrayMatch } from '@/server/weld-request-utils'

type GuardTransaction = SystemDocumentSequenceTransaction
type GuardReadClient = Pick<ReturnType<typeof requireDb>, 'select'>

const IDENTITY_FIELDS = ['projectTitle', 'subtitleCode', 'line', 'joint'] as const

export function getEarlyCoilDecisionInvalidationReason(
  record: WeldInput,
  previous: WeldInput,
  options: { allowJointRename?: boolean; allowLineMove?: boolean } = {},
) {
  const changedIdentityFields = getChangedIdentityFields(record, previous)
  if (
    changedIdentityFields.length > 0 &&
    !(
      (options.allowLineMove && changedIdentityFields.every((fieldKey) => fieldKey === 'line')) ||
      (options.allowJointRename && changedIdentityFields.every((fieldKey) => fieldKey === 'joint'))
    )
  ) {
    return 'нельзя изменить проект, шифр, линию или номер исходного стыка'
  }
  if (isUnofficialJoint(record)) return 'исходный стык должен оставаться официальным'
  if (!getPrimaryRejectedLnkResult(record)) {
    return 'у исходного стыка должен оставаться хотя бы один результат «ремонт» или «вырез»'
  }
  return null
}

export async function assertEarlyCoilDecisionSourcesRemainValid(
  tx: GuardTransaction,
  records: readonly WeldInput[],
  previousRows: ReadonlyMap<number, WeldJoint>,
  options: {
    allowedJointRenameRowIds?: ReadonlySet<number>
    allowedLineMoveRowIds?: ReadonlySet<number>
  } = {},
) {
  const recordsById = new Map(records.flatMap((record) => {
    const id = Math.floor(Number(record.id))
    return id > 0 ? [[id, record] as const] : []
  }))
  const protectedSourceIds = await loadProtectedSourceIds(tx, [...recordsById.keys()])
  for (const sourceRowId of protectedSourceIds) {
    const record = recordsById.get(sourceRowId)
    const previous = previousRows.get(sourceRowId)
    if (!record || !previous) continue
    const reason = getEarlyCoilDecisionInvalidationReason(
      record,
      previous as unknown as WeldInput,
      {
        allowJointRename: options.allowedJointRenameRowIds?.has(sourceRowId) === true,
        allowLineMove: options.allowedLineMoveRowIds?.has(sourceRowId) === true,
      },
    )
    if (reason) throw buildGuardError(previous, reason)
  }

  const identityChanges = [...previousRows.values()].filter((previous) => {
    const record = recordsById.get(previous.id)
    return Boolean(record && hasIdentityChanged(record, previous))
  })
  if (identityChanges.length === 0) return
  const activeDecisions = await loadActiveEarlyCoilDecisions(tx)
  for (const previous of identityChanges) {
    const record = recordsById.get(previous.id)
    if (
      record &&
      (
        (options.allowedLineMoveRowIds?.has(previous.id) &&
          getChangedIdentityFields(record, previous).every((fieldKey) => fieldKey === 'line')) ||
        (options.allowedJointRenameRowIds?.has(previous.id) &&
          getChangedIdentityFields(record, previous).every((fieldKey) => fieldKey === 'joint'))
      )
    ) continue
    const source = getEarlyCoilDecisionTargetSource(previous, activeDecisions)
    if (source) throw buildTargetGuardError(previous, source, 'нельзя изменить проект, шифр, линию или номер стыка')
  }
}

export async function refreshEarlyCoilDecisionContextsInTransaction(
  tx: GuardTransaction,
  rows: readonly WeldInput[],
  settings: SystemIndexSettings,
) {
  const rowsById = new Map(rows.flatMap((row) => {
    const id = Number(row.id)
    return Number.isInteger(id) && id > 0 ? [[id, row] as const] : []
  }))
  if (rowsById.size === 0) return
  const warnings = await loadAcceptedWarningsByKeys(
    tx,
    [...rowsById.keys()].map(getEarlyCoilDecisionKey),
  )

  const updates = warnings.flatMap((warning) => {
    const parsed = parseEarlyCoilDecisionKey(warning.key)
    const source = parsed ? rowsById.get(parsed.sourceRowId) : undefined
    if (!source) return []
    const sourceJoint = String(source.joint ?? '').trim()
    const sourceBranch = parseRepeatedJointName(sourceJoint, settings).base
    const targetJoints = getCoilJointNames(sourceBranch, settings)
    return [{
      key: warning.key,
      title: `Досрочная врезка катушки ${targetJoints.join(' + ')}`,
      context: buildDecisionContext(source, sourceJoint, targetJoints),
    }]
  })
  if (updates.length > 0) {
    await tx.execute(sql`
      update ${dispatcherAcceptedWarnings} as "target"
      set
        "title" = "changes"."title",
        "context" = "changes"."context"
      from unnest(
        ${sql.param(updates.map((update) => update.key))}::text[],
        ${sql.param(updates.map((update) => update.title))}::text[],
        ${sql.param(updates.map((update) => update.context))}::text[]
      ) as "changes"("key", "title", "context")
      where "target"."key" = "changes"."key"
    `)
  }
}

export async function hasActiveEarlyCoilDecisionForSource(
  tx: GuardReadClient,
  sourceRowId: number,
) {
  return (await loadProtectedSourceIds(tx, [sourceRowId])).has(sourceRowId)
}

export async function assertStoredEarlyCoilDecisionSourcesRemainValid(
  tx: GuardTransaction,
  sourceRowIds: readonly number[],
) {
  const ids = uniqueIds(sourceRowIds)
  const protectedSourceIds = await loadProtectedSourceIds(tx, ids)
  if (protectedSourceIds.size === 0) return
  const rows: WeldJoint[] = await tx
    .select()
    .from(weldJoints)
    .where(buildNumberArrayMatch(
      weldJoints.id,
      [...protectedSourceIds].sort((left, right) => left - right),
    ))
    .orderBy(weldJoints.id)
    .for('update')
  const hydratedRows = await attachDuplicateControlRelations(
    await attachHeatTreatmentControlRelations(rows as WeldRow[], tx),
    tx,
  )
  for (const row of hydratedRows) {
    const reason = getEarlyCoilDecisionInvalidationReason(row, row)
    if (reason) throw buildGuardError(row as unknown as WeldJoint, reason)
  }
}

export async function assertEarlyCoilDecisionRowsCanBeDeleted(
  tx: GuardTransaction,
  rows: readonly WeldJoint[],
) {
  const sourceRowIds = rows.map((row) => row.id)
  const protectedSourceIds = await loadProtectedSourceIds(tx, sourceRowIds)
  if (protectedSourceIds.size > 0) {
    const source = rows.find((row) => protectedSourceIds.has(row.id))
    throw buildGuardError(source, 'исходный стык нельзя удалить')
  }

  const activeDecisions = await loadActiveEarlyCoilDecisions(tx)
  for (const row of rows) {
    const source = getEarlyCoilDecisionTargetSource(row, activeDecisions)
    if (source) {
      throw buildTargetGuardError(
        row,
        source,
        'нельзя удалить отдельно или вместе с парным стыком обычным действием',
      )
    }
  }
}

export type ActiveEarlyCoilDecision = {
  source: WeldInput
  settings: SystemIndexSettings
}

export function getEarlyCoilDecisionTargetSource(
  row: WeldInput,
  decisions: readonly ActiveEarlyCoilDecision[],
) {
  return decisions.find(({ source, settings }) => {
    if (!hasSameScope(row, source)) return false
    const sourceBranch = parseRepeatedJointName(String(source.joint ?? ''), settings).base
    const targetJoints = getCoilJointNames(sourceBranch, settings)
      .map(normalizeJointChainPart)
    return targetJoints.includes(normalizeJointChainPart(row.joint))
  })?.source ?? null
}

async function loadProtectedSourceIds(tx: GuardReadClient, sourceRowIds: readonly number[]) {
  const ids = uniqueIds(sourceRowIds)
  if (ids.length === 0) return new Set<number>()
  const warnings = await loadAcceptedWarningsByKeys(tx, ids.map(getEarlyCoilDecisionKey))
  return new Set(warnings.flatMap((warning) => {
    const parsed = parseEarlyCoilDecisionKey(warning.key)
    return parsed ? [parsed.sourceRowId] : []
  }))
}

function buildGuardError(source: WeldJoint | undefined, reason: string) {
  const joint = String(source?.joint ?? '').trim() || 'без номера'
  return new Error(
    `Стык ${joint} является основанием принятого решения о досрочной катушке: ${reason}. ` +
    'Сначала отмените решение в «Настройки -> Принятые исключения».',
  )
}

function buildTargetGuardError(target: WeldInput, source: WeldInput, reason: string) {
  const targetJoint = String(target.joint ?? '').trim() || 'без номера'
  const sourceJoint = String(source.joint ?? '').trim() || 'без номера'
  return new Error(
    `Стык ${targetJoint} создан принятым решением о досрочной катушке от ${sourceJoint}: ${reason}. ` +
    'Сначала отмените решение в «Настройки -> Принятые исключения».',
  )
}

async function loadActiveEarlyCoilDecisions(tx: GuardTransaction): Promise<ActiveEarlyCoilDecision[]> {
  const warnings = await tx
    .select({ key: dispatcherAcceptedWarnings.key })
    .from(dispatcherAcceptedWarnings)
    .where(eq(dispatcherAcceptedWarnings.kind, EARLY_COIL_DECISION_KIND))
  const sourceIds = [...new Set(warnings.flatMap((warning) => {
    const parsed = parseEarlyCoilDecisionKey(warning.key)
    return parsed ? [parsed.sourceRowId] : []
  }))]
  if (sourceIds.length === 0) return []
  const sources: WeldJoint[] = await tx
    .select()
    .from(weldJoints)
    .where(buildNumberArrayMatch(weldJoints.id, sourceIds))
  const [setting] = await tx
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.systemIndex))
    .limit(1)
  const settings = normalizeSystemIndexSettings(
    parseStoredValue(setting?.value) ?? DEFAULT_SYSTEM_INDEX_SETTINGS,
  )
  return sources.map((source) => ({ source, settings }))
}

function hasIdentityChanged(record: WeldInput, previous: WeldInput) {
  return getChangedIdentityFields(record, previous).length > 0
}

function getChangedIdentityFields(record: WeldInput, previous: WeldInput) {
  return IDENTITY_FIELDS.filter(
    (fieldKey) => normalizeJointChainPart(record[fieldKey]) !== normalizeJointChainPart(previous[fieldKey]),
  )
}

function hasSameScope(left: WeldInput, right: WeldInput) {
  return (
    normalizeJointChainPart(left.projectTitle) === normalizeJointChainPart(right.projectTitle) &&
    normalizeJointChainPart(left.subtitleCode) === normalizeJointChainPart(right.subtitleCode) &&
    normalizeJointChainPart(left.line) === normalizeJointChainPart(right.line)
  )
}

function buildDecisionContext(
  row: WeldInput,
  sourceJoint: string,
  targetJoints: readonly string[],
) {
  return [
    row.projectTitle ? `Проект: ${row.projectTitle}` : '',
    row.subtitleCode ? `Шифр: ${row.subtitleCode}` : '',
    row.line ? `Линия: ${row.line}` : '',
    `Исходный стык: ${sourceJoint}`,
    `Катушка: ${targetJoints.join(' + ')}`,
  ].filter(Boolean).join(' · ')
}

function parseStoredValue(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function uniqueIds(values: readonly number[]) {
  return [...new Set(values.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
}

async function loadAcceptedWarningsByKeys(
  tx: GuardReadClient,
  keys: readonly string[],
) {
  if (keys.length === 0) return []
  return tx
    .select({ key: dispatcherAcceptedWarnings.key })
    .from(dispatcherAcceptedWarnings)
    .where(buildTextArrayMatch(dispatcherAcceptedWarnings.key, keys))
}
