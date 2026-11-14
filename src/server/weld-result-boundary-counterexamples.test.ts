import { expect, it } from 'vitest'
import type { WeldJoint } from '@/db/schema'
import type { WeldInput } from '@/lib/weld-fields'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { prepareServerWeldRecords, validateServerWeldRecords } from './weld-save-validation'
import { toDbInsert, buildWeldBatchUpdatePayload } from './weld-persistence'
import { hasStoredLnkResult, isWeldWorkflowRemoval } from './weld-workflow-removal'
import { LNK_METHODS } from '@/lib/lnk-report-config'

const context = { controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS, dataListSettings: DEFAULT_DATA_LIST_SETTINGS,
  otherSettings: DEFAULT_OTHER_SETTINGS, saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
  systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, welderStamps: [], welderStampSuspensions: [], pstoLineAssignments: new Map() }
const base = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1', connectionType: 'С17', weldDate: '2026-01-01', hasVik: 'да' }
const completedPsto = { pstoRequired: 'да', pstoRequest: 'P', pstoRequestDate: '2026-01-02', pstoResult: 'проведено',
  pstoDate: '2026-01-03', heatTreatmentDiagram: 'D', hasTvmt: 'да' }

const cases: { name: string; field: 'vikResult' | 'tvmtResult'; alias: string; previous: WeldInput }[] = [
  { name: 'VIK without request', field: 'vikResult', alias: 'да', previous: base },
  { name: 'VIK with request but no conclusion/date', field: 'vikResult', alias: 'да', previous: { ...base, vikRequest: 'V', vikRequestDate: '2026-01-02' } },
  { name: 'TVMT before completed PSTO', field: 'tvmtResult', alias: 'годен (отменен)', previous: { ...base, hasTvmt: 'да' } },
  { name: 'TVMT without request', field: 'tvmtResult', alias: 'годен (отменен)', previous: { ...base, ...completedPsto } },
  { name: 'TVMT with request but no conclusion/date', field: 'tvmtResult', alias: 'годен (отменен)', previous: { ...base, ...completedPsto, tvmtRequest: 'T', tvmtRequestDate: '2026-01-04' } },
]
for (const scenario of cases) for (const canonical of [false, true]) it(`${scenario.name}: ${canonical ? 'canonical' : 'alias'} cannot acquire a good persisted result`, () => {
  const previous = scenario.previous as WeldJoint
  const record = { ...previous, [scenario.field]: canonical ? 'годен' : scenario.alias }
  const args = { records: [record], previousRows: new Map([[1, previous]]), context }
  prepareServerWeldRecords(args)
  let error: Error | undefined
  try { validateServerWeldRecords(args) } catch (caught) { error = caught as Error }
  const saved = error ? undefined : toDbInsert(record, false, { previous })
  expect({ blocked: Boolean(error), storedResult: saved?.[scenario.field] }).toMatchObject({ blocked: true })
})

it.each(['vikResult', 'tvmtResult'] as const)('%s accepted alias uses every canonical check while leaving input and old history unchanged', field => {
  const previous = { ...base, ...(field === 'tvmtResult' ? completedPsto : {}),
    ...(field === 'vikResult' ? { vikRequest: 'V', vikRequestDate: '2026-01-02' }
      : { tvmtRequest: 'T', tvmtRequestDate: '2026-01-04' }) } as WeldJoint
  const record = { ...previous, ...(field === 'vikResult'
    ? { vikResult: 'да', vikConclusion: 'VC', vikConclusionDate: '2026-01-03' }
    : { tvmtResult: 'годен (отменен)', tvmtConclusion: 'TC', tvmtConclusionDate: '2026-01-05' }) }
  const args = { records: [record], previousRows: new Map([[1, previous]]), context }
  prepareServerWeldRecords(args)
  const beforeValidation = structuredClone(record)
  expect(() => validateServerWeldRecords(args)).not.toThrow()
  expect(record).toEqual(beforeValidation)
  expect(toDbInsert(record, false, { previous })[field]).toBe('годен')

  const old = { ...base, [field]: field === 'vikResult' ? 'да' : 'годен (отменен)' } as WeldJoint
  expect(() => validateServerWeldRecords({ records: [{ ...old, lnkNote: 'Old history correction' }], previousRows: new Map([[1, old]]), context })).not.toThrow()
})

for (const method of LNK_METHODS) it.each(['не годен', 'HISTORICAL-UNKNOWN'])(`${method.code}: unrelated edits retain the entire old %s result and defect description`, result => {
  const previous = { ...base, [method.enabledKey]: 'да', [method.resultKey]: result,
    [method.requestKey]: 'REQUEST', [method.requestDateKey]: '2026-01-02',
    [method.conclusionKey]: 'CONCLUSION', [method.conclusionDateKey]: '2026-01-03',
    [method.defectDescriptionKey]: 'Recorded defect details', ...(method.code === 'РК' ? { rkExposureConfirmedDiameter: 159 } : {}),
  } as WeldJoint
  const record = { ...previous, lnkNote: 'Unrelated correction' }
  const args = { records: [record], previousRows: new Map([[1, previous]]), context }
  prepareServerWeldRecords(args)
  expect(() => validateServerWeldRecords(args)).not.toThrow()
  for (const saved of [toDbInsert(record, false, { previous }), buildWeldBatchUpdatePayload(record, args.previousRows, new Date())]) {
    for (const key of [method.resultKey, method.requestKey, method.requestDateKey, method.conclusionKey, method.conclusionDateKey, method.defectDescriptionKey]) {
      expect(saved[key], key).toBe(previous[key])
    }
    if (method.code === 'РК') expect(saved.rkExposureConfirmedDiameter).toBe(159)
  }
})

it.each(['vikResult', 'pstoResult', 'tvmtResult'] as const)('%s clearing opaque stored text requires deletion without treating it as a completed stage', field => {
  const scope = field === 'vikResult' ? 'lnk' : 'psto'
  expect(isWeldWorkflowRemoval({ [field]: null }, { [field]: 'HISTORICAL-UNKNOWN' }, scope)).toBe(true)
  expect(isWeldWorkflowRemoval({ [field]: 'ожидает' }, { [field]: 'HISTORICAL-UNKNOWN' }, scope)).toBe(true)
  expect(isWeldWorkflowRemoval({ [field]: 'годен' }, { [field]: 'HISTORICAL-UNKNOWN' }, scope)).toBe(false)
  expect(isWeldWorkflowRemoval({ [field]: null }, { [field]: 'ожидает НК' }, scope)).toBe(false)
  expect(hasStoredLnkResult('HISTORICAL-UNKNOWN')).toBe(false)
})

it.each([[null, null], ['Corrected detail', 'Corrected detail'], ['  Corrected  detail  ', 'Corrected detail']])('preservation retains an accepted description edit %j', (value, expected) => {
  const previous = { ...base, vikResult: 'HISTORICAL-UNKNOWN', vikDefectDescription: 'Old description' } as WeldJoint
  const record = { ...previous, vikDefectDescription: value }
  expect(() => validateServerWeldRecords({ records: [record], previousRows: new Map([[1, previous]]), context })).not.toThrow()
  expect(toDbInsert(record, false, { previous }).vikDefectDescription).toBe(expected)
  expect(buildWeldBatchUpdatePayload(record, new Map([[1, previous]]), new Date()).vikDefectDescription).toBe(expected)
})
