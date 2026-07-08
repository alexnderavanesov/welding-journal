import type { WeldInput } from '@/lib/weld-fields'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'

export function getDuplicateControls(row: WeldInput): DuplicateControlRecord[] {
  return Array.isArray((row as { duplicateControls?: unknown }).duplicateControls)
    ? ((row as { duplicateControls: DuplicateControlRecord[] }).duplicateControls ?? [])
    : []
}

export function getRejectedDuplicateControls(row: WeldInput) {
  return getDuplicateControls(row).filter((control) => control.result === 'ремонт' || control.result === 'вырез')
}

export function hasRejectedDuplicateControl(row: WeldInput) {
  return getRejectedDuplicateControls(row).length > 0
}

export function formatDuplicateControlResult(control: Pick<DuplicateControlRecord, 'method' | 'result'>) {
  return `${control.method} (дубль) - ${control.result}`
}

export function getDuplicateControlSummary(row: WeldInput) {
  const controls = getDuplicateControls(row)
  if (controls.length === 0) return ''
  return controls.map((control) => `${control.method}: ${control.result}`).join('; ')
}
