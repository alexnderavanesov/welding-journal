import { useEffect, useRef } from 'react'

type UseWindowEscapeKeyOptions = {
  capture?: boolean
}

export function useWindowEscapeKey(
  enabled: boolean,
  onEscape: (event: KeyboardEvent) => void,
  { capture = false }: UseWindowEscapeKeyOptions = {},
) {
  const onEscapeRef = useRef(onEscape)

  useEffect(() => {
    onEscapeRef.current = onEscape
  }, [onEscape])

  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      onEscapeRef.current(event)
    }

    window.addEventListener('keydown', handleKeyDown, { capture })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture })
  }, [capture, enabled])
}
