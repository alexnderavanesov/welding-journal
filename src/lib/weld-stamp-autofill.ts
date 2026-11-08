import { isTConnectionType } from './connection-type'
import type { WeldInput } from './weld-fields'

export type WeldStampAutofillState = {
  values: Partial<WeldInput>
  changedFieldsCount: number
  filledIndexes: number[]
  disabledReason: string | null
}

export function getWeldStampAutofillState(draft: WeldInput): WeldStampAutofillState {
  const values: Partial<WeldInput> = {}
  const filledIndexes: number[] = []
  const pairs = [
    ['stamp1K', 'stamp1KFact'],
    ['stamp1Z', 'stamp1ZFact'],
  ] as const
  pairs.forEach(([official, factual], index) => {
    if (index === 1 && isTConnectionType(draft.connectionType)) return
    const value = normalizeStampValue(draft[official])
    if (!value || normalizeStampValue(draft[factual])) return
    values[factual] = value
    filledIndexes.push(index + 1)
  })
  const changedFieldsCount = Object.keys(values).length
  return {
    values, changedFieldsCount, filledIndexes,
    disabledReason: changedFieldsCount ? null : 'Нет пустых фактических полей с заполненным официальным клеймом.',
  }
}

function normalizeStampValue(value: unknown) {
  const text = String(value ?? '').trim()
  return text.toLocaleLowerCase('ru') === 'пусто' ? '' : text
}
