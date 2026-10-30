import { createFileRoute } from '@tanstack/react-router'
import { createReportExcelResponse } from '@/server/report-excel-file'

export const Route = createFileRoute('/api/report-excel')({ server: { handlers: {
  POST: async ({ request }) => {
    // Same-origin download with the normal entry permission checked in the reader.
    if (request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Недопустимый источник запроса.', { status: 403 })
    try {
      const { requireIdentity, runWithAccess } = await import('@/server/access-context')
      const { getOperationPermissions } = await import('@/server/access-operation-policy')
      const { assertReadableQuery } = await import('@/server/access-payload')
      const identity = await requireIdentity(), data = await request.json()
      assertReadableQuery(identity, data)
      return await runWithAccess(identity, 'downloadReportExcel', getOperationPermissions('@reportExport', data), () => createReportExcelResponse(data, request.signal))
    }
    catch (error) { return new Response(error instanceof Error ? error.message : 'Не удалось подготовить Excel.', { status: 400, headers: { 'Cache-Control': 'no-store' } }) }
  },
} } })
