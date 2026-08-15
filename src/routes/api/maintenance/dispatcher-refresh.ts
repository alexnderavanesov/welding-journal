import { createFileRoute } from '@tanstack/react-router'

import { refreshDispatcherBackgroundTaskIndex } from '@/server/dispatcher-background-task-index'
import { isMaintenanceRequestAuthorized } from '@/server/maintenance-auth'

export const Route = createFileRoute('/api/maintenance/dispatcher-refresh')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const maintenanceToken = process.env.MAINTENANCE_TOKEN?.trim()
        if (!maintenanceToken) {
          return Response.json({ error: 'MAINTENANCE_TOKEN is not configured' }, { status: 503 })
        }
        if (!isMaintenanceRequestAuthorized(request.headers.get('authorization'), maintenanceToken)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        return Response.json(await refreshDispatcherBackgroundTaskIndex())
      },
    },
  },
})
