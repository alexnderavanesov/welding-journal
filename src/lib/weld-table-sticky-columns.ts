import type { CSSProperties } from 'react'
import { getWeldColumnWidth } from '@/lib/weld-column-widths'
import type { WeldFieldKey } from '@/lib/weld-fields'

const STICKY_WELD_TABLE_FIELD_KEYS: WeldFieldKey[] = ['line', 'joint']

export function isStickyWeldTableField(fieldKey: string) {
  return STICKY_WELD_TABLE_FIELD_KEYS.includes(fieldKey as WeldFieldKey)
}

export function getStickyWeldTableFieldStyle(fieldKey: string, stickyLeft = 0, leadingWidth = 0): CSSProperties | undefined {
  const stickyIndex = STICKY_WELD_TABLE_FIELD_KEYS.indexOf(fieldKey as WeldFieldKey)
  if (stickyIndex === -1) return undefined

  const left = stickyLeft + leadingWidth + STICKY_WELD_TABLE_FIELD_KEYS.slice(0, stickyIndex).reduce((sum, key) => sum + getWeldColumnWidth(key), 0)
  const width = getWeldColumnWidth(fieldKey)
  return {
    left,
    width,
    minWidth: width,
    maxWidth: width,
  }
}
