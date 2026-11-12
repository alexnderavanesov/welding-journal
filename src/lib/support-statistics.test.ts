import { describe, expect, it } from 'vitest'
import { buildSupportStatistics, buildSupportStatisticsReport, formatSupportLength } from './support-statistics'
import { buildStatisticsServerResult } from './statistics-server-summary'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import type { WeldRow } from './dispatcher-types'
import { captureProgramChainStates } from './line-program-chain-state'
const row = (id: number, joint: string, weldDate: string, vikResult = 'годен', extra: Partial<WeldRow> = {}): WeldRow => ({ id, joint, weldDate, vikResult, hasVik: 'да', connectionType: 'Т', projectTitle: 'P', subtitleCode: 'S', line: 'L', weldLength: 600, ...extra })

describe('support production statistics', () => {
  it('excludes empty factual stamp sentinels while preserving support volume', () => {
    const rows = [
      row(1, 'ОП1', '2026-10-01', 'годен', { stamp1KFact: ' Пусто ' }),
      row(2, 'ОП2', '2026-10-01', 'годен', { stamp1KFact: 'ПУСТО' }),
      row(3, 'ОП3', '2026-10-01', 'годен', { stamp1KFact: 'ABC' }),
      row(4, 'ОП4', '2026-10-01', 'годен'),
    ]
    const summary = buildSupportStatistics(rows, '', '')
    expect(summary).toMatchObject({ physical: 4, produced: 4, lengthMm: '2400' })
    expect(summary.welders).toEqual([expect.objectContaining({ stamp: 'ABC', total: 1, good: 1 })])
    expect(buildSupportStatisticsReport(summary, 'Весь период', 'Все проекты').tables?.[1].rows)
      .toEqual([['ABC', '', 1, 1, 0, 0, 0, 0]])
  })
  it('counts a physical OP in the last repair month and each full repair length in its own month', () => {
    const rows = [row(1, 'ОП1', '2026-09-01', 'ремонт'), row(2, 'ОП1R1', '2026-09-20', 'ремонт'), row(3, 'ОП1R2', '2026-10-03')]
    expect(buildSupportStatistics(rows, '', '')).toMatchObject({ physical: 1, produced: 1, rejected: 0, lengthMm: '600', repairs: 2, repairLengthMm: '1200',
      months: [{ month: '2026-09', physical: 0, produced: 0, repairs: 1, repairLengthMm: '600' }, { month: '2026-10', physical: 1, produced: 1, repairs: 1, repairLengthMm: '600' }] })
    expect(buildSupportStatistics(rows, '2026-09-01', '2026-09-30')).toMatchObject({ physical: 0, produced: 0, repairs: 1 })
    expect(buildSupportStatistics(rows, '2026-10-01', '2026-10-31').rowIds).toEqual({ physical: [3], produced: [3], rejected: [], repairs: [3] })
  })
  it('includes welded waiting control, excludes current rejected volume and preserves count with missing L', () => {
    const rows = [row(1, 'ОП1', '2026-10-01', ''), row(2, 'ОП2', '2026-10-01', 'ремонт'), row(3, 'ОП3', '2026-10-02', 'годен', { weldLength: null }), row(4, 'ОП4', '', '')]
    expect(buildSupportStatistics(rows, '', '')).toMatchObject({ physical: 3, produced: 2, rejected: 1, lengthMm: '600', missingLength: 1, rowIds: { produced: [1, 3], rejected: [2] } })
    const missing = buildSupportStatistics([rows[2]], '', '')
    expect(missing).toMatchObject({ produced: 1, lengthMm: null, missingLength: 1 })
    expect(formatSupportLength(missing.lengthMm, missing.missingLength)).toBe('Не указана')
  })
  it('uses stable repair identity after renaming, rejects unofficial work, and respects duplicate rejection', () => {
    const source = [row(1, 'ОП1', '2026-09-01', 'ремонт'), row(2, 'ОП1R1', '2026-10-02')]
    const states = captureProgramChainStates(source)
    const rows = source.map(row => ({ ...row, programChainState: states.get(row.id)! }))
    rows[1].joint = 'ОП900'
    rows[1].duplicateControls = [{ id: 1, weldJointId: 2, method: 'ВИК', result: 'ремонт' }] as WeldRow['duplicateControls']
    expect(buildSupportStatistics([...rows, row(3, 'ОП2', '2026-10-02', 'годен', { officiality: 'неофициальный' })], '', '')).toMatchObject({ physical: 1, produced: 0, rejected: 1, repairs: 1 })
    expect(buildSupportStatistics([rows[0]], '', '')).toMatchObject({ physical: 1, rejected: 1, repairs: 0 })
  })
  it('adds decimal lengths without per-row rounding and exports incomplete sums explicitly', () => {
    const summary = buildSupportStatistics([row(1, 'ОП1', '2026-10-01', 'годен', { weldLength: '0.1' }), row(2, 'ОП2', '2026-10-01', 'годен', { weldLength: '0,2' }), row(3, 'ОП3', '2026-10-01', 'годен', { weldLength: null })], '', '')
    expect(summary.lengthMm).toBe('0.3')
    const report = buildSupportStatisticsReport(summary, 'Весь период', 'Все проекты')
    expect(report.tables![0].rows[0]).toEqual(['Итого', 3, 3, 0, '0,3 (неполная)', 1, 0, '0', 0])
    expect(JSON.stringify(report)).not.toMatch(/WDI|ВДИ/)
  })
  it('preserves decimal magnitudes beyond IEEE-754 without treating them as missing', () => {
    for (const length of ['1e-400', '1e309']) {
      const summary = buildSupportStatistics([row(1, 'ОП1', '2026-10-01', 'годен', { weldLength: length })], '', '')
      expect(summary.missingLength).toBe(0)
      expect(summary.lengthMm).toBe(length === '1e-400' ? '0.' + '0'.repeat(399) + '1' : '1' + '0'.repeat(309))
    }
  })
  it('keeps supports outside existing production counts and applies project/period before summary output', () => {
    const rows = [row(1, 'ОП1', '2026-10-01'), row(2, 'ОП2', '2026-10-01', 'годен', { projectTitle: 'Other' }), row(3, 'F1', '2026-10-01', 'годен', { connectionType: 'С17', wdi: 5, stamp1KFact: 'A', stamp1ZFact: 'A', })]
    const calculate = (tab: 'general' | 'supports' | 'lineSummary' | 'welders') => buildStatisticsServerResult({ rows, welderStamps: [], systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, request: { tab, from: '', to: '', unit: 'joints', projectFilter: 'p' } })
    expect(calculate('supports').supportSummary).toMatchObject({ physical: 1, produced: 1, lengthMm: '600' })
    expect(calculate('general').summary.welded).toBe(1)
    // 12 November: line summary now includes supports; the other production tabs stay separate.
    expect(calculate('lineSummary').lineSummary.total).toBe(2)
    expect(calculate('welders').welderSummary.total).toBe(1)
  })
})

