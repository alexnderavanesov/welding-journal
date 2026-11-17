import { BUSINESS_TIME_ZONE, getBusinessDateIso } from '@/lib/business-date'

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE, hourCycle: 'h23',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})
const DAY_MS = 86_400_000

/** Moscow has no seasonal clock change. Use its clock, never the host's TZ. */
export function nextDispatcherPrewarmAt(now = new Date()) {
  const parts = Object.fromEntries(clock.formatToParts(now).map(part => [part.type, part.value]))
  const elapsed = (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 + now.getUTCMilliseconds()
  const remaining = (6 * 60 + 30) * 60_000 - elapsed
  return new Date(now.getTime() + (remaining > 0 ? remaining : remaining + DAY_MS))
}

/** One timer, no database polling or missed-run queue. The existing engine
 * checks readiness/freshness and coalesces concurrent processes and users. */
export function startDispatcherPrewarmSchedule(prepare: () => Promise<unknown>) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  function schedule() {
    if (stopped) return
    const due = nextDispatcherPrewarmAt()
    timer = setTimeout(async () => {
      if (stopped) return
      const now = new Date()
      // A moved clock must not start early or replay a previous day's slot.
      if (now < due || getBusinessDateIso(now) !== getBusinessDateIso(due)) {
        schedule()
        return
      }
      try {
        await prepare()
      } catch {
        // Do not print database errors/connection details into runtime logs.
        console.error('[dispatcher-prewarm] Утренняя подготовка не завершена. Обычный пересчёт остаётся доступен; следующий запуск по расписанию — завтра.')
      } finally {
        schedule()
      }
    }, due.getTime() - Date.now())
    timer.unref?.()
  }
  schedule()
  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
