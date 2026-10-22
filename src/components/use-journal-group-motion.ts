import { useCallback, useEffect, useRef, type RefObject } from 'react'

/** Let existing visible rows slide to their new positions after a group toggle.
 * AG still removes collapsed rows immediately: no retained copies or delayed
 * datasource calls. Wheel/navigation always regain direct positioning. */
export function useJournalGroupMotion(frame: RefObject<HTMLDivElement | null>, enabled: boolean, query: string) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancel = useCallback(() => {
    clearTimeout(timer.current)
    frame.current?.classList.remove('journal-group-motion')
  }, [frame])
  const begin = useCallback(() => {
    if (!enabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    clearTimeout(timer.current)
    frame.current?.classList.add('journal-group-motion')
    // Also cover the arriving child block. This is a styling window, never a
    // wait before loading or interacting. Late responses render immediately.
    timer.current = setTimeout(cancel, 1000)
  }, [enabled, frame, cancel])
  useEffect(() => {
    cancel()
    if (!enabled) return
    window.addEventListener('wheel', cancel, { capture: true, passive: true })
    window.addEventListener('scroll', cancel, { capture: true, passive: true })
    window.addEventListener('keydown', cancel, true)
    window.addEventListener('resize', cancel)
    return () => {
      cancel()
      window.removeEventListener('wheel', cancel, true); window.removeEventListener('scroll', cancel, true)
      window.removeEventListener('keydown', cancel, true); window.removeEventListener('resize', cancel)
    }
  }, [enabled, query, cancel])
  return { begin }
}
