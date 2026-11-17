import { definePlugin } from 'nitro'
import { useNitroHooks } from 'nitro/app'
import { nextDispatcherPrewarmAt, startDispatcherPrewarmSchedule } from './dispatcher-prewarm-schedule'

export default definePlugin(() => {
  // Docker enables this explicitly; dev servers and local builds stay idle.
  if (process.env.NODE_ENV !== 'production' || process.env.DISPATCHER_PREWARM_ENABLED !== '1') return
  const stopSchedule = startDispatcherPrewarmSchedule(async () => {
    // No database initialization or calculation on plugin startup.
    const { prepareDispatcherCalculation } = await import('./dispatcher-prewarm')
    const result = await prepareDispatcherCalculation()
    console.info('[dispatcher-prewarm] Актуальный расчёт готов:', result.computedAt)
  })
  const stop = () => {
    stopSchedule()
    process.off('SIGTERM', stop)
    process.off('SIGINT', stop)
  }
  useNitroHooks().hook('close', stop)
  // The installed Nitro node preset does not forward process shutdown to
  // its close hook. Clear our timer without changing its shutdown behavior.
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  console.info('[dispatcher-prewarm] Ежедневно 06:30 Europe/Moscow; ближайшая проверка:', nextDispatcherPrewarmAt().toISOString())
})
