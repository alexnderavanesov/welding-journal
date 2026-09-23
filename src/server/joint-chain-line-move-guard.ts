import { sql } from 'drizzle-orm'

import { weldJoints, type WeldJoint } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { normalizeJointChainPart, parseJointChainName } from '@/lib/joint-chain'
import { encodeIdentityKey } from '@/lib/identity-key'
import type {
  PstoWeldLineMoveDisposition,
  WeldChainLineMovePlan,
} from '@/lib/psto-line-assignment'
import { normalizePstoLineIdentityPart } from '@/lib/psto-line-assignment'
import { getJointChainRows } from '@/lib/repeated-joint-row-utils'
import type { SystemIndexSettings } from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'

const CHAIN_IDENTITY_FIELDS = ['projectTitle', 'subtitleCode', 'line', 'joint'] as const
const MAX_CHAIN_LINE_MOVE_ROWS = 1_000
const CHAIN_LINE_MOVE_DISPOSITIONS = new Set<PstoWeldLineMoveDisposition>([
  'keepPrimary',
  'movePrimaryToBeforeHeatTreatment',
  'deletePrimary',
  'promoteBeforeHeatTreatment',
])

export function normalizeWeldChainLineMovePlan(value: unknown): WeldChainLineMovePlan | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as {
    expectedRowIds?: unknown
    expectedVersions?: unknown
    decisions?: unknown
  }
  if (
    !Array.isArray(candidate.expectedRowIds) ||
    !Array.isArray(candidate.expectedVersions) ||
    !Array.isArray(candidate.decisions)
  ) return null
  if (
    candidate.expectedRowIds.length === 0 ||
    candidate.expectedRowIds.length > MAX_CHAIN_LINE_MOVE_ROWS ||
    candidate.decisions.length > candidate.expectedRowIds.length
  ) return null

  const expectedRowIds = candidate.expectedRowIds.map(Number)
  const expectedRowIdSet = new Set(expectedRowIds)
  if (
    expectedRowIdSet.size !== expectedRowIds.length ||
    expectedRowIds.some((rowId) => !Number.isInteger(rowId) || rowId <= 0)
  ) return null
  const expectedVersions = candidate.expectedVersions.map((entry) => {
    if (!entry || typeof entry !== 'object') return null
    const versionEntry = entry as { id?: unknown; version?: unknown }
    return {
      id: Number(versionEntry.id),
      version: String(versionEntry.version ?? '').trim(),
    }
  })
  if (
    expectedVersions.some((entry) => !entry) ||
    expectedVersions.length !== expectedRowIds.length ||
    new Set(expectedVersions.map((entry) => entry!.id)).size !== expectedVersions.length ||
    expectedVersions.some((entry) => (
      !entry || !expectedRowIdSet.has(entry.id) || !entry.version
    ))
  ) return null

  const decisions: WeldChainLineMovePlan['decisions'] = []
  const decisionRowIds = new Set<number>()
  for (const value of candidate.decisions) {
    if (!value || typeof value !== 'object') return null
    const decision = value as { rowId?: unknown; disposition?: unknown }
    const rowId = Number(decision.rowId)
    const disposition = String(decision.disposition ?? '') as PstoWeldLineMoveDisposition
    if (
      !Number.isInteger(rowId) ||
      !expectedRowIdSet.has(rowId) ||
      decisionRowIds.has(rowId) ||
      !CHAIN_LINE_MOVE_DISPOSITIONS.has(disposition)
    ) return null
    decisionRowIds.add(rowId)
    decisions.push({ rowId, disposition })
  }

  return {
    expectedRowIds,
    expectedVersions: expectedVersions as WeldChainLineMovePlan['expectedVersions'],
    decisions,
  }
}

