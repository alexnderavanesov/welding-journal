import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_OTHER_SETTINGS, saveOtherSettings } from './other-settings'
import {
  buildImportTemplateXlsxBytes,
  buildMassFillTemplateXlsxBytes,
  getReportImportCheckedFieldKeys,
  getReportImportCellKind,
  getReportImportIgnoredFieldKeys,
  stripIgnoredImportFields,
} from './report-import-template'

const WORK_CODE_AND_ACCEPTANCE_KEYS = [
  'testContour',
  'testDate',
  'boq',
  'testBoq',
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
  'testKs3',
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
  afterEach(() => {
    saveOtherSettings(DEFAULT_OTHER_SETTINGS)
  })

  it('keeps work code and acceptance fields editable in the welding journal import', () => {
    for (const fieldKey of WORK_CODE_AND_ACCEPTANCE_KEYS) {
      expect(getReportImportCellKind('weldingJournal', fieldKey)).toBe('free')
    }
  })

  it('imports work code and acceptance values instead of stripping them as service fields', () => {
    const record = Object.fromEntries(WORK_CODE_AND_ACCEPTANCE_KEYS.map((fieldKey) => [fieldKey, `${fieldKey}-value`]))

    expect(stripIgnoredImportFields(record, 'weldingJournal')).toEqual(record)
  })

  it('marks WDI as a grey ignored field in system mode', () => {
    expect(getReportImportCellKind('weldingJournal', 'wdi')).toBe('free')

    saveOtherSettings({
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'formula',
    })

    expect(getReportImportCellKind('weldingJournal', 'wdi')).toBe('ignored')
    expect(getReportImportIgnoredFieldKeys('weldingJournal').has('wdi')).toBe(true)
    expect(getReportImportCheckedFieldKeys('weldingJournal').has('wdi')).toBe(false)
    expect(stripIgnoredImportFields({ d1: 50.8, wdi: 999 }, 'weldingJournal')).toEqual({ d1: 50.8 })
  })

  it('uses one dedicated header style for mass fill template headers', () => {
    const bytes = buildMassFillTemplateXlsxBytes('weldingJournal', [{ id: 1, joint: 'S1' } as never])
    const payload = new TextDecoder().decode(bytes)

    expect(payload).toContain('fgColor rgb="FFDCEBFA"')
    expect(payload).toContain('<c r="A1" t="inlineStr" s="1"><is><t>ID записи</t></is></c>')
    expect(payload).toContain('<c r="N1" t="inlineStr" s="1"><is><t>Стык</t></is></c>')
    expect(payload).toContain('<c r="N2" t="inlineStr" s="2"><is><t>S1</t></is></c>')
  })

  it('marks WDI column as grey in system import templates', () => {
    saveOtherSettings({
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'formula',
    })
    const bytes = buildImportTemplateXlsxBytes('weldingJournal')
    const payload = new TextDecoder().decode(bytes)
    const wdiHeader = payload.match(/<c r="([A-Z]+)1" t="inlineStr" s="1"><is><t>WDI<\/t><\/is><\/c>/)

    expect(wdiHeader?.[1]).toBeTruthy()
    expect(payload).toContain(`<c r="${wdiHeader?.[1]}2" s="2"/>`)
  })
})
