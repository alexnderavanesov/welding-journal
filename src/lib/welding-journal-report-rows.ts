import { LNK_METHODS } from '@/lib/lnk-report-config'
import {
  formatRepeatedJointName,
  normalizeJointChainPart,
  parseRepeatedJointName,
} from '@/lib/joint-chain'
import { isUnofficialJoint } from '@/lib/joint-display'
import { encodeIdentityKey } from '@/lib/identity-key'
import { hasWeldDate } from '@/lib/report-value-utils'
import {
  getExpectedRepeatedJointName,
  getPrimaryRejectedLnkResult,
} from '@/lib/repeated-joint-task-helpers'
import { buildFinalStatusRowsContext, calculateFinalStatusInRows, normalizeFinalStatus, type WeldInput } from '@/lib/weld-fields'

type WeldingJournalStatusFilter =
  | 'ожидает сварку'
  | 'ожидает заявку'
  | 'ожидает НК'
  | 'ожидает ремонт'

export function buildWeldingJournalRows(rows: WeldInput[]) {
  const finalStatusContext = buildFinalStatusRowsContext(rows)
  return rows.map((row) => ({ ...row, finalStatus: calculateFinalStatusInRows(row, rows, finalStatusContext) }))
}

export function buildWeldingJournalRowsByStatus(rows: WeldInput[], status: WeldingJournalStatusFilter) {
  return buildWeldingJournalRows(rows).filter((row) => normalizeFinalStatus(row.finalStatus) === status)
}

export function buildWeldingJournalWaitingRepairRows(rows: WeldInput[]) {
  const journalRows = buildWeldingJournalRows(rows).map((row, index) => (
    normalizeFinalStatus(rows[index]?.finalStatus) === 'ожидает ремонт'
      ? { ...row, finalStatus: 'ожидает ремонт' }
      : row
  ))
  const previousRejectedSourceLookup = buildPreviousRejectedSourceLookup(journalRows)
  return journalRows.flatMap((row) => {
    const sourceRow = findPreviousRejectedSourceRow(previousRejectedSourceLookup, row)
    const isWaitingRepair = normalizeFinalStatus(row.finalStatus) === 'ожидает ремонт'
    if (!isWaitingRepair && !sourceRow) return []
    return [
      {
        ...row,
        previousJoint: sourceRow
          ? formatPreviousJointLabel(sourceRow)
          : getPreviousSystemJointName(String(row.joint ?? '')),
      },
    ]
  })
}

export function buildWeldingJournalCancelledAcceptedRows(rows: WeldInput[]) {
  return buildWeldingJournalRows(rows).flatMap((row) => {
    const lnkRows = LNK_METHODS.flatMap((method) => {
      const result = String(row[method.resultKey] ?? '').trim()
      if (!isCancelledAcceptedResult(result)) return []
      return [
        {
          projectTitle: row.projectTitle ?? '',
          subtitleCode: row.subtitleCode ?? '',
          line: row.line ?? '',
          spool: row.spool ?? '',
          joint: row.joint ?? '',
          wdi: row.wdi ?? '',
          weldDate: row.weldDate ?? '',
          requestName: row[method.requestKey] ?? '',
          controlMethod: method.code,
          controlDate: row[method.conclusionDateKey] ?? '',
          result,
          conclusionName: row[method.conclusionKey] ?? '',
        },
      ]
    })

    const pstoResult = String(row.pstoResult ?? '').trim()
    const pstoRow = isCancelledAcceptedResult(pstoResult)
      ? [
          {
            projectTitle: row.projectTitle ?? '',
            subtitleCode: row.subtitleCode ?? '',
            line: row.line ?? '',
            spool: row.spool ?? '',
            joint: row.joint ?? '',
            wdi: row.wdi ?? '',
            weldDate: row.weldDate ?? '',
            requestName: row.pstoRequest ?? '',
            controlMethod: 'ПСТО',
            controlDate: row.pstoDate ?? '',
            result: pstoResult,
            conclusionName: row.heatTreatmentDiagram ?? '',
          },
        ]
      : []

    return [...lnkRows, ...pstoRow]
  })
}

function isCancelledAcceptedResult(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'годен (отменен)' || text === 'проведено (отменен)'
}

type PreviousRejectedSources = { latest: WeldInput; previous?: WeldInput }

function buildPreviousRejectedSourceLookup(rows: WeldInput[]) {
  const lookup = new Map<string, PreviousRejectedSources>()
  for (const row of rows) {
    const sourceJoint = String(row.joint ?? '').trim()
    if (!sourceJoint) continue
    const rejectedResult = getPrimaryRejectedLnkResult(row)
    if (!rejectedResult) continue
    const expectedTargetJoint = getExpectedRepeatedJointName(row, sourceJoint, rejectedResult.result)
    const key = getPreviousRejectedSourceKey(row, expectedTargetJoint)
    const sources = lookup.get(key)
    if (!sources) {
      lookup.set(key, { latest: row })
    } else if (compareReportRowsByJoint(row, sources.latest) >= 0) {
      lookup.set(key, { latest: row, previous: sources.latest })
    } else if (!sources.previous || compareReportRowsByJoint(row, sources.previous) >= 0) {
      sources.previous = row
    }
  }
  return lookup
}

function findPreviousRejectedSourceRow(lookup: Map<string, PreviousRejectedSources>, targetRow: WeldInput) {
  if (hasWeldDate(targetRow)) return null
  const targetJoint = String(targetRow.joint ?? '').trim()
  if (!targetJoint) return null
  const sources = lookup.get(getPreviousRejectedSourceKey(targetRow, targetJoint))
  return sources?.latest === targetRow ? sources.previous ?? null : sources?.latest ?? null
}

function getPreviousRejectedSourceKey(row: WeldInput, joint: string) {
  return encodeIdentityKey([
    normalizeJointChainPart(row.projectTitle),
    normalizeJointChainPart(row.subtitleCode),
    normalizeJointChainPart(row.line),
    normalizeJointChainPart(joint),
  ])
}

function compareReportRowsByJoint(left: WeldInput, right: WeldInput) {
  return String(left.joint ?? '').localeCompare(String(right.joint ?? ''), 'ru', { numeric: true })
}

function formatPreviousJointLabel(row: WeldInput) {
  const joint = String(row.joint ?? '').trim()
  return isUnofficialJoint(row) ? `${joint} неофициальный` : joint
}

function getPreviousSystemJointName(joint: string) {
  const trimmedJoint = joint.trim()
  if (!trimmedJoint) return ''
  const parsed = parseRepeatedJointName(trimmedJoint)
  const segments = parsed.segments.map((segment) => ({ ...segment }))
  const lastSegment = segments.at(-1)
  if (!lastSegment) return `${trimmedJoint} неофициальный`
  if (lastSegment.index > 1) {
    segments[segments.length - 1] = { ...lastSegment, index: lastSegment.index - 1 }
  } else {
    segments.pop()
  }
  return formatRepeatedJointName(parsed.base, segments)
}
