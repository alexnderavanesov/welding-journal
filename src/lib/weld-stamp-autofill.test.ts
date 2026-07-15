import { describe, expect, it } from 'vitest'
import { getWeldStampAutofillState } from './weld-stamp-autofill'
import type { WeldInput } from './weld-fields'

describe('getWeldStampAutofillState', () => {
  it('fills all stamp fields of index 1 from root stamp 1', () => {
    const state = getWeldStampAutofillState({ stamp1K: 'ABC1' } as WeldInput)

    expect(state.disabledReason).toBeNull()
    expect(state.filledIndexes).toEqual([1])
    expect(state.values).toMatchObject({
      stamp1K: 'ABC1',
      stamp1Z: 'ABC1',
      stamp1O: 'ABC1',
      stamp1KFact: 'ABC1',
      stamp1ZFact: 'ABC1',
      stamp1OFact: 'ABC1',
    })
  })

  it('fills both stamp indexes when both roots are present', () => {
    const state = getWeldStampAutofillState({ stamp1K: 'ABC1', stamp2K: 'DEF2' } as WeldInput)

    expect(state.filledIndexes).toEqual([1, 2])
    expect(state.values.stamp1Z).toBe('ABC1')
    expect(state.values.stamp2Z).toBe('DEF2')
    expect(state.values.stamp2OFact).toBe('DEF2')
  })

  it('is disabled when there is no source root stamp', () => {
    const state = getWeldStampAutofillState({ stamp1Z: 'ABC1' } as WeldInput)

    expect(state.disabledReason).toBe('Сначала укажите Корень_1 или Корень_2.')
    expect(state.changedFieldsCount).toBe(0)
  })
})
