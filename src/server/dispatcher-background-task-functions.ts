import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { DISPATCHER_BACKGROUND_REFRESH_ENABLED } from '@/lib/dispatcher-background-settings'
import {
  getDispatcherBackgroundTaskIndexStatus,
  refreshDispatcherBackgroundTaskIndex,
} from '@/server/dispatcher-background-task-index'

const PAUSED_BACKGROUND_STATUS = {
  enabled: false,
  status: 'disabled' as const,
  computedAt: null,
  startedAt: null,
  lastError: null,
  rowCount: 0,
}

const assertEntrySecurityScope = createServerOnlyFn(async () => {
  const { assertSecurityScope } = await import('@/server/security')
  await assertSecurityScope('entry')
})

const assertSettingsSecurityScope = createServerOnlyFn(async () => {
  const { assertSecurityScope } = await import('@/server/security')
  await assertSecurityScope('settings')
})

export const getDispatcherBackgroundStatus = createServerFn({ method: 'GET' }).handler(async () => {
  if (!DISPATCHER_BACKGROUND_REFRESH_ENABLED) return PAUSED_BACKGROUND_STATUS
  await assertEntrySecurityScope()
  return getDispatcherBackgroundTaskIndexStatus()
})

export const refreshDispatcherBackgroundNow = createServerFn({ method: 'POST' }).handler(async () => {
  if (!DISPATCHER_BACKGROUND_REFRESH_ENABLED) {
    return { ...PAUSED_BACKGROUND_STATUS, refreshed: false }
  }
  await assertSettingsSecurityScope()
  return refreshDispatcherBackgroundTaskIndex({ force: true })
})
