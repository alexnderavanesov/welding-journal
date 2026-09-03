import { and, or, sql } from 'drizzle-orm'

import { weldJoints, type WeldJoint } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { normalizeJointChainPart, parseJointChainName } from '@/lib/joint-chain'
import type {
  PstoWeldLineMoveDisposition,
  WeldChainLineMovePlan,
} from '@/lib/psto-line-assignment'
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
    decisions?: unknown
  }
  if (!Array.isArray(candidate.expectedRowIds) || !Array.isArray(candidate.decisions)) return null
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

  return { expectedRowIds, decisions }
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
  const conditions = [...identities.values()].map((row) => and(
    sql`btrim(coalesce(${weldJoints.projectTitle}, '')) = ${String(row.projectTitle ?? '').trim()}`,
    sql`btrim(coalesce(${weldJoints.subtitleCode}, '')) = ${String(row.subtitleCode ?? '').trim()}`,
    sql`btrim(coalesce(${weldJoints.line}, '')) = ${String(row.line ?? '').trim()}`,
  ))
  const scopeRows = conditions.length > 0
    ? await tx.select().from(weldJoints).where(or(...conditions))
    : []

  for (const { record, previous } of changedRows) {
    const sourceRows = scopeRows.filter((row) => getScopeKey(row) === getScopeKey(previous)) as WeldRow[]
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
  return [row.projectTitle, row.subtitleCode, row.line]
    .map(normalizeJointChainPart)
    .join('|')
}
