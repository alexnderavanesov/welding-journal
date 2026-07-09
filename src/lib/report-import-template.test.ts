import { describe, expect, it } from 'vitest'
import {
  getReportImportCellKind,
  stripIgnoredImportFields,
} from './report-import-template'

const WORK_CODE_AND_ACCEPTANCE_KEYS = [
  'boq',
  'pstoBoq',
  'vikBoq',
  'rkBoq',
  'uzkBoq',
  'pvkBoq',
  'tvmtBoq',
  'rfaBoq',
  'stlsBoq',
  'mkkBoq',
  'ks3',
  'pstoKs3',
  'vikKs3',
  'rkKs3',
  'uzkKs3',
  'pvkKs3',
  'tvmtKs3',
  'rfaKs3',
  'stlsKs3',
  'mkkKs3',
] as const

describe('welding journal import template', () => {
  it('keeps work code and acceptance fields editable in the welding journal import', () => {
    for (const fieldKey of WORK_CODE_AND_ACCEPTANCE_KEYS) {
      expect(getReportImportCellKind('weldingJournal', fieldKey)).toBe('free')
    }
  })

  it('imports work code and acceptance values instead of stripping them as service fields', () => {
    const record = Object.fromEntries(WORK_CODE_AND_ACCEPTANCE_KEYS.map((fieldKey) => [fieldKey, `${fieldKey}-value`]))

    expect(stripIgnoredImportFields(record, 'weldingJournal')).toEqual(record)
  })
})
