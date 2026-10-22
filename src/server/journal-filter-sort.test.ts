import { afterEach, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { normalizeWeldColumnFilterOptions, buildDerivedReportCacheKey } from './weld-read'

afterEach(() => vi.restoreAllMocks())
it('bounds large journal cache keys while preserving exact filter identity and other reports', () => {
  const joint = Array.from({ length: 1000 }, (_, i) => `Стык-${i}`).join(',')
  const key = buildDerivedReportCacheKey('summary', 'weldingJournal', { columnFilters: { joint, line: 'L' } })
  expect(Buffer.byteLength(key)).toBeLessThan(200)
  expect(buildDerivedReportCacheKey('summary', 'weldingJournal', { columnFilters: { line: 'L', joint } })).toBe(key)
  expect(buildDerivedReportCacheKey('summary', 'weldingJournal', { columnFilters: { line: 'Other', joint } })).not.toBe(key)
  expect(buildDerivedReportCacheKey('other', 'weldingJournal', { columnFilters: { line: 'L', joint } })).not.toBe(key)
  expect(buildDerivedReportCacheKey('summary', 'lnk', { columnFilters: { joint } })).toContain(joint)
})
it('retains Russian/numeric order, stable ties, empty values and counts without mutating input', () => {
  const labels = ['', 'Линия-10', 'Линия-2', 'Линия-02', 'линия-2', 'е', 'ё', 'Е', 'Ё', 'A-10', 'A-2', 'А-2', '3,5', '3.5', '№ 12', '№ 2', 'é', 'é']
  const input = labels.map((label, index) => Object.freeze({ value: label, label: label || '(пусто)', count: index + 1 }))
  const snapshot = [...input]
  const previous = normalizeWeldColumnFilterOptions('line', input)
  const compare = vi.spyOn(String.prototype, 'localeCompare')
  const journal = normalizeWeldColumnFilterOptions('line', input, true)
  expect(compare).not.toHaveBeenCalled()
  expect(journal).toEqual(previous)
  expect(journal[0].value).toBe('')
  expect(journal.filter(item => /линия-0?2/i.test(item.value)).map(item => item.value)).toEqual(['Линия-2', 'Линия-02', 'линия-2'])
  expect(input).toEqual(snapshot)
})

it('preserves normalized control choices and leaves the existing sort path as the default', () => {
  const input = [
    { value: '', label: '(пусто)', count: 2 }, { value: 'нет', label: 'нет', count: 3 },
    { value: 'Да', label: 'Да', count: 5 }, { value: 'да', label: 'да', count: 7 },
    { value: 'отменен', label: 'отменен', count: 1 },
  ]
  expect(normalizeWeldColumnFilterOptions('hasRk', input, true)).toEqual(normalizeWeldColumnFilterOptions('hasRk', input))
  const compare = vi.spyOn(String.prototype, 'localeCompare')
  normalizeWeldColumnFilterOptions('line', input)
  expect(compare).toHaveBeenCalled()
})

it.runIf(process.env.JOURNAL_FILTER_SORT_MEASURE === '1')('measures the actual journal facet normalization with the same inputs', () => {
  const measurements = []
  for (const size of [1000, 10000, 50000]) {
    const rows = Array.from({ length: size }, (_, index) => ({ value: String(index), count: 1,
      label: ['Линия', 'Шифр', 'A', 'а', '№'][index % 5] + '-' + (index % 2 ? String(index) : String(index).padStart(6, '0')) }))
    let seed = 42
    for (let index = rows.length - 1; index > 0; index--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const other = seed % (index + 1); [rows[index], rows[other]] = [rows[other], rows[index]]
    }
    expect(normalizeWeldColumnFilterOptions('line', rows, true)).toEqual(normalizeWeldColumnFilterOptions('line', rows))
    const samples: Record<string, number[]> = { before: [], after: [] }
    for (let repeat = 0; repeat < 3; repeat++) for (const name of repeat % 2 ? ['after', 'before'] : ['before', 'after']) {
      const start = performance.now()
      normalizeWeldColumnFilterOptions('line', rows, name === 'after')
      samples[name].push(performance.now() - start)
    }
    measurements.push({ size, samples })
  }
  writeFileSync('/tmp/journal-review-filter-sort-final.json', JSON.stringify({ scope: 'Actual normalization helper, CPU-only synthetic scalar facets, normal CPU; excludes SQL/network; equal order and alternating runs', measurements }, null, 2))
}, 30000)
