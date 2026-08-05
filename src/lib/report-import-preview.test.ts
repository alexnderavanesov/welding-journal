import * as XLSX from 'xlsx'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DATA_LIST_SETTINGS, saveDataListSettings } from './data-list-settings'
import { DEFAULT_OTHER_SETTINGS, saveOtherSettings } from './other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS, saveSaveCheckSettings } from './save-check-settings'
import { MASS_FILL_ROW_ID_HEADER, getReportImportTemplateFields } from './report-import-template'
import {
  buildReportImportPreview,
  buildReportMassFillPreview,
  buildReportReplaceDataPreview,
} from './report-import-preview'
import type { WeldRow } from './dispatcher-types'
import type { WelderStampRecord } from './welder-stamp-types'

describe('existing rows report import preview', () => {
  afterEach(() => {
    saveOtherSettings(DEFAULT_OTHER_SETTINGS)
    saveDataListSettings(DEFAULT_DATA_LIST_SETTINGS)
    saveSaveCheckSettings(DEFAULT_SAVE_CHECK_SETTINGS)
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
  })

  it.each([
    ['mass fill', buildReportMassFillPreview],
    ['replace data', buildReportReplaceDataPreview],
  ])('reads report notes only from rows already present in LNK and PSTO during %s', async (_, buildPreview) => {
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      requiredRootStampWithWeldDate: false,
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
    saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, materialGroups: ['M01'] })
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
    saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, materialGroups: ['M01'] })
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

  it('does not validate locked existing joint names with system indexes', async () => {
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Марка стали 1'], [[7, 'F1R1', '09Г2С']])
    const preview = await buildReportMassFillPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'F1R1', material1: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, material1: '09Г2С' }])
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
    saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, materialGroups: ['M01'] })
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
    saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, materialGroups: ['M01'] })
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
    saveSaveCheckSettings({
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      requiredRootStampWithWeldDate: false,
    })
    const file = buildWeldingJournalImportFile({ joint: 'S1', weldDate: '20.07.2026', material1: '09Г2С' })
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

  it('uses save-check DLS settings during import preview', async () => {
    saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, materialGroups: ['M01'] })
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
    saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, materialGroups: ['M01'] })
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
    saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, materialGroups: ['M01'] })
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

  it('combines one stamp own RAD and RD ranges during import preview', async () => {
    saveDataListSettings({
      ...DEFAULT_DATA_LIST_SETTINGS,
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
    saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, materialGroups: ['M01'] })
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

function buildWorkbookFile(headers: string[], rows: unknown[][]) {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
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
  return buildWorkbookFile(
    fields.map((field) => field.label),
    [fields.map((field) => valuesByFieldKey[field.key] ?? '')],
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
