import type { StoredDocumentTemplate, WeldingJournalTemplateOptions } from '@/lib/document-template-storage'
import { buildDocumentTemplateName } from '@/lib/document-template-storage'
import type { WeldRow } from '@/lib/dispatcher-types'
import { isUnofficialJoint } from '@/lib/joint-display'
import { isRevisionNotActual } from '@/lib/revision-actuality'
import { saveGeneratedDocuments, type StoredGeneratedDocument } from '@/lib/generated-document-storage'
import { parseDateLikeToIso } from '@/lib/date-format'
import {
  makeUniqueDocumentNames,
  splitWeldingJournalRecords,
} from '@/lib/welding-journal-document-splitting'
import { WELDING_JOURNAL_DOCUMENT_MIME_TYPE } from '@/lib/welding-journal-document'
import {
  buildFinalStatusRowsContext,
  calculateFinalStatusInRows,
  normalizeFinalStatus,
} from '@/lib/weld-status'
import type { GeneratedDocumentType } from '@/server/generated-documents'
import { getGeneratedDocumentProfile } from '@/lib/generated-document-types'

export type WeldingJournalGenerationFilters = {
  projects?: string[]
  subtitles?: string[]
  lines?: string[]
}

export type WeldingJournalGenerationPlan = {
  type: GeneratedDocumentType
  documentLabel: string
  rows: WeldRow[]
  groups: WeldRow[][]
  titles: string[]
  periodFrom: string
  periodTo: string
}

export function getWeldingJournalRowsDateRange(rows: WeldRow[]) {
  const dates = rows
    .map((row) => parseDateLikeToIso(row.weldDate))
    .filter((value): value is string => Boolean(value))
    .sort()

  if (dates.length === 0) return null
  return {
    from: dates[0],
    to: dates[dates.length - 1],
  }
}

export function prepareWeldingJournalDocumentRows({
  sourceRows,
  contextRows,
  periodFrom,
  periodTo,
  options,
  filters = {},
}: {
  sourceRows: WeldRow[]
  contextRows: WeldRow[]
  periodFrom: string
  periodTo: string
  options: WeldingJournalTemplateOptions
  filters?: WeldingJournalGenerationFilters
}) {
  const finalStatusContext = buildFinalStatusRowsContext(contextRows)
  return sourceRows
    .filter((row) => {
      const weldDate = parseDateLikeToIso(row.weldDate)
      if (!weldDate) return false
      if (periodFrom && weldDate < periodFrom) return false
      if (periodTo && weldDate > periodTo) return false
      if (!matchesSelection(row.projectTitle, filters.projects)) return false
      if (!matchesSelection(row.subtitleCode, filters.subtitles)) return false
      if (!matchesSelection(row.line, filters.lines)) return false
      if (options.officialOnly && isUnofficialJoint(row)) return false
      if (
        options.goodOnly &&
        normalizeFinalStatus(calculateFinalStatusInRows(row, contextRows, finalStatusContext)) !== 'годен'
      ) {
        return false
      }
      if (options.actualOnly && isRevisionNotActual(row.revisionActuality)) return false
      return true
    })
    .sort(compareWeldingJournalRows)
}

export function buildWeldingJournalGenerationPlan({
  type = 'weldingJournal',
  documentLabel = getGeneratedDocumentProfile(type).label,
  rows,
  template,
  options,
  periodFrom,
  periodTo,
  manualTitle,
}: {
  type?: GeneratedDocumentType
  documentLabel?: string
  rows: WeldRow[]
  template: StoredDocumentTemplate | null
  options: WeldingJournalTemplateOptions
  periodFrom: string
  periodTo: string
  manualTitle?: string
}): WeldingJournalGenerationPlan {
  const groups = splitWeldingJournalRecords(rows, options.splitMode)
  const normalizedManualTitle = normalizeWeldingJournalDocumentTitle(manualTitle ?? '')
  const titles = makeUniqueDocumentNames(
    groups.map((group) =>
      normalizedManualTitle ||
      buildDocumentTemplateName({
        config: template?.constructorConfig?.nameConfig,
        records: group,
        periodFrom,
        periodTo,
      }),
    ),
  )

  return {
    type,
    documentLabel,
    rows,
    groups,
    titles,
    periodFrom,
    periodTo,
  }
}

export async function saveWeldingJournalGenerationPlan(plan: WeldingJournalGenerationPlan) {
  return saveGeneratedDocuments(
    plan.groups.map((groupRows, index) => {
      const title = plan.titles[index] ?? plan.documentLabel
      return {
        type: plan.type,
        title,
        fileName: ensureWeldingJournalXlsxFileName(title, plan.documentLabel),
        mimeType: WELDING_JOURNAL_DOCUMENT_MIME_TYPE,
        weldJointIds: groupRows.map((row) => row.id),
        periodFrom: plan.periodFrom,
        periodTo: plan.periodTo,
        rowCount: groupRows.length,
        wdiTotal: groupRows.reduce((sum, row) => sum + (Number(row.wdi) || 0), 0),
      }
    }),
  )
}

export function formatWeldingJournalGenerationSuccess(
  savedDocuments: StoredGeneratedDocument[],
  fallbackTitle = 'ЖСР',
  documentLabel: string = savedDocuments[0]
    ? getGeneratedDocumentProfile(savedDocuments[0].type).label
    : 'ЖСР',
) {
  if (savedDocuments.length === 1) {
    return `${documentLabel} «${savedDocuments[0]?.title ?? fallbackTitle}» сформирован и добавлен в историю.`
  }
  return `Сформировано документов «${documentLabel}»: ${savedDocuments.length}. Документы добавлены в историю.`
}

export function normalizeWeldingJournalDocumentTitle(value: string) {
  return value
    .replace(/\.xlsx$/i, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function ensureWeldingJournalXlsxFileName(value: string, fallbackTitle = 'ЖСР') {
  return `${normalizeWeldingJournalDocumentTitle(value) || fallbackTitle}.xlsx`
}

function matchesSelection(value: unknown, selectedValues: string[] | undefined) {
  if (!selectedValues || selectedValues.length === 0) return true
  return selectedValues.includes(String(value ?? '').trim())
}

function compareWeldingJournalRows(left: WeldRow, right: WeldRow) {
  const leftDate = parseDateLikeToIso(left.weldDate) ?? ''
  const rightDate = parseDateLikeToIso(right.weldDate) ?? ''
  return (
    leftDate.localeCompare(rightDate) ||
    String(left.line ?? '').localeCompare(String(right.line ?? ''), 'ru', { numeric: true }) ||
    String(left.joint ?? '').localeCompare(String(right.joint ?? ''), 'ru', { numeric: true })
  )
}
