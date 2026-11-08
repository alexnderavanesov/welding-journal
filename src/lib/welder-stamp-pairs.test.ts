import { describe, expect, it } from 'vitest'
import { buildIncompleteWelderStampGroupTasks } from './repeated-joint-check-tasks'
import { getDispatcherTaskCode } from './dispatcher-settings'
import { buildWelderStatisticsSummary } from './welder-statistics-summary'
import { buildWeldingDynamics } from './welding-dynamics'
import type { WeldRow } from './dispatcher-types'
import { FIELD_BY_KEY } from './weld-fields'
import { parseImportCell } from './weld-import-parsers'
import { normalizeWeldInput } from './weld-record-transforms'

const keys = ['stamp1K', 'stamp1KFact', 'stamp1Z', 'stamp1ZFact'] as const
const row = (mask: number): WeldRow => ({ id: 1, joint: 'F1', connectionType: 'С17', weldDate: '2026-07-01',
  ...Object.fromEntries(keys.map((key, index) => [key, mask & (1 << index) ? `DIFFERENT-${index}` : ' '])) })

describe('independent stamp pairs', () => {
  it.each(Array.from({ length: 16 }, (_, i) => i))('warns exactly for each half-filled pair: mask %i', mask => {
    const tasks = buildIncompleteWelderStampGroupTasks([row(mask)])
    const incomplete = [0, 2].filter(offset => Boolean(mask & (1 << offset)) !== Boolean(mask & (2 << offset)))
    expect(tasks).toHaveLength(incomplete.length)
    expect(tasks.map(task => task.reason)).toEqual(incomplete.map(offset => `дозаполнить клейма_${offset / 2 + 1}`))
    for (const task of tasks) {
      expect(getDispatcherTaskCode(task)).toBe('СП-03')
      expect(task.details).toContain('Напоминание не запрещает сохранение')
    }
  })
  it('keeps the date reminder independent and ignores an unused pair', () => {
    const tasks = buildIncompleteWelderStampGroupTasks([{ ...row(1), weldDate: null }])
    expect(tasks.map(task => task.reason)).toEqual(['дозаполнить дату сварки', 'дозаполнить клейма_1'])
  })
  it.each([0, 1, 2, 3])('T checks only its first pair: mask %i', mask => {
    const tasks = buildIncompleteWelderStampGroupTasks([{ ...row(mask), connectionType: 'Т1', joint: 'ОП-1' }])
    expect(tasks).toHaveLength(mask === 1 || mask === 2 ? 1 : 0)
  })
  it.each([null, undefined, '', ' \t ', 'Пусто', ' \tПуСтО\n ', '-', ' - '])('recognizes empty stamp %j in either side of each applicable pair', empty => {
    for (const [connectionType, official, factual, pair] of [
      ['С17', 'stamp1K', 'stamp1KFact', 1],
      ['С17', 'stamp1Z', 'stamp1ZFact', 2],
      ['Т1', 'stamp1K', 'stamp1KFact', 1],
    ] as const) {
      const source: WeldRow = { id: 1, joint: connectionType === 'Т1' ? 'ОП-1' : 'F1', connectionType, weldDate: '2026-07-01' }
      for (const values of [{ [official]: 'A', [factual]: empty }, { [official]: empty, [factual]: 'B' }]) {
        const tasks = buildIncompleteWelderStampGroupTasks([{ ...source, ...values }])
        expect(tasks.map(task => task.reason)).toEqual([`дозаполнить клейма_${pair}`])
        expect(tasks.map(getDispatcherTaskCode)).toEqual(['СП-03'])
      }
      for (const weldDate of [null, source.weldDate]) {
        expect(buildIncompleteWelderStampGroupTasks([{ ...source, weldDate, [official]: empty, [factual]: empty }])).toEqual([])
      }
    }
  })
  it('keeps the missing-date and pair reminders after importing an empty factual placeholder', () => {
    const parsedFact = parseImportCell(FIELD_BY_KEY.get('stamp1KFact')!, ' Пусто ')
    const stored = normalizeWeldInput({ stamp1K: 'A', stamp1KFact: parsedFact })
    expect(stored.stamp1KFact).toBe('Пусто')
    const source: WeldRow = { id: 1, joint: 'F1', connectionType: 'С17', ...stored }
    expect(buildIncompleteWelderStampGroupTasks([source]).map(task => task.reason)).toEqual([
      'дозаполнить дату сварки', 'дозаполнить клейма_1',
    ])
    expect(source.stamp1KFact).toBe('Пусто')
  })
  it.each(['joints', 'wdi'] as const)('attributes one, repeated, two or no factual stamps consistently (%s)', unit => {
    const base: WeldRow = { id: 1, joint: 'F1', weldDate: '2026-07-01', wdi: 10, stamp1K: 'OFFICIAL' }
    const weight = unit === 'joints' ? 1 : 10
    for (const [facts, expected] of [
      [{ stamp1KFact: 'A' }, [['A', weight]]],
      [{ stamp1ZFact: 'A' }, [['A', weight]]],
      [{ stamp1KFact: 'A', stamp1ZFact: 'a' }, [['a', weight]]],
      [{ stamp1KFact: 'A', stamp1ZFact: 'B' }, [['A', weight / 2], ['B', weight / 2]]],
      [{}, []],
    ] as const) {
      const source = [{ ...base, ...facts }]
      const summary = buildWelderStatisticsSummary(source, [], '2026-07-01', '2026-07-31', unit)
      expect(summary.rows.map(item => [item.stamp, item.total])).toEqual(expected)
      expect(buildWeldingDynamics(source, '2026-07-01', '2026-07-31', unit).totalValue).toBe(weight)
    }
  })
})
