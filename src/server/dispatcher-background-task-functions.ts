import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import {
  getDispatcherBackgroundTaskIndexStatus,
  refreshDispatcherBackgroundTaskIndex,
} from '@/server/dispatcher-background-task-index'

const assertEntrySecurityScope = createServerOnlyFn(async () => {
  const { assertSecurityScope } = await import('@/server/security')
  await assertSecurityScope('entry')
})

const assertSettingsSecurityScope = createServerOnlyFn(async () => {
  const { assertSecurityScope } = await import('@/server/security')
  await assertSecurityScope('settings')
})

export const getDispatcherBackgroundStatus = createServerFn({ method: 'GET' }).handler(async () => {
  await assertEntrySecurityScope()
  return getDispatcherBackgroundTaskIndexStatus()
})

export const refreshDispatcherBackgroundNow = createServerFn({ method: 'POST' }).handler(async () => {
  await assertSettingsSecurityScope()
  return refreshDispatcherBackgroundTaskIndex({ force: true })
})
