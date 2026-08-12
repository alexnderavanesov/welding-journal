import * as XLSX from 'xlsx'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DATA_LIST_SETTINGS, saveDataListSettings } from './data-list-settings'
import { DEFAULT_OTHER_SETTINGS, saveOtherSettings } from './other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS, saveSaveCheckSettings } from './save-check-settings'
import {
  MASS_FILL_ROW_ID_HEADER,
  REPLACE_DELETE_ROW_HEADER,
  REPLACE_ROW_VERSION_HEADER,
  getReportImportTemplateFields,
} from './report-import-template'
import {
  buildReportImportPreview,
  buildReportMassFillPreview as buildReportMassFillPreviewImpl,
  buildReportReplaceDataPreview as buildReportReplaceDataPreviewImpl,
} from './report-import-preview'
import type { WeldRow } from './dispatcher-types'
import type { WelderStampRecord } from './welder-stamp-types'
import { WELD_IMPORT_MAX_ROWS } from './weld-import-limits'

const REQUIRED_EXISTING_WELD_IDENTITY = {
  projectTitle: 'Проект',
  subtitleCode: 'Шифр',
  line: 'Линия',
}

const buildReportMassFillPreview: typeof buildReportMassFillPreviewImpl = (options) =>
  buildReportMassFillPreviewImpl({
    ...options,
    rows: options.rows.map((row) => ({ ...REQUIRED_EXISTING_WELD_IDENTITY, ...row })),
  })

const buildReportReplaceDataPreview: typeof buildReportReplaceDataPreviewImpl = (options) =>
  buildReportReplaceDataPreviewImpl({
    ...options,
    rows: options.rows.map((row) => ({ ...REQUIRED_EXISTING_WELD_IDENTITY, ...row })),
  })

