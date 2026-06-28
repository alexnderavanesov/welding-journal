import type { WeldFieldKey } from '@/lib/weld-fields'

export type OfficialStampCompatibilityIssue = {
  fieldKey: WeldFieldKey
  stamp: string
  method: string
  reason: 'missing-registry' | 'missing-weld-type' | 'weld-type' | 'date' | 'diameter'
  message: string
}

export type OfficialStampCompatibilityOptions = {
  ignoreArchivedMissingRegistry?: boolean
}
