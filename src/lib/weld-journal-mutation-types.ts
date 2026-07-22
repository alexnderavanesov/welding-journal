import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export type StampSelectOptionLike = {
  value: string
}

export type UseWeldJournalMutationsOptions = {
  rows: WeldRow[]
  welderStamps: WelderStampRecord[]
  welderStampSuspensions: WelderStampSuspensionRecord[]
  weldFormStampSelectOptions: Partial<Record<WeldFieldKey, readonly StampSelectOptionLike[]>>
  editingFocusField?: WeldFieldKey
  setEditing: (value: null) => void
  setMessage: (value: string) => void
  highlightChangedRows: (rows: Array<{ id?: number }> | undefined, fieldKeys?: WeldFieldKey[]) => void
  dismissRepeatedJointTask: (task: RepeatedJointTask) => void
}
