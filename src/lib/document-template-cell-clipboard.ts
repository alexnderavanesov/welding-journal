import type {
  DocumentTemplateCellBinding,
  DocumentTemplateCellPart,
  DocumentTemplateId,
} from '@/lib/document-template-storage'

export const DOCUMENT_TEMPLATE_CELL_CLIPBOARD_STORAGE_KEY =
  'welding-document-template-cell-clipboard:v1'

export type DocumentTemplateCellClipboardPayload = {
  version: 1
  binding: DocumentTemplateCellBinding
  source: {
    templateId: DocumentTemplateId
    templateFileName: string
    sheetName: string
    cell: string
  }
}

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

function cloneCellPart(part: DocumentTemplateCellPart): DocumentTemplateCellPart {
  return { ...part }
}

export function cloneDocumentTemplateCellBinding(
  binding: DocumentTemplateCellBinding,
): DocumentTemplateCellBinding {
  return {
    ...binding,
    parts: binding.parts?.map(cloneCellPart),
  }
}

export function createDocumentTemplateCellClipboardPayload({
  binding,
  templateId,
  templateFileName,
  sheetName,
}: {
  binding: DocumentTemplateCellBinding
  templateId: DocumentTemplateId
  templateFileName: string
  sheetName: string
}): DocumentTemplateCellClipboardPayload {
  return {
    version: 1,
    binding: cloneDocumentTemplateCellBinding(binding),
    source: {
      templateId,
      templateFileName,
      sheetName,
      cell: binding.cell,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isCellPart(value: unknown): value is DocumentTemplateCellPart {
  if (!isRecord(value) || typeof value.field !== 'string') return false
  if (value.compareField !== undefined && typeof value.compareField !== 'string') return false
  if (value.multiplier !== undefined && typeof value.multiplier !== 'string') return false
  if (value.prefix !== undefined && typeof value.prefix !== 'string') return false
  if (value.suffix !== undefined && typeof value.suffix !== 'string') return false
  if (value.lineBreakAfter !== undefined && typeof value.lineBreakAfter !== 'boolean') return false
  return value.numericOperation === undefined || value.numericOperation === 'min' || value.numericOperation === 'max'
}

function isCellBinding(value: unknown): value is DocumentTemplateCellBinding {
  if (!isRecord(value) || typeof value.cell !== 'string') return false
  if (value.mode !== 'row' && value.mode !== 'summary') return false
  if (value.field !== undefined && typeof value.field !== 'string') return false
  if (value.parts !== undefined && (!Array.isArray(value.parts) || !value.parts.every(isCellPart))) return false
  if (value.uniqueParts !== undefined && typeof value.uniqueParts !== 'boolean') return false
  if (value.uniqueValues !== undefined && typeof value.uniqueValues !== 'boolean') return false
  if (
    value.separator !== undefined
    && value.separator !== 'comma'
    && value.separator !== 'newline'
    && value.separator !== 'custom'
  ) return false
  if (value.customSeparator !== undefined && typeof value.customSeparator !== 'string') return false
  if (value.scope !== undefined && value.scope !== 'document' && value.scope !== 'group') return false
  if (value.emptyMode !== undefined && value.emptyMode !== 'blank' && value.emptyMode !== 'np' && value.emptyMode !== 'custom') return false
  if (value.emptyText !== undefined && typeof value.emptyText !== 'string') return false
  if (value.filledMode !== undefined && value.filledMode !== 'value' && value.filledMode !== 'custom') return false
  if (value.filledText !== undefined && typeof value.filledText !== 'string') return false
  return true
}

export function parseDocumentTemplateCellClipboardPayload(
  value: unknown,
): DocumentTemplateCellClipboardPayload | null {
  if (!isRecord(value) || value.version !== 1 || !isCellBinding(value.binding)) return null
  if (!isRecord(value.source)) return null
  if (
    typeof value.source.templateId !== 'string'
    || typeof value.source.templateFileName !== 'string'
    || typeof value.source.sheetName !== 'string'
    || typeof value.source.cell !== 'string'
  ) return null

  return {
    version: 1,
    binding: cloneDocumentTemplateCellBinding(value.binding),
    source: {
      templateId: value.source.templateId as DocumentTemplateId,
      templateFileName: value.source.templateFileName,
      sheetName: value.source.sheetName,
      cell: value.source.cell,
    },
  }
}

export function readDocumentTemplateCellClipboard(
  storage: ReadableStorage | null | undefined,
): DocumentTemplateCellClipboardPayload | null {
  if (!storage) return null
  try {
    const serialized = storage.getItem(DOCUMENT_TEMPLATE_CELL_CLIPBOARD_STORAGE_KEY)
    if (!serialized) return null
    return parseDocumentTemplateCellClipboardPayload(JSON.parse(serialized))
  } catch {
    return null
  }
}

export function writeDocumentTemplateCellClipboard(
  storage: WritableStorage | null | undefined,
  payload: DocumentTemplateCellClipboardPayload,
) {
  if (!storage) return false
  try {
    storage.setItem(DOCUMENT_TEMPLATE_CELL_CLIPBOARD_STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}
