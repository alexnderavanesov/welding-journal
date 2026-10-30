export const ACCOUNT_ACTIVITY_REFRESH_MS = 60_000
export const ACCOUNT_ONLINE_WINDOW_MS = 3 * 60_000

/** Browser activity only; background polling must not keep idle users online. */
export function watchAccountActivity(refresh: () => Promise<void>) {
  let lastActivity = Date.now()
  let lastRefresh = Date.now()
  const check = (force = false) => {
    if (document.visibilityState !== 'visible') return
    const now = Date.now()
    if (!force && now - lastRefresh < ACCOUNT_ACTIVITY_REFRESH_MS) return
    lastRefresh = now
    void refresh()
  }
  const activity = () => { lastActivity = Date.now(); check() }
  const focus = () => { lastActivity = Date.now(); check(true) }
  const visible = () => { if (document.visibilityState === 'visible') focus() }
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
  for (const event of events) window.addEventListener(event, activity, { passive: true })
  window.addEventListener('focus', focus)
  document.addEventListener('visibilitychange', visible)
  void refresh()
  const interval = window.setInterval(() => {
    if (Date.now() - lastActivity < ACCOUNT_ACTIVITY_REFRESH_MS) check()
  }, ACCOUNT_ACTIVITY_REFRESH_MS)
  return () => {
    window.clearInterval(interval)
    for (const event of events) window.removeEventListener(event, activity)
    window.removeEventListener('focus', focus)
    document.removeEventListener('visibilitychange', visible)
  }
}
