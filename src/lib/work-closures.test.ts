import { expect, it } from 'vitest'
import { closureDisplayFields, closureValueLabel, compareClosureWorkTypes, decodeWorkClosureFilter, migrateClosureColumnFilters, readClosureColumnFilters, workClosureTypeGroups } from './work-closures'
import { journalClipboardValue } from './welding-journal-grid-state'

it('offers all four before-heat methods after every test only on applicable joints and keeps historical positions in that order', () => {
  const tests = ['ГИ', 'ПИ', 'РК']
  const regular = ['Сварка', 'ВИК', 'РК', 'УЗК', 'ПВК', 'ПСТО', 'ТВМТ', 'ГИ', 'ПИ', 'Испытание · РК']
  const beforeHeat = ['ВИК до ТО', 'РК до ТО', 'УЗК до ТО', 'ПВК до ТО']
  const values = (enabled: boolean) => workClosureTypeGroups(tests, enabled).flatMap(group => group.options.map(option => option.value))
  expect(values(false)).toEqual(regular)
  expect(values(true)).toEqual([...regular, ...beforeHeat])
  const historical = ['Архивное испытание', ...regular, ...beforeHeat].reverse().sort(compareClosureWorkTypes)
  expect(historical.slice(-4)).toEqual(beforeHeat)
  expect(historical.slice(0, 7)).toEqual(regular.slice(0, 7))
})

it('reads old closure filters and preserves act numbers as exact strings', () => {
  expect(decodeWorkClosureFilter('{"workType":"Сварка","rateCode":"","actNumber":"001"}'))
    .toEqual({ workType: ['Сварка'], actNumber: ['001'] })
})
it('keeps an explicit empty rate distinct from all rates in a summary drilldown', () => {
  expect(decodeWorkClosureFilter('{"rateCode":[""," A ","A"],"actNumber":["","01","1"]}'))
    .toEqual({ rateCode: ['', 'A'], actNumber: ['', '01', '1'] })
  expect(decodeWorkClosureFilter('{"rateCode":[]}')).toEqual({})
})

it('splits the former combined filter without changing the line, leading zeroes or empty-act condition', () => {
  const columns = migrateClosureColumnFilters({ line: '=L', workClosureSummary: JSON.stringify({
    workType: 'РК', rateCode: ['01', '1'], actEmpty: true,
  }) })
  expect(columns).toEqual({ line: '=L', workClosureSummary: '{"workType":["РК"]}', workClosureRateCode: '{"rateCode":["01","1"]}', workClosureActNumber: '{"actNumber":[""]}' })
  expect(readClosureColumnFilters(columns)).toEqual({ workType: ['РК'], rateCode: ['01', '1'], actNumber: [''] })
  expect(migrateClosureColumnFilters(columns)).toEqual(columns)
})

it('applies the same position numbers and placeholders in each cell and omits the number for a single match', () => {
  const weld = { workType: 'Сварка', rateCode: 'A', actNumber: '' }
  const ndt = { workType: 'РК', rateCode: '', actNumber: '01' }
  expect(closureDisplayFields([ndt, weld])).toEqual({
    workClosureSummary: '1. Сварка, 2. РК', workClosureRateCode: '1. A, 2. —', workClosureActNumber: '1. Без КС3, 2. 01',
  })
  expect(closureDisplayFields([ndt])).toEqual({ workClosureSummary: 'РК', workClosureRateCode: '—', workClosureActNumber: '01' })
})

it.each([['rateCode', 'Без кода'], ['actNumber', 'Без КС3']] as const)('distinguishes an empty %s from the same literal in filters and summaries', (dimension, empty) => {
  expect(closureValueLabel(dimension, '')).toBe(empty)
  expect(closureValueLabel(dimension, empty)).toBe('«' + empty + '»')
})

it('preserves commas and number-like text inside a code in both the grid list and its clipboard value', () => {
  const positions = [
    { workType: 'Сварка', rateCode: '113, 2. доп.', actNumber: '001' },
    { workType: 'РК', rateCode: '004', actNumber: '001' },
  ]
  const grid = closureDisplayFields(positions, 'grid')
  expect(grid.workClosureRateCode.split('\n')).toEqual(['113, 2. доп.', '004'])
  expect(journalClipboardValue({ id: 1 }, 'workClosureRateCode', grid.workClosureRateCode)).toBe('1. 113, 2. доп., 2. 004')
})
