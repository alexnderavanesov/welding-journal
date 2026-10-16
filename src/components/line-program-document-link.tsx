import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useState, type ReactNode } from 'react'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { GeneratedDocumentFieldKey } from '@/lib/generated-document-types'
import { createRowDocumentPreviewRequest } from '@/lib/row-document-preview'
import { HistoryDocumentPreview, type HistoryDocumentPreviewRequest } from './history-document-preview'

export type ProgramDocument = { reference: SystemDocumentReference } | { row: WeldRow; field: GeneratedDocumentFieldKey }

/** No document or registry requests until the user actually opens a document. */
export function createProgramDocumentPreviewRequest(document: ProgramDocument, client: QueryClient): HistoryDocumentPreviewRequest {
  const title = 'reference' in document ? document.reference.title : String(document.row[document.field] ?? '').trim() || 'Документ'
  return {
    title,
    fileName: `${title.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ')}.xlsx`,
    createBlob: async () => {
      if ('row' in document && !String(document.row[document.field] ?? '').trim()) {
        throw new Error('У документа не сохранён номер. Откройте его из раздела «Документы».')
      }
      const { loadWelderStampRegistrySnapshot } = await import('@/server/welder-stamps')
      const registry = await client.fetchQuery({ queryKey: ['welder-stamp-registry'], queryFn: () => loadWelderStampRegistrySnapshot(), staleTime: 30_000 })
      if ('reference' in document) {
        const { createCurrentSystemDocumentBlob } = await import('@/lib/system-document-storage')
        return createCurrentSystemDocumentBlob({ reference: document.reference, welderStamps: registry.stamps })
      }
      return createRowDocumentPreviewRequest(document.row, document.field, registry.stamps).createBlob()
    },
  }
}

export function useProgramDocumentPreview() {
  const client = useQueryClient()
  const [request, setRequest] = useState<HistoryDocumentPreviewRequest | null>(null)
  const closePreview = useCallback(() => setRequest(null), [])
  const openDocument = useCallback((document: ProgramDocument) => setRequest(createProgramDocumentPreviewRequest(document, client)), [client])
  return { openDocument, preview: request ? <HistoryDocumentPreview request={request} onClose={closePreview} /> : null }
}

export function ProgramDocumentLink({ document, children }: { document: ProgramDocument; children: ReactNode }) {
  const { openDocument, preview } = useProgramDocumentPreview()
  return <>
    <button type="button" onClick={() => openDocument(document)} title="Открыть предпросмотр документа" className="max-w-full break-words rounded text-left text-sky-700 underline decoration-dotted underline-offset-4 hover:text-sky-900 focus-visible:outline-sky-500">{children}</button>
    {preview}
  </>
}
