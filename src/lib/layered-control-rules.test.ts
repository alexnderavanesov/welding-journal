import { describe, expect, it } from 'vitest'
import { buildLayeredControlAssignment, getLayeredControlSaveError, getLayeredControlContextActionBlockReason } from './layered-control-rules'
import { getRequiredLayeredControlDocumentTypes } from './layered-control-documents'
import type { WeldRow } from './dispatcher-types'

const base: WeldRow = { id: 1, joint: 'F1', connectionType: 'У17', weldDate: '2026-09-01', hasVik: 'да', hasPvk: 'да' }
describe('explicit layered control', () => {
  it('uses assignment protection in the LNK context menu without banning earlier planning', () => {
    const good = { ...base, pvkResult: 'годен' }
    expect(getLayeredControlContextActionBlockReason(good)).toBeNull()
    expect(getLayeredControlContextActionBlockReason({ ...good, officiality: 'неофициальный' })).toContain('официального актуального')
    expect(getLayeredControlContextActionBlockReason({ ...good, revisionActuality: 'не актуален' })).toContain('официального актуального')
    expect(getLayeredControlContextActionBlockReason({ ...good, connectionType: 'С17' })).toContain('только для У')
    expect(getLayeredControlContextActionBlockReason({ ...good, uzkResult: 'ремонт' })).toContain('нельзя сохранить')
    expect(getLayeredControlContextActionBlockReason({ ...good, duplicateControls: [{ id: 1, weldJointId: 1, method: 'УЗК', result: 'годен', controlDate: '', conclusion: '', conclusionDate: '' }] })).toContain('дубль-контролем')
    expect(getLayeredControlContextActionBlockReason(base)).toContain('основной результат')
    expect(buildLayeredControlAssignment(base, true).layeredControlAssigned).toBe(true)
  })
  it('does not introduce RK on T joints, while leaving unchanged historical RK intact', () => {
    const legacy = { ...base, connectionType: 'ТШ', hasRk: 'да' }
    expect(getLayeredControlSaveError(legacy)).toContain('РК не назначается')
    expect(getLayeredControlSaveError(legacy, legacy)).toBeNull()
    expect(getLayeredControlSaveError({ ...legacy, hasRk: 'отменен' }, legacy)).toBeNull()
    expect(() => buildLayeredControlAssignment({ ...legacy, hasRk: '' }, true)).toThrow('только для У')
  })
  it('neither VIK=yes nor PVK=yes alone creates documents', () => {
    expect(getRequiredLayeredControlDocumentTypes({ ...base, pvkResult: 'годен' })).toEqual([])
    const assigned = buildLayeredControlAssignment(base, false)
    expect(getRequiredLayeredControlDocumentTypes(assigned)).toEqual([])
    expect(getRequiredLayeredControlDocumentTypes({ ...assigned, pvkResult: 'годен' })).toHaveLength(4)
  })
  it.each(['отменен', 'дополнительный'])('requires confirmation to convert %s to yes', (hasPvk) => {
    expect(() => buildLayeredControlAssignment({ ...base, hasPvk }, false)).toThrow('Подтвердите')
    expect(buildLayeredControlAssignment({ ...base, hasPvk }, true)).toMatchObject({ hasPvk: 'да', layeredControlAssigned: true })
  })
  it('rejects C and protects clearing own main PVK until explicit removal', () => {
    expect(() => buildLayeredControlAssignment({ ...base, connectionType: 'С17' }, true)).toThrow('только для У')
    const previous = { ...base, layeredControlAssigned: true, pvkResult: 'годен' }
    expect(getLayeredControlSaveError({ ...previous, pvkResult: null }, previous)).toContain('Сначала уберите')
    expect(getLayeredControlSaveError({ ...previous, layeredControlAssigned: false }, previous)).toContain('отдельной командой')
    expect(getLayeredControlSaveError({ ...base, pvkResult: null }, { ...base, pvkResult: 'годен' })).toBeNull()
  })
  it.each(['vikResult', 'rkResult', 'uzkResult', 'pvkResult'] as const)('forbids either rejected result in %s', (key) => {
    for (const result of ['ремонт', 'вырез']) expect(getLayeredControlSaveError({ ...base, layeredControlAssigned: true, [key]: result })).toContain('нельзя сохранить')
  })
  it.each(['ВИК', 'РК', 'УЗК', 'ПВК'] as const)('forbids rejected %s before TO and in duplicates', (method) => {
    for (const result of ['ремонт', 'вырез'] as const) {
      expect(getLayeredControlSaveError({ ...base, layeredControlAssigned: true, preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method, result }] })).toContain('нельзя сохранить')
      expect(getLayeredControlSaveError({ ...base, layeredControlAssigned: true, duplicateControls: [{ id: 1, weldJointId: 1, method, result, controlDate: '', conclusion: '', conclusionDate: '' }] })).toContain('дубл')
    }
  })
  it('keeps TVMT independent and duplicate PVK outside the good-only setting', () => {
    expect(getLayeredControlSaveError({ ...base, layeredControlAssigned: true, tvmtResult: 'вырез' })).toBeNull()
    expect(getLayeredControlSaveError({ ...base, duplicateControls: [{ id: 1, weldJointId: 1, method: 'ПВК', result: 'вырез', controlDate: '', conclusion: '', conclusionDate: '' }] }, base, true)).toBeNull()
  })
  it('good-only rejects new own PVK failures but preserves unchanged historical facts', () => {
    expect(getLayeredControlSaveError({ ...base, pvkResult: 'вырез' }, base, true)).toContain('только годен')
    expect(getLayeredControlSaveError({ ...base, pvkResult: 'вырез', lnkNote: 'уточнение' }, { ...base, pvkResult: 'вырез' }, true)).toBeNull()
    const old = { ...base, preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ПВК', result: 'вырез' }] }
    expect(getLayeredControlSaveError(old, base, true)).toContain('только годен')
    expect(getLayeredControlSaveError(old, old, true)).toBeNull()
  })
})
