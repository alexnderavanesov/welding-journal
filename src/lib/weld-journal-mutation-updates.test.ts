import { beforeEach, describe, expect, it } from 'vitest'
import type { WeldDraft, WeldRow } from './dispatcher-types'
import type { WeldFieldKey } from './weld-fields'
import { loadOtherSettings, saveOtherSettings } from './other-settings'
import { getOfficialStampCompatibilityIssues } from './welder-stamp-compatibility'
import { prepareWeldSaveValue } from './weld-journal-mutation-updates'

const previous: WeldRow = { id: 17, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'S1',
  weldDate: '2026-07-01', connectionType: 'С17', weldingMethod: 'РД', materialGroup: 'М01',
  d1: 108, d2: 108, t1: 6, t2: 6, stamp1K: 'LEGACY-MISSING', isometry: 'OLD' }
const prepare = (value: WeldDraft, rows = [previous]) => prepareWeldSaveValue({ value, rows,
  welderStamps: [], welderStampSuspensions: [] })

beforeEach(() => {
  localStorage.clear()
  saveOtherSettings({ ...loadOtherSettings(), wdiCalculationMode: 'manual' }, { syncRemote: false })
})

describe('legacy incompatible official stamp: unrelated corrections agreed on 27 October', () => {
  for (const key of ['isometry', 'spool', 'weldingJournalNote', 'stamp1KFact', 'stamp1ZFact', 'stamp1OFact',
    'stamp2KFact', 'stamp2ZFact', 'stamp2OFact'] as const) {
    it(`allows ${key} without hiding the existing qualification issue`, () => {
      const result = prepare({ ...previous, [key]: 'CORRECTED' })
      expect(result[key]).toBe('CORRECTED')
      expect(result.stamp1K).toBe('LEGACY-MISSING')
      expect(getOfficialStampCompatibilityIssues(result, []).some(issue => issue.reason === 'missing-registry')).toBe(true)
      expect(previous.isometry).toBe('OLD')
    })
  }

  // List the business inputs independently of the implementation's trigger list.
  const critical: Array<[WeldFieldKey, string | number]> = [
    ['weldDate', '2026-07-02'], ['connectionType', 'С18'], ['weldingMethod', 'РАД'], ['materialGroup', 'М05'],
    ['d1', 159], ['d2', 159], ['t1', 8], ['t2', 8],
    ['stamp1K', 'OTHER'], ['stamp1Z', 'OTHER'], ['stamp1O', 'OTHER'],
    ['stamp2K', 'OTHER'], ['stamp2Z', 'OTHER'], ['stamp2O', 'OTHER'],
  ]
  it.each(critical)('still rejects a changed qualification input %s', (key, value) => {
    expect(() => prepare({ ...previous, [key]: value })).toThrow(/СП-02/)
  })

  it('does not exempt a new record or an edit without a known original record', () => {
    const { id: _id, ...created } = previous
    expect(() => prepare(created, [])).toThrow(/СП-02/)
    expect(() => prepare({ ...previous, isometry: 'CORRECTED' }, [])).toThrow(/СП-02/)
    expect(() => prepare({ ...previous, isometry: 'CORRECTED' }, [{ ...previous, id: 18 }])).toThrow(/СП-02/)
  })
})
