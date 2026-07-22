import type { WeldFieldKey } from '@/lib/weld-fields'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import type { WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export type OfficialStampCompatibilityIssue = {
  fieldKey: WeldFieldKey
  stamp: string
  method: string
  reason:
    | 'missing-registry'
    | 'archived'
    | 'missing-weld-type'
    | 'weld-type'
    | 'team-weld-type'
    | 'material-group'
    | 'date'
    | 'diameter'
    | 'thickness'
    | 'dls'
    | 'suspended'
  message: string
}

export type OfficialStampCompatibilityOptions = {
  ignoreArchivedMissingRegistry?: boolean
  allowedArchivedOfficialStamps?: readonly string[]
  suspensions?: readonly WelderStampSuspensionRecord[]
  saveCheckSettings?: SaveCheckSettings
}