describe('existing rows report import preview', () => {
  afterEach(() => {
    saveOtherSettings(DEFAULT_OTHER_SETTINGS)
    saveDataListSettings(DEFAULT_DATA_LIST_SETTINGS)
    saveSaveCheckSettings(DEFAULT_SAVE_CHECK_SETTINGS)
  })

  it.each([
    ['mass fill', buildReportMassFillPreview],
    ['replace data', buildReportReplaceDataPreview],
  ])('rejects more than 2000 non-empty rows during %s preview', async (_, buildPreview) => {
    const dataRows = Array.from(
      { length: WELD_IMPORT_MAX_ROWS + 1 },
      (_, index) => [index + 1, `S${index + 1}`],
    )
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык'], dataRows)

    await expect(buildPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })).rejects.toThrow('не более 2000 строк')
  })

  it('rejects more than 2000 new weld rows before validating their contents', async () => {
    const fields = getReportImportTemplateFields('weldingJournal')
    const file = buildWorkbookFile(
      fields.map((field) => field.label),
      Array.from({ length: WELD_IMPORT_MAX_ROWS + 1 }, (_, index) =>
        fields.map((field) => field.key === 'joint' ? `S${index + 1}` : ''),
      ),
    )

    await expect(buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })).rejects.toThrow('не более 2000 строк')
  })

  it('checks ZВ-30 for a new imported row after all Excel values are assembled', async () => {
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      requiredRootStampWithWeldDate: false,
      requiredMaterialGroupWithWeldDate: false,
    })
    const file = buildWeldingJournalImportFile({
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия',
      joint: 'F1',
      weldDate: '01.07.2026',
    })

    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors[0]?.message).toContain('ЗВ-30')
    expect(preview.errors[0]?.message).toContain('тип соединения')
  })

  it('shows a Cyrillic letter in a new joint name during ordinary import preview', async () => {
    const file = buildWeldingJournalImportFile({
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия',
      joint: 'FВ013',
    })
    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0]?.message).toContain('кириллические символы')
    expect(preview.errors[0]?.fieldKeys).toEqual(['joint'])
  })

  it('shows a Cyrillic joint name together with another invalid field during ordinary import', async () => {
    saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: ['С17'] })
    const file = buildWeldingJournalImportFile({
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия',
      joint: 'FВ013',
      connectionType: 'У18',
    })
    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0]?.message).toContain('кириллические символы')
    expect(preview.errors[0]?.message).toContain('Поле "Тип соединения"')
    expect(preview.errors[0]?.fieldKeys).toEqual(expect.arrayContaining(['joint', 'connectionType']))
  })

  it('allows a Cyrillic letter in a new joint name when ZВ-26 is disabled', async () => {
    saveSaveCheckSettings({ ...DEFAULT_SAVE_CHECK_SETTINGS, manualJointName: false })
    const file = buildWeldingJournalImportFile({
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия',
      joint: 'FВ013',
    })
    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toHaveLength(1)
  })

  it('shows missing identity and another detectable error for one new row', async () => {
    saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: ['С17'] })
    const file = buildWeldingJournalImportFile({
      projectTitle: '',
      joint: 'F1',
      connectionType: 'У18',
    })
    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0]?.message).toContain('Обязательные поля не могут быть пустыми: Проект')
    expect(preview.errors[0]?.message).toContain('Поле "Тип соединения"')
    expect(preview.errors[0]?.fieldKeys).toEqual(expect.arrayContaining(['projectTitle', 'connectionType']))
  })

  it.each([
    ['mass fill', buildReportMassFillPreview],
    ['replace data', buildReportReplaceDataPreview],
  ])('checks ZВ-29 against the final stored row when %s imports only the weld date', async (_, buildPreview) => {
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      requiredRootStampWithWeldDate: false,
      requiredConnectionTypeWithWeldDate: false,
    })
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Дата сварки'],
      [[7, 'F1', '01.07.2026']],
    )

    const preview = await buildPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'F1', weldDate: null, materialGroup: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors[0]?.message).toContain('ЗВ-29')
    expect(preview.errors[0]?.message).toContain('группу материалов')
  })

  it.each([
    ['mass fill', buildReportMassFillPreview],
    ['replace data', buildReportReplaceDataPreview],
  ])('checks ZВ-30 against the final stored row when %s imports only the weld date', async (_, buildPreview) => {
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      requiredRootStampWithWeldDate: false,
      requiredMaterialGroupWithWeldDate: false,
    })
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Дата сварки'],
      [[7, 'F1', '01.07.2026']],
    )

    const preview = await buildPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'F1', weldDate: null, connectionType: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors[0]?.message).toContain('ЗВ-30')
    expect(preview.errors[0]?.message).toContain('тип соединения')
  })

  it.each([
    ['mass fill', buildReportMassFillPreview],
    ['replace data', buildReportReplaceDataPreview],
  ])('checks ZВ-31 against the final stored row when %s imports only the weld date', async (_, buildPreview) => {
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      requiredRootStampWithWeldDate: false,
      requiredMaterialGroupWithWeldDate: false,
      requiredConnectionTypeWithWeldDate: false,
    })
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Дата сварки'],
      [[7, 'F1', '01.07.2026']],
    )

    const preview = await buildPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'F1', weldDate: null, weldingMethod: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors[0]?.message).toContain('ЗВ-31')
    expect(preview.errors[0]?.message).toContain('способ сварки')
  })

  it('reports all missing core weld fields for one imported row at once', async () => {
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      requiredRootStampWithWeldDate: false,
    })
    const file = buildWeldingJournalImportFile({
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия',
      joint: 'F1',
      weldDate: '01.07.2026',
    })

    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors[0]?.message).toContain('ЗВ-29')
    expect(preview.errors[0]?.message).toContain('ЗВ-30')
    expect(preview.errors[0]?.message).toContain('ЗВ-31')
    expect(preview.errors[0]?.fieldKeys).toEqual(expect.arrayContaining([
      'materialGroup',
      'connectionType',
      'weldingMethod',
    ]))
  })

  it.each([
    ['ЗВ-10', 'mass fill', buildReportMassFillPreview, {
      requiredMaterialGroupWithWeldDate: false,
      requiredConnectionTypeWithWeldDate: false,
    }],
    ['ЗВ-10', 'replace data', buildReportReplaceDataPreview, {
      requiredMaterialGroupWithWeldDate: false,
      requiredConnectionTypeWithWeldDate: false,
    }],
    ['ЗВ-12', 'mass fill', buildReportMassFillPreview, {
      requiredRootStampWithWeldDate: false,
      requiredMaterialGroupWithWeldDate: false,
      requiredConnectionTypeWithWeldDate: false,
      requiredWeldingMethodWithWeldDate: false,
    }],
    ['ЗВ-12', 'replace data', buildReportReplaceDataPreview, {
      requiredRootStampWithWeldDate: false,
      requiredMaterialGroupWithWeldDate: false,
      requiredConnectionTypeWithWeldDate: false,
      requiredWeldingMethodWithWeldDate: false,
    }],
  ])('does not bypass %s during %s when only the weld date is imported', async (
    expectedCode,
    _,
    buildPreview,
    disabledChecks,
  ) => {
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      ...disabledChecks,
    })
    const weldDate = expectedCode === 'ЗВ-12' ? '01.01.2999' : '01.07.2026'
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Дата сварки'],
      [[7, 'F1', weldDate]],
    )

    const preview = await buildPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'F1', weldDate: null, stamp1K: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors[0]?.message).toContain(expectedCode)
  })

  it('keeps unofficial status out of mass fill update payloads', async () => {
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Статус', 'Марка стали 1'], [[7, 'F1', '', '09Г2С']])
    const preview = await buildReportMassFillPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'F1', status: 'н/п', material1: null, finalStatus: 'ожидает сварку' } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [buildWelderStampRecord('ABC1')],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, material1: '09Г2С' }])
  })

  it('keeps system fields out of replace data update payloads', async () => {
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Статус', 'Марка стали 1'], [[7, 'F1', 'официальный', '12Х18Н10Т']])
    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'F1', status: 'н/п', material1: '09Г2С', finalStatus: 'ожидает сварку' } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [buildWelderStampRecord('ABC1')],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, material1: '12Х18Н10Т' }])
    expect(preview.expectedRowVersions).toEqual([{ id: 7, version: 'v1' }])
  })

  it('rejects a replace data workbook without the hidden row version column', async () => {
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'],
      [[7, 'F1', '12Х18Н10Т']],
      false,
    )

    await expect(buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, rowVersion: 'v1', joint: 'F1', material1: '09Г2С' } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })).rejects.toThrow('Скачайте свежий шаблон')
  })

  it('rejects a stale replace data workbook before preparing updates', async () => {
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'],
      [[7, 'F1', '12Х18Н10Т']],
    )

    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, rowVersion: 'v2', joint: 'F1', material1: '09Г2С' } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.expectedRowVersions).toEqual([])
    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0]?.message).toContain('изменен после скачивания Excel')
  })

  it('ignores a stale version on an unchanged row and protects only targeted changes', async () => {
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'],
      [
        [7, 'F1', '09Г2С'],
        [8, 'F2', '12Х18Н10Т'],
      ],
    )

    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [
        { id: 7, rowVersion: 'v2', joint: 'F1', material1: '09Г2С' } as WeldRow,
        { id: 8, rowVersion: 'v1', joint: 'F2', material1: '09Г2С' } as WeldRow,
      ],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 8, material1: '12Х18Н10Т' }])
    expect(preview.expectedRowVersions).toEqual([{ id: 8, version: 'v1' }])
  })

  it('carries the hidden row version for replace data deletions', async () => {
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, REPLACE_DELETE_ROW_HEADER],
      [[7, 'да']],
    )

    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, rowVersion: 'v1', line: 'Линия', joint: 'F1' } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([
      expect.objectContaining({ id: 7, deleteRequested: true }),
    ])
    expect(preview.expectedRowVersions).toEqual([{ id: 7, version: 'v1' }])
  })

  it.each([
    ['mass fill', buildReportMassFillPreview],
    ['replace data', buildReportReplaceDataPreview],
  ])('reads report notes only from rows already present in LNK and PSTO during %s', async (_, buildPreview) => {
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      requiredRootStampWithWeldDate: false,
    })
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
      materialGroups: ['M01'],
      weldingTypes: ['РД'],
    })
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Примечание ЛНК', 'Примечание ПСТО'],
      [
        [7, 'F1', 'Примечание ЛНК', 'Примечание ПСТО'],
        [8, 'F2', 'Не читать ЛНК', 'Не читать ПСТО'],
      ],
    )
    const preview = await buildPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [
        {
          id: 7,
          joint: 'F1',
          weldDate: '2026-07-31',
          connectionType: 'С17',
          materialGroup: 'M01',
          weldingMethod: 'РД',
          hasVik: 'да',
          pstoRequired: 'да',
          lnkNote: null,
          pstoNote: null,
          finalStatus: 'ожидает заявку',
        } as WeldRow,
        {
          id: 8,
          joint: 'F2',
          weldDate: null,
          hasVik: null,
          pstoRequired: null,
          lnkNote: null,
          pstoNote: null,
          finalStatus: 'ожидает сварку',
        } as WeldRow,
      ],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([
      { id: 7, lnkNote: 'Примечание ЛНК', pstoNote: 'Примечание ПСТО' },
    ])
  })

  it('keeps derived system WDI updates when WDI inputs changed', async () => {
    saveOtherSettings({
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'formula',
    })
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'D1'], [[7, 'F1', 50.8]])
    const preview = await buildReportMassFillPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'F1', status: 'н/п', d1: null, wdi: null, finalStatus: 'ожидает сварку' } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [buildWelderStampRecord('ABC1')],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, d1: 50.8, wdi: 2 }])
  })

  it('blocks replace data changes that break PSTO request chronology', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
      materialGroups: ['M01'],
      weldingTypes: ['РАД'],
    })
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Дата сварки'], [[7, 'F1', '10.07.2026']])
    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [
        {
          id: 7,
          joint: 'F1',
          weldDate: '2026-07-01',
          weldingMethod: 'РАД',
          connectionType: 'С17',
          materialGroup: 'M01',
          d1: '10',
          d2: '10',
          t1: '4',
          t2: '4',
          stamp1K: 'ABC1',
          pstoRequest: 'ПСТО-08.07.26-001',
          pstoRequestDate: '2026-07-08',
          pstoDate: '2026-07-09',
          finalStatus: 'ожидает сварку',
        } as WeldRow,
      ],
      weldFormStampSelectOptions: { stamp1K: [{ value: 'ABC1' }] },
      welderStamps: [buildWelderStampRecord('ABC1')],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors[0]?.message).toContain('дата заявки ПСТО')
  })

  it('respects disabled PSTO request chronology check during replace data preview', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
      materialGroups: ['M01'],
    })
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      pstoResultRequestDateOrder: false,
    })
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Дата сварки'], [[7, 'F1', '10.07.2026']])
    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [
        {
          id: 7,
          joint: 'F1',
          weldDate: '2026-07-01',
          weldingMethod: 'РАД',
          connectionType: 'С17',
          materialGroup: 'M01',
          d1: '10',
          d2: '10',
          t1: '4',
          t2: '4',
          stamp1K: 'ABC1',
          pstoRequest: 'ПСТО-08.07.26-001',
          pstoRequestDate: '2026-07-08',
          pstoDate: '2026-07-09',
          finalStatus: 'ожидает сварку',
        } as WeldRow,
      ],
      weldFormStampSelectOptions: { stamp1K: [{ value: 'ABC1' }] },
      welderStamps: [buildWelderStampRecord('ABC1')],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, weldDate: '2026-07-10' }])
  })

  it('does not validate stale existing WDI when system WDI inputs changed', async () => {
    saveOtherSettings({
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'formula',
    })
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'D1'], [[7, 'F1', 80]])
    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'F1', status: 'н/п', d1: 100, wdi: 3.94, finalStatus: 'ожидает сварку' } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, d1: 80, wdi: 3.15 }])
  })

  it('ignores a value entered only into a protected system WDI cell', async () => {
    saveOtherSettings({
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'formula',
    })
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'WDI'], [[7, 'F1', 999]])
    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, rowVersion: 'v1', joint: 'F1', d1: 50.8, wdi: 2 } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.records).toEqual([])
    expect(preview.validRecords).toEqual([])
    expect(preview.skippedRows).toBe(1)
  })

  it('recalculates system WDI when replacement changes the connection type to У', async () => {
    saveOtherSettings({
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'formula',
    })
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17', 'У17'],
    })
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Тип соединения'],
      [[7, 'F1', 'У17']],
    )
    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [
        {
          id: 7,
          joint: 'F1',
          status: 'н/п',
          connectionType: 'С17',
          d1: 57,
          d2: 108,
          wdi: 4.25,
          finalStatus: 'ожидает сварку',
        } as WeldRow,
      ],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, connectionType: 'У17', wdi: 2.24 }])
  })

  it('shows changed existing rows with columns from the uploaded template', async () => {
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Линия', 'Стык', 'Марка стали 1', 'Ответственный'],
      [[7, 'LIN-1', 'F1', '09Г2С', 'Иванов']],
    )
    const preview = await buildReportMassFillPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, line: 'LIN-1', joint: 'F1', material1: null, responsible: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.fields.map((field) => field.label)).toEqual(['Линия', 'Стык', 'Марка стали 1', 'Ответственный'])
    expect(preview.records).toHaveLength(1)
    expect(preview.records[0]).toMatchObject({ id: 7, material1: '09Г2С', responsible: 'Иванов' })
    expect(preview.validRecords).toEqual([{ id: 7, material1: '09Г2С', responsible: 'Иванов' }])
  })

  it.each(['R', 'W', 'Y'])('accepts an unchanged downloaded system joint with the %s index', async (suffix) => {
    const joint = `F1${suffix}1`
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'], [[7, joint, '09Г2С']])
    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, rowVersion: 'v1', joint, material1: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, material1: '09Г2С' }])
  })

  it.each([
    ['mass fill', buildReportMassFillPreview],
    ['replace data', buildReportReplaceDataPreview],
  ])('rejects a malformed stored joint before applying %s', async (_, buildPreview) => {
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'],
      [[7, 'FВ013', '09Г2С']],
    )
    const preview = await buildPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, rowVersion: 'v1', joint: 'FВ013', material1: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0]?.message).toContain('ЗВ-26')
    expect(preview.errors[0]?.message).toContain('кириллические символы')
    expect(preview.errors[0]?.message).toContain('Исправьте номер в карточке стыка')
    expect(preview.errors[0]?.fieldKeys).toEqual(['joint'])
  })

  it('finds one malformed stored joint in a 70-row replace file', async () => {
    const rows = Array.from({ length: 70 }, (_, index) => ({
      id: index + 1,
      rowVersion: 'v1',
      joint: index === 42 ? 'FВ013' : `F${index + 1}`,
      material1: null,
    })) as WeldRow[]
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'],
      rows.map((row) => [row.id, row.joint, '09Г2С']),
    )
    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.records).toHaveLength(70)
    expect(preview.validRecords).toHaveLength(69)
    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0]).toMatchObject({
      rowNumber: 44,
      id: 43,
      title: 'Линия · FВ013',
      fieldKeys: ['joint'],
    })
    expect(preview.errors[0]?.message).toContain('кириллические символы')
  })

  it.each([
    ['mass fill', buildReportMassFillPreview],
    ['replace data', buildReportReplaceDataPreview],
  ])('allows %s with a malformed stored joint when ZВ-26 is disabled', async (_, buildPreview) => {
    saveSaveCheckSettings({ ...DEFAULT_SAVE_CHECK_SETTINGS, manualJointName: false })
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'],
      [[7, 'FВ013', '09Г2С']],
    )
    const preview = await buildPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, rowVersion: 'v1', joint: 'FВ013', material1: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, material1: '09Г2С' }])
  })

  it.each([
    ['mass fill', buildReportMassFillPreview],
    ['replace data', buildReportReplaceDataPreview],
  ])('shows missing stored identity fields before applying %s', async (_, buildPreview) => {
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'],
      [[7, 'F1', '09Г2С']],
    )
    const preview = await buildPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{
        id: 7,
        rowVersion: 'v1',
        projectTitle: null,
        subtitleCode: 'Шифр',
        line: 'Линия',
        joint: 'F1',
        material1: null,
      } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors[0]?.message).toContain('Обязательные поля не могут быть пустыми: Проект')
    expect(preview.errors[0]?.fieldKeys).toContain('projectTitle')
  })

  it.each([
    ['mass fill', buildReportMassFillPreview],
    ['replace data', buildReportReplaceDataPreview],
  ])('shows an inconsistent stored control history before applying %s', async (_, buildPreview) => {
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'],
      [[7, 'F1', '09Г2С']],
    )
    const preview = await buildPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{
        id: 7,
        rowVersion: 'v1',
        projectTitle: 'Проект',
        subtitleCode: 'Шифр',
        line: 'Линия',
        joint: 'F1',
        material1: null,
        hasRk: null,
        rkResult: 'годен',
      } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors[0]?.message).toContain('ЗВ-27')
    expect(preview.errors[0]?.message).toContain('РК')
  })

  it.each(['R', 'W', 'Y'])('ignores a new %s index entered into the protected joint cell', async (suffix) => {
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'],
      [[7, `F1${suffix}1`, '09Г2С']],
    )
    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, rowVersion: 'v1', joint: 'F1', material1: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, material1: '09Г2С' }])
    expect(preview.records[0]?.joint).toBe('F1')
  })

  it('ignores a protected joint change and reports another invalid field', async () => {
    saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: ['С17'] })
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Тип соединения'],
      [[7, 'F1R1', 'У18']],
    )
    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, rowVersion: 'v1', joint: 'F1', connectionType: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors[0]?.message).toContain('Поле "Тип соединения"')
    expect(preview.errors[0]?.fieldKeys).toEqual(['connectionType'])
  })

  it('reports a malformed stored joint together with an invalid changed field', async () => {
    saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: ['С17'] })
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Стык', 'Тип соединения'],
      [[7, 'FВ013', 'У18']],
    )
    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, rowVersion: 'v1', joint: 'FВ013', connectionType: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0]?.message).toContain('ЗВ-26')
    expect(preview.errors[0]?.message).toContain('Поле "Тип соединения"')
    expect(preview.errors[0]?.fieldKeys).toEqual(expect.arrayContaining(['joint', 'connectionType']))
  })

  it('blocks mass fill of a joint that still uses an archived official stamp', async () => {
    const archivedStamp = buildWelderStampRecord('ABC1', true)
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'], [[7, 'F1', '09Г2С']])
    const preview = await buildReportMassFillPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{
        id: 7,
        joint: 'F1',
        stamp1K: 'ABC1',
        material1: null,
      } as WeldRow],
      weldFormStampSelectOptions: { stamp1K: [] },
      welderStamps: [archivedStamp],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0]?.message).toContain('Клеймо ABC1 находится в архиве')
    expect(preview.validRecords).toEqual([])
  })

  it('allows mass fill of a historical joint welded before the stamp card archive date', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
      materialGroups: ['M01'],
    })
    const archivedStamp = {
      ...buildWelderStampRecord('ABC1', true),
      archivedAt: '2026-08-01',
    }
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'], [[7, 'F1', '09Г2С']])
    const preview = await buildReportMassFillPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{
        id: 7,
        joint: 'F1',
        stamp1K: 'ABC1',
        weldingMethod: 'РАД',
        connectionType: 'С17',
        materialGroup: 'M01',
        d1: '11',
        d2: '11',
        t1: '6',
        t2: '6',
        weldDate: '2026-07-31',
        material1: null,
      } as WeldRow],
      weldFormStampSelectOptions: { stamp1K: [] },
      welderStamps: [archivedStamp],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, material1: '09Г2С' }])
  })

  it('blocks mass fill of a joint welded after the stamp card archive date', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
      materialGroups: ['M01'],
    })
    const archivedStamp = {
      ...buildWelderStampRecord('ABC1', true),
      archivedAt: '2026-08-01',
    }
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'], [[7, 'F1', '09Г2С']])
    const preview = await buildReportMassFillPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{
        id: 7,
        joint: 'F1',
        stamp1K: 'ABC1',
        weldingMethod: 'РАД',
        connectionType: 'С17',
        materialGroup: 'M01',
        d1: '11',
        d2: '11',
        t1: '6',
        t2: '6',
        weldDate: '2026-08-02',
        material1: null,
      } as WeldRow],
      weldFormStampSelectOptions: { stamp1K: [] },
      welderStamps: [archivedStamp],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0]?.message).toContain('архиве с 01.08.2026')
    expect(preview.validRecords).toEqual([])
  })

  it('allows mass fill with an archived official stamp when the archive check is disabled', async () => {
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      officialArchive: false,
      officialWeldingMethod: false,
      officialMaterialGroup: false,
      officialNaksDate: false,
      officialDiameter: false,
      officialThickness: false,
      officialDls: false,
    })
    const archivedStamp = buildWelderStampRecord('ABC1', true)
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'], [[7, 'F1', '09Г2С']])
    const preview = await buildReportMassFillPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{
        id: 7,
        joint: 'F1',
        stamp1K: 'ABC1',
        material1: null,
      } as WeldRow],
      weldFormStampSelectOptions: { stamp1K: [] },
      welderStamps: [archivedStamp],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, material1: '09Г2С' }])
  })

  it('respects disabled root-stamp check during import preview', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
      materialGroups: ['M01'],
    })
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      requiredRootStampWithWeldDate: false,
    })
    const file = buildWeldingJournalImportFile({
      joint: 'S1',
      weldDate: '20.07.2026',
      connectionType: 'С17',
      materialGroup: 'M01',
      weldingMethod: 'РД',
      material1: '09Г2С',
    })
    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toHaveLength(1)
  })

  it('requires a material group with a weld date during import preview', async () => {
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      requiredRootStampWithWeldDate: false,
    })
    const file = buildWeldingJournalImportFile({ joint: 'S1', weldDate: '20.07.2026' })
    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0]?.message).toContain('при заполненной дате сварки это поле обязательно')
    expect(preview.validRecords).toEqual([])
  })

  it('uses save-check DLS settings during import preview', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
      materialGroups: ['M01'],
    })
    const stamp = {
      ...buildWelderStampRecord('AAAA'),
      dlsPermits: [
        {
          id: 'dls-1',
          number: 'ДЛС-1',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '1',
          diameterTo: '1000',
          thicknessFrom: '1',
          thicknessTo: '8',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          note: '',
        },
      ],
    }
    const file = buildWeldingJournalImportFile({
      joint: 'S1',
      weldingMethod: 'РАД',
      connectionType: 'С17',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '10',
      weldDate: '20.07.2026',
      stamp1K: 'AAAA',
    })

    saveSaveCheckSettings({ ...DEFAULT_SAVE_CHECK_SETTINGS, officialDls: true })
    const blockedPreview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: { stamp1K: [{ value: 'AAAA' }] },
      welderStamps: [stamp],
      welderStampSuspensions: [],
    })

    saveSaveCheckSettings({ ...DEFAULT_SAVE_CHECK_SETTINGS, officialDls: false })
    const allowedPreview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: { stamp1K: [{ value: 'AAAA' }] },
      welderStamps: [stamp],
      welderStampSuspensions: [],
    })

    expect(blockedPreview.validRecords).toEqual([])
    expect(blockedPreview.errors[0]?.message).toContain('ДЛС')
    expect(allowedPreview.errors).toEqual([])
    expect(allowedPreview.validRecords).toHaveLength(1)
  })

  it('combines several matching DLS ranges during import preview', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
      materialGroups: ['M01'],
    })
    saveSaveCheckSettings({ ...DEFAULT_SAVE_CHECK_SETTINGS, officialDls: true })
    const stamp = {
      ...buildWelderStampRecord('E0SM'),
      dlsPermits: [
        {
          id: 'dls-large',
          number: 'ДЛС-1',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '28.5',
          diameterTo: '',
          thicknessFrom: '3',
          thicknessTo: '12',
          validFrom: '2026-06-12',
          validTo: '2026-09-12',
          note: '',
        },
        {
          id: 'dls-small',
          number: 'ДЛС-2',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '18',
          diameterTo: '36',
          thicknessFrom: '3',
          thicknessTo: '6',
          validFrom: '2026-06-12',
          validTo: '2026-09-12',
          note: '',
        },
      ],
    }
    const file = buildWeldingJournalImportFile({
      joint: 'F1A',
      weldingMethod: 'РАД',
      connectionType: 'С17',
      materialGroup: 'M01',
      d1: '108',
      d2: '22',
      t1: '8',
      t2: '5',
      weldDate: '20.07.2026',
      stamp1K: 'E0SM',
    })

    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: { stamp1K: [{ value: 'E0SM' }] },
      welderStamps: [stamp],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toHaveLength(1)
  })

  it('reports only the unsupported thickness during import preview', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
      materialGroups: ['M01'],
    })
    const stamp = {
      ...buildWelderStampRecord('9PC6'),
      naksPermits: buildWelderStampRecord('9PC6').naksPermits.map((permit) => ({
        ...permit,
        thicknessFrom: '2',
        thicknessTo: '8',
      })),
    }
    const file = buildWeldingJournalImportFile({
      joint: 'F5B',
      weldingMethod: 'РАД',
      connectionType: 'С17',
      materialGroup: 'M01',
      d1: '530',
      d2: '38',
      t1: '14',
      t2: '6',
      weldDate: '26.07.2026',
      stamp1K: '9PC6',
    })

    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: { stamp1K: [{ value: '9PC6' }] },
      welderStamps: [stamp],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors[0]?.message).toContain('толщину 14.')
    expect(preview.errors[0]?.message).not.toContain('толщину 14, 6')
  })

  it('checks maximum diameter and thickness independently during import preview', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С18'],
      materialGroups: ['M01'],
    })
    const stamp = {
      ...buildWelderStampRecord('AAAA'),
      naksPermits: buildWelderStampRecord('AAAA').naksPermits.map((permit) => ({
        ...permit,
        diameterFrom: '100',
        diameterTo: '150',
        thicknessFrom: '10',
        thicknessTo: '15',
      })),
    }
    const file = buildWeldingJournalImportFile({
      joint: 'F1A',
      weldingMethod: 'РАД',
      connectionType: 'С18',
      materialGroup: 'M01',
      d1: '99',
      d2: '105',
      t1: '10',
      t2: '12',
      weldDate: '20.07.2026',
      stamp1K: 'AAAA',
    })

    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: { stamp1K: [{ value: 'AAAA' }] },
      welderStamps: [stamp],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toHaveLength(1)
  })

  it('combines one stamp own RAD and RD ranges during import preview', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
      weldingTypes: ['РАД', 'РД'],
      materialGroups: ['M01'],
    })
    const stamp = {
      ...buildWelderStampRecord('AAAA'),
      naksPermits: [
        {
          id: 'naks-rad',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '1',
          diameterTo: '50',
          thicknessFrom: '1',
          thicknessTo: '5',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          note: '',
        },
        {
          id: 'naks-rd',
          weldType: 'РД',
          materialGroups: 'M01',
          diameterFrom: '50',
          diameterTo: '100',
          thicknessFrom: '5',
          thicknessTo: '10',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          note: '',
        },
      ],
    }
    const file = buildWeldingJournalImportFile({
      joint: 'F1A',
      weldingMethod: 'РАД+РД',
      connectionType: 'С17',
      materialGroup: 'M01',
      d1: '57',
      d2: '57',
      t1: '3',
      t2: '3',
      weldDate: '20.07.2026',
      stamp1K: 'AAAA',
      stamp1Z: 'AAAA',
    })

    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: {
        stamp1K: [{ value: 'AAAA' }],
        stamp1Z: [{ value: 'AAAA' }],
      },
      welderStamps: [stamp],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toHaveLength(1)
  })

  it('uses only the smaller material D and paired T for an angular connection during import preview', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['У17'],
      materialGroups: ['M01'],
    })
    const stamp = {
      ...buildWelderStampRecord('AAAA'),
      naksPermits: [
        {
          id: 'naks-angular-branch',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '20',
          diameterTo: '30',
          thicknessFrom: '2',
          thicknessTo: '4',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          note: '',
        },
      ],
    }
    const file = buildWeldingJournalImportFile({
      joint: 'F1A',
      weldingMethod: 'РАД',
      connectionType: 'У17',
      materialGroup: 'M01',
      d1: '530',
      t1: '30',
      d2: '25',
      t2: '3',
      weldDate: '20.07.2026',
      stamp1K: 'AAAA',
    })

    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: { stamp1K: [{ value: 'AAAA' }] },
      welderStamps: [stamp],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toHaveLength(1)
  })

  it('uses archived DLS permits for historical weld dates during import preview', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
      materialGroups: ['M01'],
    })
    saveSaveCheckSettings({ ...DEFAULT_SAVE_CHECK_SETTINGS, officialDls: true })
    const stamp = {
      ...buildWelderStampRecord('AAAA'),
      dlsPermits: [
        {
          id: 'dls-1',
          number: 'ДЛС-1',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '1',
          diameterTo: '1000',
          thicknessFrom: '1',
          thicknessTo: '1000',
          validFrom: '2026-07-01',
          validTo: '2026-07-31',
          note: '',
          archived: true,
        },
      ],
    }
    const file = buildWeldingJournalImportFile({
      joint: 'S1',
      weldingMethod: 'РАД',
      connectionType: 'С17',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '10',
      weldDate: '20.07.2026',
      stamp1K: 'AAAA',
    })
    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: { stamp1K: [{ value: 'AAAA' }] },
      welderStamps: [stamp],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toHaveLength(1)
  })

  it('points new record validation errors to the exact import field', async () => {
    const file = buildWeldingJournalImportFile({ joint: 'S1', weldingMethod: 'МП', material1: '09Г2С' })
    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0].fieldKeys).toEqual(['weldingMethod'])
  })

  it('requires imported material groups to match the configured alphabet exactly', async () => {
    saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, materialGroups: ['М01'] })
    const file = buildWeldingJournalImportFile({ joint: 'S1', materialGroup: 'M01', material1: '09Г2С' })
    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0].message).toContain('Значение "M01" не подходит')
    expect(preview.errors[0].fieldKeys).toEqual(['materialGroup'])
  })

  it('shows connection type and material group errors together for the same import row', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
      connectionTypes: ['С17'],
      materialGroups: ['М01'],
    })
    const file = buildWeldingJournalImportFile({
      joint: 'S1',
      connectionType: 'У18',
      materialGroup: 'M2223',
      material1: '09Г2С',
    })
    const preview = await buildReportImportPreview({
      activeReport: 'weldingJournal',
      file,
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0].message).toContain('Поле "Тип соединения"')
    expect(preview.errors[0].message).toContain('Поле "Группа материалов"')
    expect(preview.errors[0].fieldKeys).toEqual(['connectionType', 'materialGroup'])
  })

  it('points existing row validation errors to the exact changed import field', async () => {
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Корень_1', 'Марка стали 1'], [[7, 'S1', 'BAD', '09Г2С']])
    const preview = await buildReportMassFillPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'S1', stamp1K: null, material1: null } as WeldRow],
      weldFormStampSelectOptions: { stamp1K: [{ value: 'GOOD' }] },
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.validRecords).toEqual([])
    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0].fieldKeys).toEqual(['stamp1K'])
  })
})

