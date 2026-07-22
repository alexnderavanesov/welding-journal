import { describe, expect, it } from 'vitest'
import { getWeldLineAutofillState } from './weld-line-autofill'

describe('getWeldLineAutofillState', () => {
  it('fills line-level metadata and control assignments from the same line', () => {
    const state = getWeldLineAutofillState(
      { line: 'LIN-1', joint: 'S2' },
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
      ],
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
      { line: 'LIN-1' },
      [
        { id: 1, line: 'LIN-1', weldControlPercent: '25', hasRk: 'да' },
        { id: 2, line: 'LIN-1', weldControlPercent: '100', hasRk: '' },
      ],
    )

    expect(state.disabledReason).toContain('Контроль швов, (%)')
    expect(state.disabledReason).not.toContain('Назначение РК')
    expect(state.changedFieldsCount).toBe(0)
  })

  it('uses the same line conflict rule as dispatcher', () => {
    const state = getWeldLineAutofillState(
      { line: 'LIN-1', subtitleCode: '400', weldControlPercent: '', hasRk: '' },
      [
        { id: 1, line: 'LIN-1', subtitleCode: '400', weldControlPercent: '25', hasRk: 'да' },
        { id: 2, line: 'LIN-1', subtitleCode: '400', weldControlPercent: '', hasRk: '' },
      ],
    )

    expect(state.disabledReason).toContain('Контроль швов, (%)')
  })

  it('does not copy selective control assignments on percentage lines', () => {
    const state = getWeldLineAutofillState(
      { line: 'LIN-1', subtitleCode: '400', weldControlPercent: '', hasRk: '' },
      [
        { id: 1, line: 'LIN-1', subtitleCode: '400', weldControlPercent: '25', hasVik: 'да', hasRk: 'да' },
        { id: 2, line: 'LIN-1', subtitleCode: '400', weldControlPercent: '25', hasRk: '' },
      ],
    )

    expect(state.disabledReason).toBeNull()
    expect(state.values.weldControlPercent).toBe('25')
    expect(state.values.hasVik).toBe('да')
    expect(state.values.hasRk).toBeUndefined()
  })

  it('sets VIK to yes on percentage lines even when source VIK is empty', () => {
    const state = getWeldLineAutofillState(
      { line: 'LIN-1', subtitleCode: '400' },
      [
        { id: 1, line: 'LIN-1', subtitleCode: '400', weldControlPercent: '10', hasRk: 'да' },
        { id: 2, line: 'LIN-1', subtitleCode: '400', weldControlPercent: '10', hasRk: '' },
      ],
    )

    expect(state.disabledReason).toBeNull()
    expect(state.values.weldControlPercent).toBe('10')
    expect(state.values.hasVik).toBe('да')
    expect(state.values.hasRk).toBeUndefined()
  })

  it('asks to clarify subtitle when one line has multiple subtitle sources', () => {
    const state = getWeldLineAutofillState(
      { line: 'LIN-1' },
      [
        { id: 1, line: 'LIN-1', subtitleCode: '400', weldControlPercent: '25' },
        { id: 2, line: 'LIN-1', subtitleCode: '500', weldControlPercent: '25' },
      ],
    )

    expect(state.disabledReason).toContain('Уточните')
    expect(state.disabledReason).toContain('Шифр')
  })

  it('asks to clarify project when one line has multiple project sources', () => {
    const state = getWeldLineAutofillState(
      { line: 'LIN-1', subtitleCode: '400' },
      [
        { id: 1, line: 'LIN-1', projectTitle: 'Проект A', subtitleCode: '400', weldControlPercent: '25' },
        { id: 2, line: 'LIN-1', projectTitle: 'Проект B', subtitleCode: '400', weldControlPercent: '25' },
      ],
    )

    expect(state.disabledReason).toContain('Уточните')
    expect(state.disabledReason).toContain('Проект')
  })

  it('ignores the currently edited row when checking line conflicts', () => {
    const state = getWeldLineAutofillState(
      { id: 2, line: 'LIN-1', weldControlPercent: '' },
      [
        { id: 1, line: 'LIN-1', weldControlPercent: '25' },
        { id: 2, line: 'LIN-1', weldControlPercent: '' },
      ],
    )

    expect(state.disabledReason).toBeNull()
    expect(state.values.weldControlPercent).toBe('25')
  })

  it('keeps the button enabled when source data already matches the draft', () => {
    const state = getWeldLineAutofillState(
      { line: 'LIN-1', subtitleCode: '400', weldControlPercent: '25', hasVik: 'да' },
      [{ id: 1, line: 'LIN-1', subtitleCode: '400', weldControlPercent: '25' }],
    )

    expect(state.disabledReason).toBeNull()
    expect(state.changedFieldsCount).toBe(0)
  })

  it('uses the selected subtitle to disambiguate source rows on the same line', () => {
    const state = getWeldLineAutofillState(
      { line: 'LIN-1', subtitleCode: '400' },
      [
        {
          id: 1,
          line: 'LIN-1',
          projectTitle: 'Риформинг',
          subtitleCode: '400',
          weldControlPercent: '25',
        },
        {
          id: 2,
          line: 'LIN-1',
          projectTitle: 'Риформинг',
          subtitleCode: '500',
          weldControlPercent: '100',
        },
      ],
    )

    expect(state.disabledReason).toBeNull()
    expect(state.values).toMatchObject({
      projectTitle: 'Риформинг',
      subtitleCode: '400',
      weldControlPercent: '25',
    })
  })

  it('uses the selected project and subtitle to fill the exact project-subtitle-line source', () => {
    const state = getWeldLineAutofillState(
      { line: 'LIN-1', projectTitle: 'Проект B', subtitleCode: '400' },
      [
        {
          id: 1,
          line: 'LIN-1',
          projectTitle: 'Проект A',
          subtitleCode: '400',
          groupName: 'A',
          weldControlPercent: '25',
        },
        {
          id: 2,
          line: 'LIN-1',
          projectTitle: 'Проект B',
          subtitleCode: '400',
          groupName: 'B',
          weldControlPercent: '10',
        },
      ],
    )

    expect(state.disabledReason).toBeNull()
    expect(state.values).toMatchObject({
      projectTitle: 'Проект B',
      subtitleCode: '400',
      groupName: 'B',
      weldControlPercent: '10',
      hasVik: 'да',
    })
  })

  it('blocks autofill when a selected subtitle has no source rows on the same line', () => {
    const state = getWeldLineAutofillState(
      { line: 'LIN-1', subtitleCode: '400' },
      [
        {
          id: 1,
          line: 'LIN-1',
          projectTitle: 'Риформинг',
          subtitleCode: '500',
          weldControlPercent: '25',
        },
      ],
    )

    expect(state.disabledReason).toContain('Нет других стыков с такой линией')
    expect(state.disabledReason).toContain('Шифр')
  })
})
