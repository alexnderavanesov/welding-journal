import { createFileRoute } from '@tanstack/react-router'
import { requireIdentity, runWithAccess } from '@/server/access-context'
import { createDocumentHistoryExcelResponse, readDocumentHistoryReport } from '@/server/document-history-report'

export const Route = createFileRoute('/api/document-history-report')({ server: { handlers: {
  POST: async ({ request }) => {
    if (request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Недопустимый источник запроса.', { status: 403 })
    try {
      const identity = await requireIdentity(), { format, ...input } = await request.json()
      if (format !== 'preview' && format !== 'excel') throw new Error('Неизвестный формат отчёта.')
      return await runWithAccess(identity, 'documentHistoryReport', ['documents.view', 'documents.export'], () => format === 'excel'
        ? createDocumentHistoryExcelResponse(input, request.signal)
        : readDocumentHistoryReport(input, request.signal).then(report => Response.json(report, { headers: { 'Cache-Control': 'no-store' } })))
    } catch (error) { return new Response(error instanceof Error ? error.message : 'Не удалось подготовить список документов.', { status: 400, headers: { 'Cache-Control': 'no-store' } }) }
  },
} } })
