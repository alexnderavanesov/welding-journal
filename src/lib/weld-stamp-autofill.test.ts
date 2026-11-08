import { describe, expect, it } from 'vitest'
import { getWeldStampAutofillState } from './weld-stamp-autofill'

describe('factual stamp autofill', () => {
  it('copies each official stamp only into its own empty factual field', () => {
    expect(getWeldStampAutofillState({ stamp1K: ' A ', stamp1Z: 'B' })).toMatchObject({
      values: { stamp1KFact: 'A', stamp1ZFact: 'B' }, changedFieldsCount: 2, filledIndexes: [1, 2], disabledReason: null,
    })
  })
  it('preserves a different factual welder and never creates a second official stamp', () => {
    expect(getWeldStampAutofillState({ stamp1K: 'A', stamp1KFact: 'B', stamp1Z: 'C' }).values).toEqual({ stamp1ZFact: 'C' })
    expect(getWeldStampAutofillState({ stamp1K: 'A' }).values).toEqual({ stamp1KFact: 'A' })
  })
  it('handles empty sentinels and is idempotent', () => {
    const draft = { stamp1K: 'A', stamp1KFact: 'Пусто', stamp1Z: 'Пусто' }
    const first = getWeldStampAutofillState(draft)
    expect(first.values).toEqual({ stamp1KFact: 'A' })
    expect(getWeldStampAutofillState({ ...draft, ...first.values }).changedFieldsCount).toBe(0)
    expect(getWeldStampAutofillState({}).disabledReason).toBeTruthy()
  })
  it('never fills the forbidden second pair of a T draft', () => {
    expect(getWeldStampAutofillState({ connectionType: 'Т1', stamp1K: 'A', stamp1Z: 'B' }).values).toEqual({ stamp1KFact: 'A' })
  })
})
