const relativeTime = new Intl.RelativeTimeFormat('ru', { numeric: 'always' })
const moscowTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

export function formatAccountActivityTime(value: string | Date, now: number) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const elapsed = Math.max(0, now - date.getTime())
  const exact = `${moscowTime.format(date)} МСК`
  const label = elapsed < 60_000 ? 'только что'
    : elapsed < 3_600_000 ? relativeTime.format(-Math.floor(elapsed / 60_000), 'minute')
    : elapsed < 86_400_000 ? relativeTime.format(-Math.floor(elapsed / 3_600_000), 'hour')
    : elapsed < 7 * 86_400_000 ? relativeTime.format(-Math.floor(elapsed / 86_400_000), 'day')
    : exact
  return { label, exact, iso: date.toISOString() }
}
