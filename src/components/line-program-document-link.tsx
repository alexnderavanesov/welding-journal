import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { GeneratedDocumentFieldKey } from '@/lib/generated-document-types'

export type ProgramDocument = { reference: SystemDocumentReference } | { row: WeldRow; field: GeneratedDocumentFieldKey }

/** No document or registry requests until the user actually opens a document. */
export async function openProgramDocument(document: ProgramDocument, client: QueryClient) {
  const preview = window.open('', '_blank')
  if (!preview) { window.alert('Браузер заблокировал открытие документа в новой вкладке.'); return }
  preview.opener = null
  preview.document.title = 'Просмотр документа'
  preview.document.body.textContent = 'Подготавливаем документ…'
  try {
    if ('row' in document && !String(document.row[document.field] ?? '').trim()) {
      throw new Error('У документа не сохранён номер. Откройте его из раздела «Документы».')
    }
    const { loadWelderStampRegistrySnapshot } = await import('@/server/welder-stamps')
    const registry = await client.fetchQuery({ queryKey: ['welder-stamp-registry'], queryFn: () => loadWelderStampRegistrySnapshot(), staleTime: 30_000 })
    if (preview.closed) return
    if ('reference' in document) {
      const { openSystemDocument } = await import('@/lib/system-document-storage')
      await openSystemDocument({ reference: document.reference, welderStamps: registry.stamps, previewWindow: preview })
    } else {
      const { openGeneratedDocumentForRow } = await import('@/lib/welding-journal-document')
      await openGeneratedDocumentForRow(document.row, document.field, registry.stamps, preview)
    }
  } catch (error) {
    if (!preview.closed) preview.document.body.textContent = error instanceof Error ? error.message : 'Не удалось открыть документ.'
  }
}

export function ProgramDocumentLink({ document, children }: { document: ProgramDocument; children: ReactNode }) {
  const client = useQueryClient()
  return <button type="button" onClick={() => void openProgramDocument(document, client)} title="Открыть документ в новой вкладке" className="max-w-full break-words rounded text-left text-sky-700 underline decoration-dotted underline-offset-4 hover:text-sky-900 focus-visible:outline-sky-500">{children}</button>
}