function buildWorkbookFile(headers: string[], rows: unknown[][], includeRowVersion = true) {
  const needsRowVersion = includeRowVersion && headers.includes(MASS_FILL_ROW_ID_HEADER) && !headers.includes(REPLACE_ROW_VERSION_HEADER)
  const workbookHeaders = needsRowVersion
    ? [headers[0], REPLACE_ROW_VERSION_HEADER, ...headers.slice(1)]
    : headers
  const workbookRows = needsRowVersion
    ? rows.map((row) => [row[0], 'v1', ...row.slice(1)])
    : rows
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet([workbookHeaders, ...workbookRows])
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Импорт')
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return {
    name: 'import.xlsx',
    arrayBuffer: async () => buffer,
    text: async () => '',
  } as File
}

function buildWeldingJournalImportFile(valuesByFieldKey: Record<string, unknown>) {
  const fields = getReportImportTemplateFields('weldingJournal')
  const values = { ...REQUIRED_EXISTING_WELD_IDENTITY, ...valuesByFieldKey }
  return buildWorkbookFile(
    fields.map((field) => field.label),
    [fields.map((field) => values[field.key as keyof typeof values] ?? '')],
  )
}

function buildWelderStampRecord(naksStamp: string, archived = false): WelderStampRecord {
  return {
    id: 1,
    naksStamp,
    welderName: 'Тестовый Сварщик',
    internalStamp: '',
    weldType: 'РАД',
    materialGroups: 'M01',
    diameterFrom: '1',
    diameterTo: '1000',
    thicknessFrom: '1',
    thicknessTo: '1000',
    validFrom: '01.01.2026',
    validTo: '31.12.2026',
    naksPermits: [
      {
        id: 'naks-1',
        weldType: 'РАД',
        materialGroups: 'M01',
        diameterFrom: '1',
        diameterTo: '1000',
        thicknessFrom: '1',
        thicknessTo: '1000',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        note: '',
      },
    ],
    dlsPermits: [],
    archived,
  }
}
