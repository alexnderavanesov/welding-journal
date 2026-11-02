import { describe, expect, it } from 'vitest'
import { createAuditOriginResolver } from './audit-origin-policy'

describe('audit provenance recorded with the operation', () => {
  it('separates entered NK results from statuses, documents and automatic names in the same save', () => {
    const before = { id: 7, vikResult: 'ожидает НК', finalStatus: 'ожидает НК' }
    const after = { ...before, vikResult: 'годен', vikConclusion: 'ВИК-1', vikConclusionDate: '2026-11-02', finalStatus: 'годен' }
    const origin = createAuditOriginResolver('updateWeldJoints', { mutationScope: 'lnk', records: [after],
      systemDocumentSequences: [{ fieldKeys: ['vikConclusion'], provisionalName: 'ВИК-1' }], origin: 'user' })
    expect(origin('weld_joints', before, after, 'vikResult')).toBe('user')
    expect(origin('weld_joints', before, after, 'vikConclusionDate')).toBe('user')
    expect(origin('weld_joints', before, after, 'vikConclusion')).toBe('automatic')
    expect(origin('weld_joints', before, after, 'finalStatus')).toBe('automatic')
    expect(origin('generated_documents', undefined, { title: 'ВИК-1' }, 'title')).toBe('automatic')
    expect(origin('generated_document_weld_joints', { documentId: 1 }, { documentId: 2 }, 'documentId')).toBe('automatic')
    expect(origin('weld_joints', { id: 8 }, { ...after, id: 8 }, 'vikResult')).toBe('automatic')
  })
  it('does not call an automatically established waiting result a user entry', () => {
    const row = { id: 7, vikRequest: 'Заявка', vikRequestDate: '2026-11-02', vikResult: 'ожидает НК' }
    const origin = createAuditOriginResolver('updateWeldJoints', { mutationScope: 'lnk', records: [row] })
    expect(origin('weld_joints', { id: 7 }, row, 'vikResult')).toBe('automatic')
    expect(origin('weld_joints', { id: 7 }, row, 'vikRequest')).toBe('user')
  })
  it('keeps automatic defect clearing separate from a factual result correction', () => {
    const before = { id: 7, vikResult: 'ремонт', vikDefectDescription: 'Дефект' }
    const after = { id: 7, vikResult: 'годен', vikDefectDescription: null }
    const origin = createAuditOriginResolver('updateWeldJoint', { ...after, mutationScope: 'lnk' })
    expect(origin('weld_joints', before, after, 'vikResult')).toBe('user')
    expect(origin('weld_joints', before, after, 'vikDefectDescription')).toBe('automatic')
  })
  it('attributes the automatic no-defects mark to the system, without mixing different control methods', () => {
    const before = { id: 7, vikResult: 'ожидает НК', vikDefectDescription: null, uzkResult: 'ремонт', uzkDefectDescription: 'Дефект' }
    const after = { ...before, vikResult: 'годен', vikDefectDescription: 'ДНО', uzkDefectDescription: null }
    const origin = createAuditOriginResolver('updateWeldJoint', { ...after, mutationScope: 'lnk' })
    expect(origin('weld_joints', before, after, 'vikDefectDescription')).toBe('automatic')
    expect(origin('weld_joints', before, after, 'uzkDefectDescription')).toBe('user')
  })
  it('keeps manually changed descriptions and zero WDI as user changes', () => {
    const before = { id: 7, vikResult: 'ремонт', vikDefectDescription: 'Дефект' }
    const after = { ...before, vikDefectDescription: null }
    expect(createAuditOriginResolver('updateWeldJoint', { ...after, mutationScope: 'lnk' })('weld_joints', before, after, 'vikDefectDescription')).toBe('user')
    const origin = createAuditOriginResolver('updateWeldJoint', { id: 7, wdi: 0 }, { auditWdiSystem: false })
    expect(origin('weld_joints', { id: 7, wdi: 1 }, { id: 7, wdi: 0 }, 'wdi')).toBe('user')
    expect(origin('weld_joints', { id: 7, wdi: 1 }, { id: 7, wdi: 2 }, 'wdi')).toBe('automatic')
  })
  it('uses the actual WDI mode and detects server-inherited replacements', () => {
    const data = { id: 7, wdi: 2, line: 'Новая', category: 'Прежняя' }
    const after = { ...data, category: 'По новой линии' }
    const settings: { auditWdiSystem?: boolean } = {}
    const origin = createAuditOriginResolver('updateWeldJoint', data, settings)
    expect(origin('weld_joints', { id: 7, wdi: 1 }, after, 'wdi')).toBeUndefined()
    settings.auditWdiSystem = true
    expect(origin('weld_joints', { id: 7, wdi: 1 }, after, 'wdi')).toBe('automatic')
    expect(origin('weld_joints', { id: 7, category: 'Прежняя' }, after, 'category')).toBe('automatic')
    expect(origin('weld_joints', { id: 7, line: 'Прежняя' }, after, 'line')).toBe('user')
    settings.auditWdiSystem = false
    expect(origin('weld_joints', { id: 7, wdi: 1 }, after, 'wdi')).toBe('user')
  })
  it('classifies creation/import by stable submitted identity without attributing derived fields', () => {
    const row = { projectTitle: 'Проект', subtitleCode: 'Шифр', line: 'Линия', joint: '1', weldingJournalNote: 'Примечание' }
    for (const operation of ['createWeldJoint', 'importWeldJoints']) {
      const origin = createAuditOriginResolver(operation, operation === 'createWeldJoint' ? row : { records: [row] })
      expect(origin('weld_joints', undefined, { ...row, id: 44 }, 'weldingJournalNote')).toBe('user')
      expect(origin('weld_joints', undefined, { ...row, id: 44, finalStatus: 'годен' }, 'finalStatus')).toBe('automatic')
      expect(origin('weld_joints', undefined, { ...row, id: 44, hasRk: 'да' }, 'hasRk')).toBe('automatic')
    }
    expect(Object.keys(row)).toHaveLength(5)
  })
  it.each(['importWeldJoints', 'replaceWeldJoints'])('keeps %s provenance independent of server mutations of submitted rows', operation => {
    const identity = { projectTitle: 'Проект', subtitleCode: 'Шифр', line: 'Линия', joint: '1' }
    const row: Record<string, unknown> = { ...identity, ...(operation === 'replaceWeldJoints' ? { id: 44 } : {}),
      category: null, weldingJournalNote: 'Введено пользователем' }
    const origin = createAuditOriginResolver(operation, { records: [row] })
    // prepareLineProgramWeldRecords fills the same input object before audit
    // flush. These values were not entered in the imported file.
    Object.assign(row, { category: 'I', groupName: 'Группа линии', weldControlPercent: 100 })
    const before = operation === 'replaceWeldJoints' ? { id: 44, ...identity, category: null } : undefined
    const after = { ...row, id: 44 }
    for (const key of ['category', 'groupName', 'weldControlPercent']) expect(origin('weld_joints', before, after, key)).toBe('automatic')
    expect(origin('weld_joints', before, after, 'weldingJournalNote')).toBe('user')
  })
  it('captures a submitted date independently without copying nested row metadata', () => {
    const weldDate = new Date('2026-11-01T00:00:00Z')
    const input = { id: 44, weldDate, get sourceMetadata(): never { throw new Error('Do not read derived metadata') } }
    const origin = createAuditOriginResolver('updateWeldJoint', input)
    weldDate.setUTCDate(2)
    expect(origin('weld_joints', { id: 44 }, { id: 44, weldDate: '2026-11-01' }, 'weldDate')).toBe('user')
    expect(origin('weld_joints', { id: 44 }, { id: 44, weldDate: '2026-11-02' }, 'weldDate')).toBe('automatic')
  })
  it('distinguishes an explicitly generated/deleted document from an automatic workflow document', () => {
    for (const operation of ['saveRemoteGeneratedDocuments', 'deleteRemoteGeneratedDocument', 'applyDocumentOperation']) {
      const origin = createAuditOriginResolver(operation, {})
      expect(origin('generated_documents', { title: 'Документ' }, undefined, 'title')).toBe('user')
      expect(origin('generated_document_weld_joints', { documentId: 44 }, undefined, 'documentId')).toBe('automatic')
      expect(origin('weld_joints', { jsrDocument: 'Документ' }, { jsrDocument: null }, 'jsrDocument')).toBe('automatic')
    }
  })
  it('keeps a deliberate weld deletion separate from cascading child deletions', () => {
    const origin = createAuditOriginResolver('deleteWeldJoint', { id: 7 })
    expect(origin('weld_joints', { id: 7, joint: '1' }, undefined, 'joint')).toBe('user')
    expect(origin('psto_repeat_cycles', { weldJointId: 7, pstoRequest: 'ПСТО' }, undefined, 'pstoRequest')).toBe('automatic')
    expect(createAuditOriginResolver('replaceWeldJoints', { records: [], deleteIds: [7] })('weld_joints', { id: 7, joint: '1' }, undefined, 'joint')).toBe('user')
  })
  it('keeps PSTO cycle dates/results direct and generated numbering/system documents automatic', () => {
    const origin = createAuditOriginResolver('savePstoRepeatWorkflow', { action: 'pstoRequest', groups: [{ rowIds: [7], name: 'ПСТО-1', useSystemName: true }] })
    const row = { id: 4, weldJointId: 7, sequence: 2, pstoRequest: 'ПСТО-1', pstoRequestDate: '2026-11-02' }
    expect(origin('psto_repeat_cycles', undefined, row, 'pstoRequestDate')).toBe('user')
    expect(origin('psto_repeat_cycles', undefined, row, 'pstoRequest')).toBe('automatic')
    expect(origin('psto_repeat_cycles', undefined, row, 'sequence')).toBe('automatic')
    expect(origin('generated_documents', undefined, { title: 'ПСТО-1' }, 'title')).toBe('automatic')
    const correction = createAuditOriginResolver('correctPstoCycleStage', { rowId: 7, sequence: 2, stage: 'tvmtResult', action: 'delete' })
    expect(correction('psto_repeat_cycles', row, { ...row, tvmtResult: null }, 'tvmtResult')).toBe('user')
    expect(correction('psto_repeat_cycles', row, { ...row, sequence: 3, tvmtResult: null }, 'tvmtResult')).toBe('automatic')
  })
  it('uses stored NK-before-TO column names and limits staged edits to the result', () => {
    const row = { id: 4, weldJointId: 7, method: 'ВИК', result: 'годен', conclusionDate: '2026-11-02', conclusionName: 'ВИК-1' }
    const origin = createAuditOriginResolver('savePreHeatTreatmentLnkWorkflow', { action: 'result', groups: [{ positions: [{ rowId: 7, methodCode: 'ВИК' }], useSystemName: true }] })
    expect(origin('pre_heat_treatment_controls', undefined, row, 'result')).toBe('user')
    expect(origin('pre_heat_treatment_controls', undefined, row, 'conclusionDate')).toBe('user')
    expect(origin('pre_heat_treatment_controls', undefined, row, 'conclusionName')).toBe('automatic')
    const correction = createAuditOriginResolver('correctPreHeatTreatmentLnkResult', { relationId: 4, stage: 'request', requestDate: '2026-11-02' })
    expect(correction('pre_heat_treatment_controls', row, row, 'requestDate')).toBe('user')
    expect(correction('pre_heat_treatment_controls', row, row, 'result')).toBe('automatic')
    expect(createAuditOriginResolver('savePreHeatTreatmentLnkResultEdits', { changes: [{ relationId: 4, result: 'годен' }] })('pre_heat_treatment_controls', row, row, 'conclusionDate')).toBe('automatic')
  })
  it('does not invent provenance for an unknown future operation or obey submitted origin flags', () => {
    expect(createAuditOriginResolver('futureOperation', { origin: 'user' })('generated_documents', undefined, { title: 'Документ' }, 'title')).toBeUndefined()
  })
  it('keeps explicit defect corrections direct in either NK stage, including clearing', () => {
    const before = { id: 4, weldJointId: 7, result: 'ремонт', defectDescription: 'Дефект' }
    const after = { ...before, defectDescription: null }
    const origin = createAuditOriginResolver('updateLnkDefectDescription', { stage: 'beforeHeatTreatment', value: '' })
    expect(origin('pre_heat_treatment_controls', before, after, 'defectDescription')).toBe('user')
    expect(origin('weld_joints', { finalStatus: 'ремонт' }, { finalStatus: 'годен' }, 'finalStatus')).toBe('automatic')
    const primary = createAuditOriginResolver('updateLnkDefectDescription', { stage: 'primary', value: '' })
    expect(primary('weld_joints', { lnkDefectDescription: 'Дефект' }, { lnkDefectDescription: null }, 'lnkDefectDescription')).toBe('user')
    const result = createAuditOriginResolver('savePreHeatTreatmentLnkWorkflow', { action: 'result' })
    expect(result('pre_heat_treatment_controls', { ...before, rkExposureConfirmedDiameter: 108 }, { ...after, result: 'годен', rkExposureConfirmedDiameter: null }, 'rkExposureConfirmedDiameter')).toBe('automatic')
  })
  it('attributes a deliberate document-date change to the user at the actual source stage', () => {
    for (const [reference, entity, key] of [
      [{ type: 'lnkRequest', methodCode: 'ВИК' }, 'weld_joints', 'vikRequestDate'],
      [{ type: 'lnkConclusion', methodCode: 'РК' }, 'weld_joints', 'rkConclusionDate'],
      [{ type: 'lnkConclusion', methodCode: 'ВИК', sourceKind: 'beforeHeatTreatment' }, 'pre_heat_treatment_controls', 'conclusionDate'],
      [{ type: 'pstoRequest', sourceKind: 'pstoCycle' }, 'psto_repeat_cycles', 'pstoRequestDate'],
      [{ type: 'pstoConclusion', sourceKind: 'pstoCycle' }, 'weld_joints', 'pstoDate'],
      [{ type: 'lnkConclusion', methodCode: 'ТВМТ', sourceKind: 'pstoCycle' }, 'psto_repeat_cycles', 'tvmtConclusionDate'],
    ] as const) {
      const origin = createAuditOriginResolver('changeSystemDocumentDate', { reference, nextDate: '2026-11-02' })
      expect(origin(entity, { [key]: '2026-11-01' }, { [key]: '2026-11-02' }, key)).toBe('user')
      expect(origin('generated_documents', {}, { periodFrom: '2026-11-02' }, 'periodFrom')).toBe('user')
      expect(origin('generated_documents', {}, { sourceMetadata: '{}' }, 'sourceMetadata')).toBe('automatic')
      expect(origin('weld_joints', {}, { weldDate: '2026-11-02' }, 'weldDate')).toBe('automatic')
    }
  })
  it('handles 200000 submitted rows with bounded lookups and only submitted writable values', () => {
    const records = Array.from({ length: 200_000 }, (_, i) => ({ id: i + 1, weldingJournalNote: String(i) }))
    const origin = createAuditOriginResolver('massFillWeldJoints', { records })
    for (const row of records) expect(origin('weld_joints', { id: row.id }, row, 'weldingJournalNote')).toBe('user')
    expect(origin('weld_joints', { id: 200_001 }, { id: 200_001 }, 'weldingJournalNote')).toBe('automatic')
  })
})
