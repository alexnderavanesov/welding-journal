import { describe, expect, it } from 'vitest'
import type { WeldJoint } from '@/db/schema'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS, normalizeSaveCheckSettings } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { mergeWeldRecordsWithPrevious, validateServerWeldRecords, getSystemDocumentIntegrityReason } from '@/server/weld-save-validation'
import { prepareDuplicateControlWrite } from '@/server/duplicate-controls'
import { normalizePreHeatTreatmentLnkWorkflowPayload } from '@/server/pre-heat-treatment-lnk-workflow'
import { normalizePstoCycleWorkflowPayload } from '@/server/psto-repeat-workflow'
import { buildLnkConclusionCorrectionRows } from '@/lib/lnk-result-correction-updates'
import type { WeldRow } from '@/lib/dispatcher-types'

const context = {
  controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
  saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
  dataListSettings: DEFAULT_DATA_LIST_SETTINGS,
  otherSettings: DEFAULT_OTHER_SETTINGS,
  systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
  welderStamps: [], welderStampSuspensions: [], pstoLineAssignments: new Map(),
}
const previous = { id: 1, joint: 'F1', hasVik: 'да', vikRequest: 'Заявка', vikRequestDate: '2026-09-01' } as WeldJoint

describe('required document requisites, agreed 11 October', () => {
  it('cannot disable result names or dates through a legacy settings payload', () => {
    const keys = ['lnkResultConclusionRequired', 'lnkResultControlDateRequired', 'pstoResultDiagramRequired', 'pstoResultDateRequired'] as const
    const settings = normalizeSaveCheckSettings(Object.fromEntries(keys.map(key => [key, false])))
    expect(keys.map(key => settings[key])).toEqual([true, true, true, true])
  })
  it.each(['', ' ', '-', null, '2026-02-31'])('reports both invalid requisites after merging a partial result (date=%s)', date => {
    const previousRows = new Map([[1, previous]])
    const records = mergeWeldRecordsWithPrevious([{ id: 1, vikResult: 'годен', vikConclusionDate: date, vikConclusion: ' ' }], previousRows)
    let message = ''
    try { validateServerWeldRecords({ records, previousRows, context }) } catch (error) { message = (error as Error).message }
    expect(message).toMatch(/дат/i)
    expect(message).toMatch(/заключени/i)
  })
  it('preserves an unrelated edit of legacy incomplete facts but requires both on correction', () => {
    const legacy = { ...previous, vikResult: 'годен', vikConclusion: '', vikConclusionDate: '' } as WeldJoint
    const previousRows = new Map([[1, legacy]])
    expect(() => validateServerWeldRecords({ records: [{ ...legacy, responsible: 'Иванов' }], previousRows, context })).not.toThrow()
    expect(() => validateServerWeldRecords({ records: [{ ...legacy, vikConclusion: 'ВИК-1' }], previousRows, context })).toThrow(/дат/i)
    expect(() => validateServerWeldRecords({ records: [{ ...legacy, vikConclusion: 'ВИК-1', vikConclusionDate: '2026-09-02' }], previousRows, context })).not.toThrow()
  })
  it('requires the missing TVMT date when correcting only its name', () => {
    const legacy = { id: 1, tvmtResult: 'годен', tvmtConclusion: '', tvmtConclusionDate: '' } as WeldJoint
    expect(getSystemDocumentIntegrityReason({ ...legacy, tvmtConclusion: 'ТВМТ-1' }, legacy)).toMatch(/дат/i)
    expect(getSystemDocumentIntegrityReason({ ...legacy, responsible: 'Иванов' }, legacy)).toBe('')
  })
  it('repairs a legacy unnamed LNK conclusion atomically and leaves its result/history intact', () => {
    const legacy = { ...previous, vikResult: 'ремонт', vikConclusion: null, vikConclusionDate: null, vikDefectDescription: 'Исторический дефект' } as WeldRow
    const before = structuredClone(legacy)
    const [repaired] = buildLnkConclusionCorrectionRows({ records: [legacy], methodKey: 'vikRequest', conclusionName: 'ВИК-1', conclusionDate: '2026-09-02' })
    expect(legacy).toEqual(before)
    expect(repaired).toMatchObject({ vikResult: 'ремонт', vikDefectDescription: 'Исторический дефект', vikConclusion: 'ВИК-1', vikConclusionDate: '2026-09-02' })
    expect(() => buildLnkConclusionCorrectionRows({ records: [repaired], methodKey: 'vikRequest', conclusionName: 'ВИК-2', conclusionDate: '2026-09-03' })).toThrow('через действие')
  })
  it.each(['request', 'result'] as const)('validates both requisites before pre-TO %s begins any transaction', action => {
    expect(() => normalizePreHeatTreatmentLnkWorkflowPayload({ action, date: '', groups: [{ name: ' ', positions: [{ rowId: 1, methodCode: 'ВИК' }] }], results: [{ rowId: 1, methodCode: 'ВИК', result: 'ремонт' }], expectedVersions: [] }))
      .toThrow(/дату документа[\s\S]*наименование документа/)
  })
  it.each(['pstoRequest', 'pstoResult', 'tvmtRequest', 'tvmtResult'] as const)('validates both requisites before %s begins any transaction', action => {
    expect(() => normalizePstoCycleWorkflowPayload({ action, date: '', groups: [{ name: ' ', rowIds: [1] }], results: [{ rowId: 1, result: 'ремонт' }], expectedVersions: [] }))
      .toThrow(/дату документа[\s\S]*наименование документа/)
  })
  it.each(['годен', 'ремонт', 'вырез'] as const)('requires a name and both independent dates for a duplicate result %s', result => {
    const base = { weldJointId: 1, method: 'РК' as const, result, controlDate: '', conclusionDate: '', conclusion: '' }
    let message = ''
    try { prepareDuplicateControlWrite(base) } catch (error) { message = (error as Error).message }
    expect(message).toMatch(/дат.*контрол/i)
    expect(message).toMatch(/дат.*заключени/i)
    expect(message).toMatch(/наименован|назван/i)
    expect(prepareDuplicateControlWrite({ ...base, controlDate: '2026-09-01', conclusionDate: '2026-09-02', conclusion: 'Заказчик-1' }))
      .toMatchObject({ controlDate: '2026-09-01', conclusionDate: '2026-09-02', conclusion: 'Заказчик-1' })
  })
})
