import { describe, expect, it } from 'vitest'
import { getWeldLineAutofillState } from './weld-line-autofill'
import type { WeldInput } from './weld-fields'

describe('getWeldLineAutofillState', () => {
  it('fills line-level metadata and control assignments from the same line', () => {
    const state = getWeldLineAutofillState(
      { line: 'LIN-1', joint: 'S2' } as WeldInput,
      [
        {
          id: 1,
          line: 'LIN-1',
          projectTitle: 'Риформинг',
          subtitleCode: '400',
          groupName: 'A',
          category: 'I',
          weldControlPercent: '100',
          hasVik: 'да',
          hasRk: 'да',
        },
      ] as WeldInput[],
    )

    expect(state.disabledReason).toBeNull()
    expect(state.values).toMatchObject({
      projectTitle: 'Риформинг',
      subtitleCode: '400',
      groupName: 'A',
      category: 'I',
      weldControlPercent: '100',
      hasVik: 'да',
      hasRk: 'да',
    })
  })

  it('blocks autofill when existing source rows have different line data', () => {
    const state = getWeldLineAutofillState(
      { line: 'LIN-1' } as WeldInput,
      [
        { id: 1, line: 'LIN-1', weldControlPercent: '25', hasRk: 'да' },
        { id: 2, line: 'LIN-1', weldControlPercent: '100', hasRk: '' },
      ] as WeldInput[],
    )

    expect(state.disabledReason).toContain('Контроль швов, (%)')
    expect(state.disabledReason).toContain('Назначение РК')
    expect(state.changedFieldsCount).toBe(0)
  })

  it('ignores the currently edited row when checking line conflicts', () => {
    const state = getWeldLineAutofillState(
      { id: 2, line: 'LIN-1', weldControlPercent: '' } as WeldInput,
      [
        { id: 1, line: 'LIN-1', weldControlPercent: '25' },
        { id: 2, line: 'LIN-1', weldControlPercent: '' },
      ] as WeldInput[],
    )

    expect(state.disabledReason).toBeNull()
    expect(state.values.weldControlPercent).toBe('25')
  })
})
