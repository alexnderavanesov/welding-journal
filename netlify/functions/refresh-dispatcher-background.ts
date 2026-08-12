import { refreshDispatcherBackgroundTaskIndex } from '../../src/server/dispatcher-background-task-index'

export default async () => {
  await refreshDispatcherBackgroundTaskIndex()
}

export const config = {
  background: true,
  schedule: '0 0 * * *',
}
