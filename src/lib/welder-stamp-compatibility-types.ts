import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export type OfficialStampCompatibilityIssue = {
  fieldKey: WeldFieldKey
  stamp: string
  method: string
  reason: 'missing-registry' | 'missing-weld-type' | 'weld-type' | 'date' | 'diameter' | 'suspended'
  message: string
}

export type OfficialStampCompatibilityOptions = {
  ignoreArchivedMissingRegistry?: boolean
  allowedArchivedOfficialStamps?: readonly string[]
  suspensions?: readonly WelderStampSuspensionRecord[]
}
