import { createFileRoute } from '@tanstack/react-router'
import { prepareDispatcherCalculation } from '@/server/dispatcher-prewarm'
import { isMaintenanceRequestAuthorized } from '@/server/maintenance-auth'

export const Route = createFileRoute('/api/maintenance/dispatcher-prewarm')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.MAINTENANCE_TOKEN?.trim()
        if (!token) return Response.json({ error: 'MAINTENANCE_TOKEN is not configured' }, { status: 503 })
        if (!isMaintenanceRequestAuthorized(request.headers.get('authorization'), token)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          return Response.json(await prepareDispatcherCalculation())
        } catch {
          return Response.json({ error: 'Не удалось подготовить актуальный расчёт. Проверьте готовность базы и повторите запуск.' }, { status: 503 })
        }
      },
    },
  },
})
