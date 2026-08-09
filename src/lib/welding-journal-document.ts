import type { WeldRow } from '@/lib/dispatcher-types'
import {
  loadGeneratedDocumentRows,
  openGeneratedDocument,
  type StoredGeneratedDocument,
} from '@/lib/generated-document-storage'
import {
  createWeldingJournalBlobFromTemplate,
  loadDocumentTemplate,
  type StoredDocumentTemplate,
} from '@/lib/document-template-storage'
import { FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-fields'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import type { GeneratedDocumentType } from '@/server/generated-documents'
import {
  GENERATED_DOCUMENT_PROFILES,
  getGeneratedDocumentProfile,
  type GeneratedDocumentFieldKey,
} from '@/lib/generated-document-types'

export const WELDING_JOURNAL_DOCUMENT_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const BASE_WELDING_JOURNAL_FIELD_KEYS: WeldFieldKey[] = [
  'projectTitle',
  'subtitleCode',
  'line',
  'spool',
  'spoolId',
  'joint',
  'materialId1',
  'materialId2',
  'element1',
  'element2',
  'material1',
  'material2',
  'materialUniqueNumber1',
  'materialUniqueNumber2',
  'materialFullName1',
  'materialFullName2',
  'materialNormativeDocument1',
  'materialNormativeDocument2',
  'materialCertificateNumber1',
  'materialCertificateNumber2',
  'weldingMethod',
  'connectionType',
  'materialGroup',
  'd1',
  'd2',
  't1',
  't2',
  'wdi',
  'weldDate',
  'stamp1KFact',
  'stamp1ZFact',
  'stamp1OFact',
  'stamp2KFact',
  'stamp2ZFact',
  'stamp2OFact',
  'responsible',
]

const BASE_WELDING_JOURNAL_FIELDS = BASE_WELDING_JOURNAL_FIELD_KEYS.map((key) => ({
  key,
  label: FIELD_BY_KEY.get(key)?.label ?? key,
}))

export async function createCurrentWeldingJournalDocumentBlob({
  rows,
  welderStamps,
  template,
}: {
  rows: WeldRow[]
  welderStamps: WelderStampRecord[]
  template?: StoredDocumentTemplate | null
}) {
  return createCurrentGeneratedDocumentBlob({
    type: 'weldingJournal',
    rows,
    welderStamps,
    template,
  })
}

export async function createCurrentGeneratedDocumentBlob({
  type,
  rows,
  welderStamps,
  template,
}: {
  type: GeneratedDocumentType
  rows: WeldRow[]
  welderStamps: WelderStampRecord[]
  template?: StoredDocumentTemplate | null
}) {
  const currentTemplate = template === undefined ? await loadDocumentTemplate(type) : template
  return currentTemplate?.fileType === 'xlsx' || currentTemplate?.fileType === 'xls'
    ? createWeldingJournalBlobFromTemplate(currentTemplate, rows, { welderStamps })
    : createBaseWeldingJournalDocumentBlob(rows, type)
}

export function openWeldingJournalDocumentForRow(row: WeldRow, welderStamps: WelderStampRecord[]) {
  return openGeneratedDocumentForRow(row, 'jsrDocument', welderStamps)
}

export function openGeneratedDocumentForRow(
  row: WeldRow,
  fieldKey: GeneratedDocumentFieldKey,
  welderStamps: WelderStampRecord[],
  previewWindow?: Window | null,
) {
  const type = (
    Object.entries(GENERATED_DOCUMENT_PROFILES) as Array<
      [GeneratedDocumentType, (typeof GENERATED_DOCUMENT_PROFILES)[GeneratedDocumentType]]
    >
  ).find(([, profile]) => profile.fieldKey === fieldKey)?.[0]
  if (!type) return
  const profile = getGeneratedDocumentProfile(type)
  const documentId = Number(row[profile.idKey])
  const title = String(row[profile.fieldKey] ?? '').trim()
  if (!Number.isInteger(documentId) || documentId <= 0 || !title) return

  const documentRecord: StoredGeneratedDocument = {
    id: documentId,
    type,
    title,
    fileName: `${sanitizeFileName(title)}.xlsx`,
    mimeType: WELDING_JOURNAL_DOCUMENT_MIME_TYPE,
    rowCount: 0,
    projects: [],
    subtitleCodes: [],
    lines: [],
    createdAt: '',
    updatedAt: '',
  }
  void openGeneratedDocument(
    documentRecord,
    async () => {
      const rows = await loadGeneratedDocumentRows(documentId)
      if (rows.length === 0) throw new Error('В документе больше нет стыков.')
      return createCurrentGeneratedDocumentBlob({ type, rows, welderStamps })
    },
    previewWindow,
  )
}

export async function createBaseWeldingJournalDocumentBlob(
  rows: WeldRow[],
  type: GeneratedDocumentType = 'weldingJournal',
) {
  const XLSX = await import('xlsx')
  const worksheet = XLSX.utils.json_to_sheet(
    rows.map((row, index) => {
      const exportRow: Record<string, string | number> = { '№': index + 1 }
      for (const field of BASE_WELDING_JOURNAL_FIELDS) {
        exportRow[field.label] = getCellValue(row, field.key)
      }
      return exportRow
    }),
  )
  worksheet['!cols'] = [
    { wch: 5 },
    ...BASE_WELDING_JOURNAL_FIELDS.map((field) => ({ wch: Math.max(14, field.label.length + 3) })),
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, getGeneratedDocumentProfile(type).sheetName)
  const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([workbookData], { type: WELDING_JOURNAL_DOCUMENT_MIME_TYPE })
}

function getCellValue(row: WeldRow, key: WeldFieldKey) {
  const value = row[key]
  if (key.toLowerCase().includes('date')) return formatDate(value)
  return value == null || value === '' ? '-' : String(value)
}

function formatDate(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`
  return raw
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'ЖСР'
}
