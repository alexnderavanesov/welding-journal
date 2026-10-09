import { useEffect, useRef } from 'react'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'

/** Two user-activity triggers, not polling. A visibility/focus/open burst is one
 * check; background/inactive views and unmounted listeners do no work. */
export function useDispatcherActivityCheck({ enabled, workspaceOpen, check }: { enabled: boolean; workspaceOpen: boolean; check: () => Promise<void> }) {
  const pending = useRef(false)
  const lastOpen = useRef(false)
  const scheduleRef = useRef<(() => void) | null>(null)
  const run = useStableEventCallback(check)
  useEffect(() => {
    if (!enabled) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (timer) clearTimeout(timer)
      if (document.visibilityState === 'hidden' || pending.current) return
      timer = setTimeout(() => {
        timer = undefined
        if (!active || document.visibilityState === 'hidden' || pending.current) return
        pending.current = true
        void Promise.resolve(run()).finally(() => { pending.current = false })
      }, 200)
    }
    scheduleRef.current = schedule
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', schedule)
    return () => {
      active = false; if (timer) clearTimeout(timer); scheduleRef.current = null
      window.removeEventListener('focus', schedule)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [enabled, run])
  useEffect(() => {
    if (workspaceOpen && !lastOpen.current) scheduleRef.current?.()
    lastOpen.current = workspaceOpen
  }, [workspaceOpen, enabled])
}
