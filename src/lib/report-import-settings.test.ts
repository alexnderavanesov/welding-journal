import { writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_DATA_LIST_SETTINGS, loadDataListSettings, saveDataListSettings } from './data-list-settings'
import { DEFAULT_OTHER_SETTINGS, loadOtherSettings, saveOtherSettings } from './other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS, loadSaveCheckSettings, saveSaveCheckSettings } from './save-check-settings'
import { userStorage } from './user-storage'
import { collectImportedWeldRecordPreparationErrors, loadImportedWeldPreparationSettings, prepareImportedWeldRecords } from './weld-journal-mutation-updates'
import { normalizeWeldingMethodsForImport } from './welder-stamp-import'
import { buildReportImportPreview, buildReportMassFillPreview, buildReportReplaceDataPreview, fixReportImportPreviewErrors } from './report-import-preview'
import { getReportImportTemplateFields, MASS_FILL_ROW_ID_HEADER, REPLACE_ROW_VERSION_HEADER } from './report-import-template'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from './weld-fields'
import type { WeldRow } from './dispatcher-types'

const DATA_KEY = 'welding-data-list-settings', SAVE_KEY = 'welding-save-check-settings'
const options = { activeReport: 'weldingJournal' as const, weldFormStampSelectOptions: {}, welderStamps: [], welderStampSuspensions: [] }
const preparationOptions = { ...options, skipManualJointNameValidation: true, skipLnkResultRuleValidation: true }
const identity = { projectTitle: 'Проект', subtitleCode: 'Шифр', line: 'Линия' }
const editable = ['weldingMethod', 'connectionType', 'materialGroup', 'testTypes'] as const

function records(count: number): WeldInput[] {
  return Array.from({ length: count }, (_, index) => ({ ...identity, joint: `S${index + 1}`, d1: 25.4,
    ...(index % 3 === 1
      ? { weldingMethod: 'BAD', connectionType: 'BAD', materialGroup: 'М01 + М05 + М11', testTypes: 'BAD' }
      : { weldingMethod: 'РД+РАД', connectionType: 'С17', materialGroup: 'М05 + М01', testTypes: 'ПИ,ГИ' }),
  }))
}
function workbook(headers: string[], rows: unknown[][]): File {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Импорт')
  const buffer = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return { name: 'settings.xlsx', arrayBuffer: async () => buffer } as File
}
function importFile(rows: WeldInput[]) {
  const fields = getReportImportTemplateFields('weldingJournal')
  return workbook(fields.map(field => field.label), rows.map(row => fields.map(field => row[field.key as WeldFieldKey] ?? '')))
}
function watchSettings() {
  const rawData = userStorage.getItem(DATA_KEY), rawSave = userStorage.getItem(SAVE_KEY)
  const reads = vi.spyOn(userStorage, 'getItem'), parses = vi.spyOn(JSON, 'parse')
  return {
    reads, parses,
    counts: () => ({
      dataReads: reads.mock.calls.filter(([key]) => key === DATA_KEY).length,
      saveReads: reads.mock.calls.filter(([key]) => key === SAVE_KEY).length,
      dataParses: parses.mock.calls.filter(([raw]) => raw === rawData).length,
      saveParses: parses.mock.calls.filter(([raw]) => raw === rawSave).length,
    }),
    clear: () => { reads.mockClear(); parses.mockClear() },
  }
}
beforeEach(() => {
  window.localStorage.clear()
  saveDataListSettings(DEFAULT_DATA_LIST_SETTINGS, { syncRemote: false })
  saveOtherSettings(DEFAULT_OTHER_SETTINGS, { syncRemote: false })
  saveSaveCheckSettings(DEFAULT_SAVE_CHECK_SETTINGS, { syncRemote: false })
})
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear() })

