import type { WeldInput } from '@/lib/weld-fields'
import { calculateFinalStatus } from '@/lib/weld-fields'
import { withAutoVikForWeldDate } from '@/lib/weld-import-export'

export function withCalculatedFinalStatus(value: WeldInput) {
  const nextValue = withAutoVikForWeldDate(value)
  return { ...nextValue, finalStatus: calculateFinalStatus(nextValue) }
}

export function getJointTitle(value: WeldInput) {
  const project = String(value.projectTitle ?? '').trim()
  const subtitle = String(value.subtitleCode ?? '').trim()
  const line = String(value.line ?? '').trim()
  const joint = String(value.joint ?? '').trim()

  if (!project && !subtitle && !line && !joint) return 'Проект, шифр, линия и стык появятся после заполнения.'
  return `${project || '-'} · ${subtitle || '-'} · ${line || '-'} · ${joint || '-'}`
}
