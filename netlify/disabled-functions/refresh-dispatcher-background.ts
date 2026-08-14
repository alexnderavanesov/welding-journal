import { refreshDispatcherBackgroundTaskIndex } from '../../src/server/dispatcher-background-task-index'

// Kept outside netlify/functions so Netlify does not deploy or schedule it while the refresh is paused.
// To resume, move it back and set DISPATCHER_BACKGROUND_REFRESH_ENABLED to true.
export default async () => {
  await refreshDispatcherBackgroundTaskIndex()
}

export const config = {
  background: true,
  schedule: '0 0 * * *',
}
