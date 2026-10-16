import type { HistoryDocumentPreviewRequest } from '@/components/history-document-preview'
import type { WeldRow } from '@/lib/dispatcher-types'
import { isGeneratedDocumentFieldKey } from '@/lib/generated-document-types'
import { getSystemDocumentReferenceForField } from '@/lib/system-document-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

/** Load only on opening; all preview/print/download actions share the same snapshot. */
export function createRowDocumentPreviewRequest(
  row: WeldRow,
  field: WeldFieldKey,
  welderStamps: WelderStampRecord[],
): HistoryDocumentPreviewRequest {
  const title = String(row[field] ?? '').trim() || 'Документ'
  return {
    title,
    fileName: `${title.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ')}.xlsx`,
    createBlob: async () => {
      if (isGeneratedDocumentFieldKey(field)) {
        const { createGeneratedDocumentBlobForRow } = await import('@/lib/welding-journal-document')
        return createGeneratedDocumentBlobForRow(row, field, welderStamps)
      }
      const reference = getSystemDocumentReferenceForField(row, field)
      if (!reference) throw new Error('У документа не сохранён номер или тип. Откройте его из раздела «Документы».')
      const { createCurrentSystemDocumentBlob } = await import('@/lib/system-document-storage')
      return createCurrentSystemDocumentBlob({ reference, welderStamps })
    },
  }
}
