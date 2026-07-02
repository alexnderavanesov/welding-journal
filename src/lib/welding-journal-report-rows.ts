import { LNK_METHODS } from '@/lib/lnk-report-config'
import {
  formatRepeatedJointName,
  normalizeJointChainPart,
  parseRepeatedJointName,
} from '@/lib/joint-chain'
import { isUnofficialJoint } from '@/lib/joint-display'
import { hasWeldDate } from '@/lib/report-value-utils'
import {
  getExpectedRepeatedJointName,
  getPrimaryRejectedLnkResult,
} from '@/lib/repeated-joint-task-helpers'
import { calculateFinalStatus, normalizeFinalStatus, type WeldInput } from '@/lib/weld-fields'

type WeldingJournalStatusFilter =
  | 'ожидает сварку'
  | 'ожидает заявку'
  | 'ожидает НК'
  | 'ожидает ремонт'

export function buildWeldingJournalRows(rows: WeldInput[]) {
  return rows.map((row) => ({ ...row, finalStatus: calculateFinalStatus(row) }))
}

export function buildWeldingJournalRowsByStatus(rows: WeldInput[], status: WeldingJournalStatusFilter) {
  return buildWeldingJournalRows(rows).filter((row) => normalizeFinalStatus(row.finalStatus) === status)
}

export function buildWeldingJournalWaitingRepairRows(rows: WeldInput[]) {
  const journalRows = buildWeldingJournalRows(rows)
  return journalRows.flatMap((row) => {
    const sourceRow = findPreviousRejectedSourceRow(journalRows, row)
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

function findPreviousRejectedSourceRow(rows: WeldInput[], targetRow: WeldInput) {
  if (hasWeldDate(targetRow)) return null
  const targetJoint = String(targetRow.joint ?? '').trim()
  if (!targetJoint) return null
  const normalizedTargetJoint = normalizeJointChainPart(targetJoint)
  return (
    rows
      .filter((sourceRow) => sourceRow !== targetRow)
      .filter((sourceRow) => isSameLineIdentity(sourceRow, targetRow))
      .filter((sourceRow) => {
        const sourceJoint = String(sourceRow.joint ?? '').trim()
        const rejectedResult = getPrimaryRejectedLnkResult(sourceRow)
        if (!sourceJoint || !rejectedResult) return false
        const expectedTargetJoint = getExpectedRepeatedJointName(sourceRow, sourceJoint, rejectedResult.result)
        return normalizeJointChainPart(expectedTargetJoint) === normalizedTargetJoint
      })
      .sort(compareReportRowsByJoint)
      .at(-1) ?? null
  )
}

function isSameLineIdentity(left: WeldInput, right: WeldInput) {
  return (
    normalizeJointChainPart(left.projectTitle) === normalizeJointChainPart(right.projectTitle) &&
    normalizeJointChainPart(left.subtitleCode) === normalizeJointChainPart(right.subtitleCode) &&
    normalizeJointChainPart(left.line) === normalizeJointChainPart(right.line)
  )
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
  if (!lastSegment) return ''
  if (lastSegment.index > 1) {
    segments[segments.length - 1] = { ...lastSegment, index: lastSegment.index - 1 }
  } else {
    segments.pop()
  }
  return formatRepeatedJointName(parsed.base, segments)
}