export async function assertJointChainIdentityChangesUseDedicatedMove(
  tx: SystemDocumentSequenceTransaction,
  records: readonly WeldInput[],
  previousRows: ReadonlyMap<number, WeldJoint>,
  settings: SystemIndexSettings,
) {
  const changedRows = records.flatMap((record) => {
    const previous = previousRows.get(Number(record.id))
    return previous && hasChainIdentityChange(record, previous)
      ? [{ record, previous }]
      : []
  })
  if (changedRows.length === 0) return

  const identities = new Map<string, WeldInput>()
  for (const { previous } of changedRows) {
    const key = getScopeKey(previous)
    if (!identities.has(key)) identities.set(key, previous as unknown as WeldInput)
  }
  const identityRows = [...identities.values()]
  const scopeRows: WeldJoint[] = await tx
    .select()
    .from(weldJoints)
    .where(sql`exists (
      select 1
      from unnest(
        ${sql.param(identityRows.map((row) => normalizePstoLineIdentityPart(row.projectTitle)))}::text[],
        ${sql.param(identityRows.map((row) => normalizePstoLineIdentityPart(row.subtitleCode)))}::text[],
        ${sql.param(identityRows.map((row) => normalizePstoLineIdentityPart(row.line)))}::text[]
      ) as target(project_title, subtitle_code, line)
      where lower(btrim(coalesce(${weldJoints.projectTitle}, ''))) = target.project_title
        and lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))) = target.subtitle_code
        and lower(btrim(coalesce(${weldJoints.line}, ''))) = target.line
    )`)
  const scopeRowsByKey = new Map<string, WeldRow[]>()
  for (const row of scopeRows) {
    const key = getScopeKey(row)
    const rows = scopeRowsByKey.get(key)
    if (rows) rows.push(row as WeldRow)
    else scopeRowsByKey.set(key, [row as WeldRow])
  }

  for (const { record, previous } of changedRows) {
    const sourceRows = scopeRowsByKey.get(getScopeKey(previous)) ?? []
    const reason = getJointChainIdentityChangeBlockReason(
      record,
      previous as unknown as WeldRow,
      sourceRows,
      settings,
    )
    if (reason) throw new Error(reason)
  }
}

export function getJointChainIdentityChangeBlockReason(
  record: WeldInput,
  previous: WeldRow,
  sourceScopeRows: WeldRow[],
  settings: SystemIndexSettings,
) {
  const changedFields = CHAIN_IDENTITY_FIELDS.filter((fieldKey) => (
    normalizeJointChainPart(record[fieldKey]) !== normalizeJointChainPart(previous[fieldKey])
  ))
  if (changedFields.length === 0) return ''

  const parsed = parseJointChainName(String(previous.joint ?? ''), settings)
  const rootJoint = parsed.base || String(previous.joint ?? '').trim()
  const belongsToChain = parsed.segments.length > 0 ||
    getJointChainRows(sourceScopeRows, previous, settings).length > 1
  if (!belongsToChain) return ''

  const joint = String(previous.joint ?? '').trim() || `#${previous.id}`
  if (changedFields.every((fieldKey) => fieldKey === 'line')) {
    return `Линию цепочки ${rootJoint} нельзя менять обычным сохранением стыка ${joint}. ` +
      `Выполните перенос через карточку базового стыка ${rootJoint}: система перенесет все R/W/Y-стыки одной операцией.`
  }
  return `У цепочки ${rootJoint} нельзя отдельно изменять проект, шифр или номер стыка ${joint}. ` +
    `Для изменения линии используйте карточку базового стыка ${rootJoint}.`
}

function hasChainIdentityChange(record: WeldInput, previous: WeldJoint) {
  return CHAIN_IDENTITY_FIELDS.some((fieldKey) => (
    normalizeJointChainPart(record[fieldKey]) !== normalizeJointChainPart(previous[fieldKey])
  ))
}

function getScopeKey(row: WeldInput) {
  return encodeIdentityKey(
    [row.projectTitle, row.subtitleCode, row.line].map(normalizeJointChainPart),
  )
}
