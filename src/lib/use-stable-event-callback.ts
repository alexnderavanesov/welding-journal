import { useCallback, useLayoutEffect, useRef } from 'react'

export function useStableEventCallback<Args extends unknown[], Result>(
  callback: ((...args: Args) => Result) | undefined,
) {
  const callbackRef = useRef(callback)
  useLayoutEffect(() => {
    callbackRef.current = callback
  }, [callback])

  return useCallback((...args: Args) => callbackRef.current?.(...args), [])
}