it.each(['import', 'massFill', 'replaceData'] as const)('parses settings once for a mixed multirow %s preview and reports all independent errors', async mode => {
  const input = records(6)
  const file = mode === 'import' ? importFile(input) : workbook(
    [MASS_FILL_ROW_ID_HEADER, REPLACE_ROW_VERSION_HEADER, ...editable.map(key => FIELD_BY_KEY.get(key)!.label)],
    input.map((row, index) => [index + 1, 'v1', ...editable.map(key => row[key])]),
  )
  const watch = watchSettings()
  const preview = mode === 'import' ? await buildReportImportPreview({ ...options, file })
    : await (mode === 'massFill' ? buildReportMassFillPreview : buildReportReplaceDataPreview)({ ...options, file,
      rows: input.map((row, index) => ({ ...identity, id: index + 1, joint: row.joint, rowVersion: 'v1' }) as WeldRow),
    })
  // The former preparation alone parsed dictionaries five times per row:
  // three normalizers and two stamp checks. Template rules added save-check
  // reads for stripping, locked fields and error highlights as well.
  expect(watch.counts()).toEqual({ dataReads: 1, saveReads: 1, dataParses: 1, saveParses: 1 })
  expect(preview.errors.map(error => error.rowNumber)).toEqual([3, 6])
  for (const error of preview.errors) {
    expect(error.fieldKeys).toEqual(expect.arrayContaining([...editable]))
    for (const label of ['Способ сварки', 'Тип соединения', 'Группа материалов', 'Вид испытаний']) expect(error.message).toContain(label)
    expect(error.message).toContain('не более двух')
  }
  expect(preview.validRecords).toHaveLength(4)
  for (const row of preview.validRecords) expect(row).toMatchObject({ weldingMethod: 'РАД+РД', connectionType: 'С17', materialGroup: 'М05 + М01', testTypes: 'ГИ, ПИ' })
  if (mode !== 'import') expect(preview.expectedRowVersions).toEqual([1, 3, 4, 6].map(id => ({ id, version: 'v1' })))
})

it('loads fresh dictionaries, save checks and WDI mode after the file await for every new preview', async () => {
  const input: WeldInput[] = [{ ...identity, joint: 'Номер заказчика', testTypes: 'ВИ', d1: 25.4 }]
  const file = importFile(input)
  const first = await buildReportImportPreview({ ...options, file })
  expect(first.errors[0].fieldKeys).toEqual(expect.arrayContaining(['joint', 'testTypes']))

  const buffer = await file.arrayBuffer()
  let release!: (value: ArrayBuffer) => void
  const pendingBuffer = new Promise<ArrayBuffer>(resolve => { release = resolve })
  const delayed = { name: file.name, arrayBuffer: () => pendingBuffer } as File
  const watch = watchSettings()
  const pending = buildReportImportPreview({ ...options, file: delayed })
  expect(watch.counts()).toEqual({ dataReads: 0, saveReads: 0, dataParses: 0, saveParses: 0 })
  saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, testTypes: ['ВИ'] }, { syncRemote: false })
  saveOtherSettings({ ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula' }, { syncRemote: false })
  saveSaveCheckSettings({ ...DEFAULT_SAVE_CHECK_SETTINGS, manualJointName: false }, { syncRemote: false })
  watch.clear()
  release(buffer)
  const current = await pending
  expect(current.errors).toEqual([])
  expect(current.validRecords[0]).toMatchObject({ joint: 'Номер заказчика', testTypes: 'ВИ', wdi: 1 })
  expect(watch.reads.mock.calls.filter(([key]) => key === DATA_KEY || key === SAVE_KEY)).toHaveLength(2)

  // An actual import has its own preparation call and must not retain the
  // preview's formula settings when the operator starts another operation.
  saveOtherSettings(DEFAULT_OTHER_SETTINGS, { syncRemote: false })
  const prepared = prepareImportedWeldRecords({ ...preparationOptions, records: [{ ...input[0], wdi: 9 }] })
  expect(prepared[0].wdi).toBe(9)
})

it('reuses only the current correction pass while preserving unresolved combined errors and successful rows', async () => {
  const input = records(7); input[6].testTypes = 'BAD'
  const preview = await buildReportImportPreview({ ...options, file: importFile(input) })
  expect(preview.errors).toHaveLength(3)
  const watch = watchSettings()
  const fixed = fixReportImportPreviewErrors(preview, options)
  expect(watch.counts()).toEqual({ dataReads: 1, saveReads: 1, dataParses: 1, saveParses: 1 })
  // Clearing all checked fields would also erase mandatory identity fields.
  // The existing correction workflow retains those two combined errors.
  expect(fixed.errors).toEqual(preview.errors.filter(error => error.rowNumber !== 8))
  expect(fixed.validRecords).toHaveLength(5)
  expect(fixed.validRecords.find(row => row.joint === 'S7')).toMatchObject({ testTypes: null, weldingMethod: 'РАД+РД', connectionType: 'С17' })
  expect(fixed.validRecords.filter(row => ['S1', 'S3', 'S4', 'S6'].includes(String(row.joint)))).toEqual(preview.validRecords)
})

