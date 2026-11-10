import type { KeyboardEvent, MouseEvent } from 'react'
export type SchemeObjectMenuHandler = (kind: 'annotation' | 'dimension', id: string, event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void

export function selectSchemeItems(previous: ReadonlySet<string>, id: string, additive: boolean) {
  if (!additive) return new Set([id])
  const next = new Set(previous)
  if (next.has(id)) next.delete(id); else next.add(id)
  return next
}