it('formats only the final length sum: metres with two decimals or whole millimetres', () => {
  expect(formatSupportLength('14052.973456789123456789', 1, { unit: 'm', decimals: 2 })).toBe('14,05 (неполная)')
  expect(formatSupportLength('1600.35', 0, { unit: 'm', decimals: 2 })).toBe('1,60')
  expect(formatSupportLength('9995', 0, { unit: 'm', decimals: 2 })).toBe('10,00')
  expect(formatSupportLength('13652.873456789123456789', 0, { unit: 'mm', decimals: 0 })).toBe('13\u00a0653')
  expect(formatSupportLength('400.1', 0, { unit: 'mm', decimals: 0 })).toBe('400')
  expect(formatSupportLength('999.5', 0, { unit: 'mm', decimals: 0 })).toBe('1\u00a0000')
  expect(formatSupportLength(null, 1, { unit: 'm', decimals: 2 })).toBe('Не указана')
  const summary = buildSupportStatistics([row(1, 'ОП1', '2026-10-01', 'годен', { weldLength: '0.4' }), row(2, 'ОП2', '2026-10-01', 'годен', { weldLength: '0.4' })], '', '')
  expect(summary.lengthMm).toBe('0.8')
  expect(formatSupportLength(summary.lengthMm, 0, { unit: 'mm', decimals: 0 })).toBe('1')
})

it('counts each T welding operation for its factual welder, with repairs, waiting and unofficial work', () => {
  const rows = [
    row(1, 'ОП1', '2026-09-01', 'ремонт', { stamp1KFact: 'A' }),
    row(2, 'ОП1R1', '2026-10-01', 'годен', { stamp1KFact: 'B', stamp1ZFact: 'OLD', }),
    row(3, 'ОП2', '2026-10-01', '', { stamp1KFact: 'A' }),
    row(4, 'ОП3', '2026-10-01', '', { stamp1KFact: 'A', vikRequest: 'V1' }),
    row(5, 'ОП4', '2026-10-01', 'ремонт', { stamp1KFact: 'A', officiality: 'неофициальный' }),
    row(6, 'ОП5', '', 'годен', { stamp1KFact: 'A' }),
    row(7, 'ОП6', '2026-10-01', 'годен'),
    row(8, 'ОП7', '2026-10-01', 'годен', { stamp1KFact: 'A', projectTitle: 'Other' }),
    row(9, 'F1', '2026-10-01', 'годен', { connectionType: 'С17', stamp1KFact: 'A' }),
  ]
  const calculate = (from = '') => buildStatisticsServerResult({ rows, welderStamps: [], systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
    request: { tab: 'supports', projectFilter: 'p', selectedSubtitles: ['s'], from } }).supportSummary!
  const summary = calculate()
  expect(summary.welders).toEqual([
    { stamp: 'B', welderName: '', total: 1, good: 1, waitingRequest: 0, waitingControl: 0, rejected: 0, defectPercent: 0 },
    { stamp: 'A', welderName: '', total: 4, good: 0, waitingRequest: 1, waitingControl: 1, rejected: 2, defectPercent: 100 },
  ])
  expect(calculate('2026-10-01').welders?.find(row => row.stamp === 'A')).toMatchObject({ total: 3, rejected: 1 })
  expect(buildSupportStatisticsReport(summary, 'Весь период', 'P').tables?.[1].rows).toEqual([
    ['B', '', 1, 1, 0, 0, 0, 0], ['A', '', 4, 0, 1, 1, 2, 100],
  ])
})

it('counts only the first factual stamp for T, without fallback to a forbidden second stamp', () => {
  const rows = [
    row(1, 'ОП1', '2026-10-01', 'годен', { stamp1KFact: 'A' }),
    row(2, 'ОП2', '2026-10-01', 'ремонт', { stamp1KFact: 'A' }),
    row(3, 'ОП3', '2026-10-01', '', { stamp1KFact: 'A' }),
    // A forbidden second stamp must not supply the first welder.
    row(4, 'ОП4', '2026-10-01', 'годен', { stamp1ZFact: 'A' }),
  ]
  const summary = buildSupportStatistics(rows, '', '')
  expect(summary.welders).toEqual([
    { stamp: 'A', welderName: '', total: 3, good: 1, waitingRequest: 1, waitingControl: 0, rejected: 1, defectPercent: 50 },
  ])
  expect(buildSupportStatisticsReport(summary, 'Весь период', 'P').tables?.[1].rows).toEqual([
    ['A', '', 3, 1, 1, 0, 1, 50],
  ])
})
