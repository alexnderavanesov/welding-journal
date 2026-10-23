import { afterEach, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { prepareJournalPageRows, prepareReportRows } from './use-report-rows'
import { DEFAULT_OTHER_SETTINGS, type OtherSettings } from './other-settings'
import type { WeldRow } from './dispatcher-types'
import * as fields from './weld-fields'
import * as wdi from './wdi'

afterEach(() => vi.restoreAllMocks())
const variants: Partial<WeldRow>[] = [
  { weldDate: null, joint: 'F1R1', finalStatus: 'ожидает ремонт' },
  { hasVik: null, hasRk: 'да', rkRequest: 'РК-1', rkResult: null },
  { hasRk: 'да', rkResult: 'ремонт', finalStatus: 'ожидает ремонт' },
  { hasRk: 'отменен', rkRequest: 'РК-1', rkResult: 'годен', finalStatus: 'годен' },
  { hasRk: null, rkResult: 'ожидает заявку' },
  { pstoRequired: 'да', pstoRequest: 'П-1', pstoResult: null },
  { pstoRequired: 'отменен', pstoResult: 'проведено', finalStatus: 'ошибка' },
  { preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', result: 'ремонт' }] } as Partial<WeldRow>,
  { duplicateControls: [{ id: 2, weldJointId: 1, method: 'РК', result: 'годен' }] } as Partial<WeldRow>,
  { joint: 'F1W1', finalStatus: 'ожидает сварку', weldDate: null, earlyCoilDecisionAccepted: true },
  { connectionType: 'У17', d1: 57, d2: 108, t1: 4, t2: 8 },
  { d1: null, d2: null, wdi: null, finalStatus: null },
]
function source(count: number, settings: OtherSettings) {
  return Array.from({ length: count }, (_, index) => {
    const row = { id: index + 1, projectTitle: 'Journal preparation', subtitleCode: 'J', line: `L${index % 10}`,
      joint: `F${index}`, weldDate: '2026-10-01', hasVik: 'да', vikResult: 'годен',
      finalStatus: 'годен', wdi: 3.5, connectionType: 'С17', d1: 108, d2: 108, t1: 4, t2: 4,
      ...variants[index % variants.length] } as WeldRow
    return wdi.isSystemWdiMode(settings) ? wdi.withSystemWdi(row, settings) : row
  })
}
const oldPagePreparation = (rows: WeldRow[], settings: OtherSettings) =>
  prepareReportRows(rows, [], undefined, undefined, settings, true).map((row, index) => ({ ...row, finalStatus: rows[index].finalStatus }))

it.each(['lnk', 'heatTreatment'] as const)('preserves %s preparation, primary facts and authoritative status without partial-chain recalculation', report => {
  const settings = DEFAULT_OTHER_SETTINGS, rows = source(120, settings)
  const expected = prepareReportRows(rows, [], undefined, undefined, settings, true, report === 'heatTreatment')
    .map((row, index) => ({ ...row, finalStatus: rows[index].finalStatus, wdi: rows[index].wdi }))
  const status = vi.spyOn(fields, 'calculateFinalStatusInRows')
  expect(prepareJournalPageRows(rows, report)).toEqual(expected)
  expect(status).not.toHaveBeenCalled()
})

it.each(['manual', 'formula', 'table'] as const)('preserves every prepared field and authoritative status/WDI in %s mode', mode => {
  const settings: OtherSettings = { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: mode, wdiTable: {
    fileName: 'fixture', uploadedAt: '', diameters: [57, 108], thicknesses: [4, 8], values: [[2, 3], [4, 5]],
  } }
  const rows = source(120, settings), snapshot = structuredClone(rows)
  const actual = prepareJournalPageRows(rows)
  expect(actual).toEqual(oldPagePreparation(rows, settings))
  expect(rows).toEqual(snapshot)
  expect(actual[0]).toMatchObject({ finalStatus: 'ожидает ремонт', weldDate: null })
  expect(actual[1]).toMatchObject({ hasVik: true, rkResult: 'ожидает НК' })
  expect(actual[3]).toMatchObject({ hasRk: 'отменен', rkResult: 'годен · назначение отменено' })
  expect(actual[6]).toMatchObject({ pstoResult: 'проведено · назначение отменено', finalStatus: 'ошибка' })
  for (let index = 0; index < rows.length; index++) {
    expect(actual[index].wdi).toBe(rows[index].wdi)
    expect(actual[index].finalStatus).toBe(rows[index].finalStatus)
  }
})

it('does not rebuild chain status context or recalculate already prepared WDI for a page', () => {
  const settings: OtherSettings = { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula' }
  const rows = source(100, settings)
  const context = vi.spyOn(fields, 'buildFinalStatusRowsContext')
  const status = vi.spyOn(fields, 'calculateFinalStatusInRows')
  const systemWdi = vi.spyOn(wdi, 'withSystemWdi')
  oldPagePreparation(rows, settings)
  expect(context).toHaveBeenCalledTimes(1); expect(status).toHaveBeenCalledTimes(100); expect(systemWdi).toHaveBeenCalledTimes(100)
  vi.clearAllMocks()
  prepareJournalPageRows(rows)
  expect(context).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled(); expect(systemWdi).not.toHaveBeenCalled()
  expect(prepareJournalPageRows([])).toEqual([])
})

// Opt-in CPU comparison of the changed preparation only. SQL/network and the
// first authoritative WDI calculation are deliberately outside these timings.
it.runIf(process.env.JOURNAL_PREP_MEASURE === '1')('measures identical page preparation before/after', () => {
  const settings: OtherSettings = { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula' }
  const measurements = []
  for (const size of [100, 1000]) {
    const rows = source(size, settings)
    expect(prepareJournalPageRows(rows)).toEqual(oldPagePreparation(rows, settings))
    for (let warm = 0; warm < 3; warm++) { oldPagePreparation(rows, settings); prepareJournalPageRows(rows) }
    const samples: Record<string, number[]> = { before: [], after: [] }
    for (let repeat = 0; repeat < 9; repeat++) for (const name of repeat % 2 ? ['after', 'before'] : ['before', 'after']) {
      const start = performance.now()
      if (name === 'before') oldPagePreparation(rows, settings)
      else prepareJournalPageRows(rows)
      samples[name].push(performance.now() - start)
    }
    measurements.push({ size, samples })
  }
  writeFileSync('/tmp/journal-review-preparation.json', JSON.stringify({ scope: 'CPU-only mixed page preparation, same process, alternating order, normal CPU', measurements }, null, 2))
  console.log('JOURNAL_PREPARATION', JSON.stringify(measurements))
})
