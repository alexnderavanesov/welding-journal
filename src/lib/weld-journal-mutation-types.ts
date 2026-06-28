import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export type StampSelectOptionLike = {
  value: string
}

export type UseWeldJournalMutationsOptions = {
  rows: WeldRow[]
  welderStamps: WelderStampRecord[]
  weldFormStampSelectOptions: Partial<Record<WeldFieldKey, readonly StampSelectOptionLike[]>>
  editingFocusField?: WeldFieldKey
  setEditing: (value: null) => void
  setMessage: (value: string) => void
  highlightChangedRows: (rows: WeldInput[], fieldKeys?: WeldFieldKey[]) => void
  dismissRepeatedJointTask: (task: RepeatedJointTask) => void
}
