import { describe, expect, it } from 'vitest'
import { getWeldFormSuggestions } from './weld-form-suggestions'
import type { WeldInput } from './weld-fields'

describe('getWeldFormSuggestions', () => {
  it('filters values by any part of text without case sensitivity', () => {
    const rows = [
      { line: 'LIN-243-11-31', projectTitle: 'Риформинг', joint: 'F1' },
      { line: 'ABC-100', projectTitle: 'Другой', joint: 'S1' },
    ] as WeldInput[]

    const suggestions = getWeldFormSuggestions({
      fieldKey: 'line',
      value: '243',
      draft: {},
      rows,
    })

    expect(suggestions.map((suggestion) => suggestion.value)).toEqual(['LIN-243-11-31'])
  })

  it('prioritizes values that match current draft context', () => {
    const rows = [
      { line: 'LINE-OTHER', projectTitle: 'Другой', subtitleCode: '100', joint: 'S1' },
      { line: 'LINE-CURRENT', projectTitle: 'Риформинг', subtitleCode: '400', joint: 'F1' },
    ] as WeldInput[]

    const suggestions = getWeldFormSuggestions({
      fieldKey: 'line',
      value: 'line',
      draft: { projectTitle: 'Риформинг', subtitleCode: '400' },
      rows,
    })

    expect(suggestions[0]?.value).toBe('LINE-CURRENT')
  })

  it('shares suggestions between paired material and size fields', () => {
    const rows = [
      {
        material1: '09Г2С',
        element2: 'Труба',
        d1: 57,
        t2: 4,
        projectTitle: 'Риформинг',
        subtitleCode: '400',
        line: 'LIN-1',
        joint: 'F1',
      },
    ] as WeldInput[]

    expect(
      getWeldFormSuggestions({
        fieldKey: 'material2',
        value: '09',
        draft: {},
        rows,
      }).map((suggestion) => suggestion.value),
    ).toEqual(['09Г2С'])

    expect(
      getWeldFormSuggestions({
        fieldKey: 'element1',
        value: 'тру',
        draft: {},
        rows,
      }).map((suggestion) => suggestion.value),
    ).toEqual(['Труба'])

    expect(
      getWeldFormSuggestions({
        fieldKey: 'd2',
        value: '57',
        draft: {},
        rows,
      }).map((suggestion) => suggestion.value),
    ).toEqual(['57'])

    expect(
      getWeldFormSuggestions({
        fieldKey: 't1',
        value: '4',
        draft: {},
        rows,
      }).map((suggestion) => suggestion.value),
    ).toEqual(['4'])
  })

  it('does not show suggestions for joint and WDI fields', () => {
    const rows = [{ joint: 'S1', wdi: 10, line: 'LIN-1' }] as WeldInput[]

    expect(
      getWeldFormSuggestions({
        fieldKey: 'joint',
        value: 'S',
        draft: {},
        rows,
      }),
    ).toEqual([])

    expect(
      getWeldFormSuggestions({
        fieldKey: 'wdi',
        value: '1',
        draft: {},
        rows,
      }),
    ).toEqual([])
  })
})
