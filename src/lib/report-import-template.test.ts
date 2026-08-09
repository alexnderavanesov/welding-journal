import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_OTHER_SETTINGS, saveOtherSettings } from './other-settings'
import {
  buildImportTemplateXlsxBytes,
  buildMassFillTemplateXlsxBytes,
  buildReplaceDataTemplateXlsxBytes,
  canEditReportSpecificNote,
  getReportImportTemplateFields,
  getReportImportCheckedFieldKeys,
  getReportImportCellKind,
  getReportImportIgnoredFieldKeys,
  isMassFillFieldLocked,
  isSystemImportField,
  stripIgnoredImportFields,
} from './report-import-template'
import { FIELD_BY_KEY } from './weld-fields'

const WORK_CODE_AND_ACCEPTANCE_KEYS = [
  'testContour',
  'testDate',
  'piDate',
  'boq',
  'testBoq',
  'piBoq',
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
  'piKs3',
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

const WELDING_MATERIAL_KEYS = [
  'technologyCardNumber',
  'weldingElectrodes',
  'weldingElectrodesCertificateNumber',
  'fillerWire',
  'fillerWireCertificateNumber',
  'shieldingGas',
  'shieldingGasCertificateNumber',
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

  it('keeps GI and PI fields in welding journal import templates', () => {
    const testingFieldKeys = ['testTypes', 'testContour', 'testDate', 'piDate', 'testBoq', 'piBoq', 'testKs3', 'piKs3']

    for (const fieldKey of testingFieldKeys) {
      expect(getReportImportTemplateFields('weldingJournal').some((field) => field.key === fieldKey)).toBe(true)
    }
  })

  it('keeps welding material fields editable in welding journal import templates', () => {
    for (const fieldKey of WELDING_MATERIAL_KEYS) {
      expect(getReportImportTemplateFields('weldingJournal').some((field) => field.key === fieldKey)).toBe(true)
      expect(getReportImportCellKind('weldingJournal', fieldKey)).toBe('free')
    }
  })

  it('keeps report notes in their own reports and exposes grey note columns in journal imports', () => {
    expect(getReportImportCellKind('weldingJournal', 'weldingJournalNote')).toBe('free')
    expect(getReportImportTemplateFields('weldingJournal').some((field) => field.key === 'weldingJournalNote')).toBe(true)
    expect(getReportImportTemplateFields('weldingJournal').some((field) => field.key === 'lnkNote')).toBe(true)
    expect(getReportImportTemplateFields('weldingJournal').some((field) => field.key === 'pstoNote')).toBe(true)
    expect(getReportImportCellKind('weldingJournal', 'lnkNote')).toBe('ignored')
    expect(getReportImportCellKind('weldingJournal', 'pstoNote')).toBe('ignored')

    expect(stripIgnoredImportFields({ lnkNote: 'ЛНК', pstoNote: 'ПСТО' }, 'weldingJournal')).toEqual({})

    const payload = new TextDecoder().decode(buildImportTemplateXlsxBytes('weldingJournal'))
    for (const label of ['Примечание ЛНК', 'Примечание ПСТО']) {
      const column = findTemplateHeaderColumn(payload, label)
      expect(column).toBeTruthy()
      expect(payload).toContain(`<c r="${column}2" s="2"/>`)
    }
  })

  it('allows report notes only for existing rows that belong to the corresponding report', () => {
    const lnkNoteField = FIELD_BY_KEY.get('lnkNote')
    const pstoNoteField = FIELD_BY_KEY.get('pstoNote')
    expect(lnkNoteField).toBeTruthy()
    expect(pstoNoteField).toBeTruthy()
    if (!lnkNoteField || !pstoNoteField) return

    const lnkRow = { weldDate: '2026-07-31', hasVik: 'да', lnkNote: null }
    const pstoRow = { weldDate: '2026-07-31', pstoRequired: 'да', pstoNote: null }
    const rowOutsideReports = { weldDate: null, hasVik: null, pstoRequired: null }

    expect(canEditReportSpecificNote(lnkRow, 'lnkNote')).toBe(true)
    expect(canEditReportSpecificNote(pstoRow, 'pstoNote')).toBe(true)
    expect(canEditReportSpecificNote(rowOutsideReports, 'lnkNote')).toBe(false)
    expect(canEditReportSpecificNote(rowOutsideReports, 'pstoNote')).toBe(false)

    expect(isMassFillFieldLocked('weldingJournal', lnkNoteField, lnkRow)).toBe(false)
    expect(isMassFillFieldLocked('weldingJournal', pstoNoteField, pstoRow)).toBe(false)
    expect(isMassFillFieldLocked('weldingJournal', lnkNoteField, { ...lnkRow, lnkNote: 'Уже заполнено' })).toBe(true)
    expect(isMassFillFieldLocked('weldingJournal', lnkNoteField, rowOutsideReports)).toBe(true)
    expect(isSystemImportField('weldingJournal', pstoNoteField, pstoRow)).toBe(false)
    expect(isSystemImportField('weldingJournal', pstoNoteField, rowOutsideReports)).toBe(true)
  })

  it('colors report note cells per row in fill and replace templates', () => {
    const rows = [
      {
        id: 1,
        joint: 'S1',
        weldDate: '2026-07-31',
        hasVik: 'да',
        pstoRequired: 'да',
        lnkNote: null,
        pstoNote: null,
      },
      { id: 2, joint: 'S2', weldDate: null, hasVik: null, pstoRequired: null },
    ] as never[]

    for (const bytes of [
      buildMassFillTemplateXlsxBytes('weldingJournal', rows),
      buildReplaceDataTemplateXlsxBytes('weldingJournal', rows),
    ]) {
      const payload = new TextDecoder().decode(bytes)
      for (const label of ['Примечание ЛНК', 'Примечание ПСТО']) {
        const column = findTemplateHeaderColumn(payload, label)
        expect(column).toBeTruthy()
        expect(payload).toContain(`<c r="${column}2" s="0"/>`)
        expect(payload).toContain(`<c r="${column}3" s="2"/>`)
      }
    }
  })

  it('marks configured test types as a checked import field', () => {
    expect(getReportImportCellKind('weldingJournal', 'testTypes')).toBe('checked')
  })

  it('keeps virtual system fields out of import templates and ignores manual input', () => {
    expect(getReportImportTemplateFields('weldingJournal').some((field) => field.key === 'id')).toBe(false)
    expect(getReportImportTemplateFields('weldingJournal').some((field) => field.key === 'dispatcherTasks')).toBe(false)
    expect(getReportImportCellKind('weldingJournal', 'id')).toBe('ignored')
    expect(getReportImportCellKind('weldingJournal', 'dispatcherTasks')).toBe('ignored')
    expect(stripIgnoredImportFields({ id: 999, dispatcherTasks: 'ДЗ-18', joint: 'S1' }, 'weldingJournal')).toEqual({
      joint: 'S1',
    })
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

function findTemplateHeaderColumn(payload: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return payload.match(new RegExp(`<c r="([A-Z]+)1" t="inlineStr" s="1"><is><t>${escapedLabel}</t></is></c>`))?.[1]
}
