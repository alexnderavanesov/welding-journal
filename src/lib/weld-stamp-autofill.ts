import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export type WeldStampAutofillState = {
  values: Partial<WeldInput>
  changedFieldsCount: number
  filledIndexes: number[]
  disabledReason: string | null
}

const STAMP_INDEX_1_FIELDS = ['stamp1K', 'stamp1Z', 'stamp1O', 'stamp1KFact', 'stamp1ZFact', 'stamp1OFact'] as const satisfies readonly WeldFieldKey[]
const STAMP_INDEX_2_FIELDS = ['stamp2K', 'stamp2Z', 'stamp2O', 'stamp2KFact', 'stamp2ZFact', 'stamp2OFact'] as const satisfies readonly WeldFieldKey[]

export function getWeldStampAutofillState(draft: WeldInput): WeldStampAutofillState {
  const values: Partial<WeldInput> = {}
  const filledIndexes: number[] = []
  const stamp1 = normalizeStampValue(draft.stamp1K)
  const stamp2 = normalizeStampValue(draft.stamp2K)

  if (stamp1) {
    filledIndexes.push(1)
    for (const key of STAMP_INDEX_1_FIELDS) values[key] = stamp1
  }

  if (stamp2) {
    filledIndexes.push(2)
    for (const key of STAMP_INDEX_2_FIELDS) values[key] = stamp2
  }

  if (filledIndexes.length === 0) {
    return {
      values: {},
      changedFieldsCount: 0,
      filledIndexes: [],
      disabledReason: 'Сначала укажите Корень_1 или Корень_2.',
    }
  }

  const changedFieldsCount = Object.entries(values).filter(([key, value]) => normalizeStampValue(draft[key as WeldFieldKey]) !== value).length

  return {
    values,
    changedFieldsCount,
    filledIndexes,
    disabledReason: changedFieldsCount > 0 ? null : 'Клейма уже заполнены.',
  }
}

function normalizeStampValue(value: unknown) {
  return String(value ?? '').trim()
}
