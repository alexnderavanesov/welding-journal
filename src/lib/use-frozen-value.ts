import { useRef } from 'react'

export function useFrozenValue<T>(value: T, frozen: boolean) {
  const valueRef = useRef(value)
  if (!frozen) valueRef.current = value
  return valueRef.current
}