it('keeps standalone preparation and welding-method callers fresh without a supplied settings object', () => {
  const input = records(1)
  const watch = watchSettings()
  const prepared = prepareImportedWeldRecords({ ...preparationOptions, records: structuredClone(input) })
  expect(watch.counts()).toEqual({ dataReads: 1, saveReads: 1, dataParses: 1, saveParses: 1 })
  expect(prepared[0]).toMatchObject({ weldingMethod: 'РАД+РД', testTypes: 'ГИ, ПИ' })
  saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, weldingTypes: ['МЕТОД'], testTypes: ['ВИ'] }, { syncRemote: false })
  const methods: WeldInput[] = [{ weldingMethod: 'МЕТОД+РД' }]
  normalizeWeldingMethodsForImport(methods)
  expect(methods[0].weldingMethod).toBe('РД+МЕТОД')
  const next = prepareImportedWeldRecords({ ...preparationOptions, records: [{ joint: 'S9', testTypes: 'ВИ' }] })
  expect(next[0].testTypes).toBe('ВИ')
})

function prepareRows(input: WeldInput[], replayFormerLoads: boolean) {
  // Replay the former read pattern with the same current validators: one outer
  // save-check read, then one save-check and three normalizer dictionary reads
  // per row, plus the two stamp-compatibility dictionary reads. This isolates
  // settings reuse; it is not an old application build.
  if (replayFormerLoads) loadSaveCheckSettings()
  const shared = replayFormerLoads ? undefined : loadImportedWeldPreparationSettings()
  return input.map(record => {
    const preparationSettings = shared ?? {
      saveCheckSettings: loadSaveCheckSettings(), otherSettings: loadOtherSettings(),
      dataListSettings: { ...loadDataListSettings(), weldingTypes: loadDataListSettings().weldingTypes, testTypes: loadDataListSettings().testTypes },
    }
    if (replayFormerLoads) {
      loadDataListSettings() // parseOfficialStampWeldingMethods
      if (String(record.materialGroup ?? '').trim()) loadDataListSettings() // parseOfficialStampMaterialGroup
    }
    const result = collectImportedWeldRecordPreparationErrors({ ...preparationOptions, records: [{ ...record }], preparationSettings })
    return { records: result.records, errors: result.errors.map(error => error.message) }
  })
}

it('reduces the former 3N normalizer plus 2N stamp dictionary reads and N+1 save-check reads without losing diagnostics', () => {
  const input = records(6), snapshot = structuredClone(input), watch = watchSettings()
  const previous = prepareRows(input, true)
  expect(watch.counts()).toEqual({ dataReads: 30, saveReads: 7, dataParses: 30, saveParses: 7 })
  watch.clear()
  expect(prepareRows(input, false)).toEqual(previous)
  expect(watch.counts()).toEqual({ dataReads: 1, saveReads: 1, dataParses: 1, saveParses: 1 })
  expect(previous.filter(row => row.errors.length)).toHaveLength(2)
  expect(input).toEqual(snapshot)
})

// Validation-only CPU comparison: 1000 records intentionally exceed the
// existing 500-row file limit. File parsing, network, and persistence are absent.
it.runIf(process.env.IMPORT_SETTINGS_MEASURE === '1')('measures operation-scoped settings reuse for 100/1000 prepared records', () => {
  const measurements = []
  for (const size of [100, 1000]) {
    const input = records(size)
    expect(prepareRows(input, false)).toEqual(prepareRows(input, true))
    for (let warm = 0; warm < 3; warm++) { prepareRows(input, true); prepareRows(input, false) }
    const samples: Record<string, number[]> = { formerReads: [], shared: [] }
    for (let repeat = 0; repeat < 9; repeat++) for (const name of repeat % 2 ? ['shared', 'formerReads'] : ['formerReads', 'shared']) {
      const start = performance.now()
      prepareRows(input, name === 'formerReads')
      samples[name].push(performance.now() - start)
    }
    measurements.push({ size, samples })
  }
  const result = { scope: 'Current identical validators; former settings reads replayed versus one operation snapshot; no XLSX/network/persistence; alternating order', measurements }
  writeFileSync('/tmp/import-settings-preparation.json', JSON.stringify(result, null, 2))
  console.log('IMPORT_SETTINGS_PREPARATION', JSON.stringify(result))
}, 60_000)
