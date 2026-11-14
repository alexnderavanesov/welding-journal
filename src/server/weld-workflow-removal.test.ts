import { describe, expect, it } from 'vitest'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import type { WeldInput } from '@/lib/weld-fields'
import { isWeldWorkflowRemoval } from './weld-workflow-removal'
import { restrictWeldMutationRecord } from './weld-mutation-policy'
import { normalizePreHeatTreatmentResultEditBatch } from '@/lib/pre-heat-treatment-result-edit-plan'

describe('deletion rights for saved workflow facts', () => {
  for (const method of LNK_METHODS) {
    it.each(['годен', 'ремонт', 'вырез', 'да', 'не годен', 'негоден', 'годен (отменен)', 'ремонт · назначение отменено'])(
      `${method.code}: removing saved result %s requires delete, including legacy facts`, result => {
        const previous = { [method.resultKey]: result }
        for (const next of [null, '', ' ', 'ожидает', 'ожидает НК', 'ожидает заявку']) {
          expect(isWeldWorkflowRemoval({ [method.resultKey]: next }, previous, 'lnk')).toBe(true)
        }
        for (const next of ['годен', 'ремонт', 'вырез']) {
          expect(isWeldWorkflowRemoval({ [method.resultKey]: next }, previous, 'lnk')).toBe(false)
        }
      },
    )
    it(`${method.code}: protects request and legacy conclusion names, while preserving renames`, () => {
      for (const key of [method.requestKey, method.conclusionKey]) {
        const previous = { [key]: 'Historic document', [method.resultKey]: 'ожидает НК' }
        expect(isWeldWorkflowRemoval({ ...previous, [key]: null }, previous, 'lnk')).toBe(true)
        expect(isWeldWorkflowRemoval({ ...previous, [key]: 'Corrected document' }, previous, 'lnk')).toBe(false)
      }
    })
    it(`${method.code}: clearing the last date of an unnamed historical document is deletion`, () => {
      for (const [name, date] of [[method.requestKey, method.requestDateKey], [method.conclusionKey, method.conclusionDateKey]]) {
        const previous = { [date]: '2026-11-01' }
        expect(isWeldWorkflowRemoval({ [date]: null }, previous, 'lnk')).toBe(true)
        expect(isWeldWorkflowRemoval({ [date]: '2026-11-02' }, previous, 'lnk')).toBe(false)
        expect(isWeldWorkflowRemoval({ ...previous, [name]: 'Recovered name' }, previous, 'lnk')).toBe(false)
      }
    })
  }

  it.each(['проведено', 'да', 'проведено (отменен)', 'проведено · назначение отменено'])('protects completed PSTO %s', result => {
    expect(isWeldWorkflowRemoval({ pstoResult: 'ожидает' }, { pstoResult: result }, 'psto')).toBe(true)
    expect(isWeldWorkflowRemoval({ pstoResult: 'проведено' }, { pstoResult: result }, 'psto')).toBe(false)
  })
  it.each(['годен', 'да', 'не годен', 'негоден', 'ремонт', 'вырез', 'не годен · назначение отменено'])('protects completed TVMT %s', result => {
    expect(isWeldWorkflowRemoval({ tvmtResult: null }, { tvmtResult: result }, 'psto')).toBe(true)
    expect(isWeldWorkflowRemoval({ tvmtResult: 'не годен' }, { tvmtResult: result }, 'psto')).toBe(false)
  })
  it.each(['pstoRequest', 'heatTreatmentDiagram', 'tvmtRequest', 'tvmtConclusion'] as const)('protects %s identity, including partial legacy data', key => {
    expect(isWeldWorkflowRemoval({ [key]: null }, { [key]: 'Saved document' }, 'psto')).toBe(true)
    expect(isWeldWorkflowRemoval({ [key]: 'Renamed document' }, { [key]: 'Saved document' }, 'psto')).toBe(false)
  })
  it.each(['pstoRequestDate', 'pstoDate', 'tvmtRequestDate', 'tvmtConclusionDate'] as const)('protects unnamed historical document date %s', key => {
    expect(isWeldWorkflowRemoval({ [key]: null }, { [key]: '2026-11-01' }, 'psto')).toBe(true)
    expect(isWeldWorkflowRemoval({ [key]: '2026-11-02' }, { [key]: '2026-11-01' }, 'psto')).toBe(false)
  })
  it('does not interpret a waiting-only label or new entry as deleting a performed fact', () => {
    for (const scope of ['lnk', 'psto'] as const) {
      expect(isWeldWorkflowRemoval({}, { vikResult: 'ожидает НК', pstoResult: 'ожидает заявку', tvmtResult: 'ожидает' }, scope)).toBe(false)
      expect(isWeldWorkflowRemoval({ vikResult: 'годен', pstoResult: 'проведено' }, undefined, scope)).toBe(false)
    }
  })
  it('compares merged permitted fields without interpreting an unrelated partial patch as deletion', () => {
    const previous: WeldInput = { id: 1, vikRequest: 'R', vikResult: 'годен', vikConclusion: 'C',
      pstoResult: 'проведено', heatTreatmentDiagram: 'D' }
    for (const scope of ['welding', 'lnk', 'psto'] as const) {
      const record = { ...previous, ...restrictWeldMutationRecord({ id: 1, lnkNote: 'Correction' }, scope) }
      expect(isWeldWorkflowRemoval(record, previous, scope)).toBe(false)
    }
    expect(isWeldWorkflowRemoval({}, previous, 'welding')).toBe(false)
  })

  it.each(['', ' ', 'ожидает', 'ожидает НК', undefined])('pre-TO result edits reject disguised removal %s', result => {
    expect(() => normalizePreHeatTreatmentResultEditBatch({ changes: [{ rowId: 1, relationId: 2,
      expectedVersion: 'v1', result: result as string }] })).toThrow('Выберите результат')
  })
  it('pre-TO explicit removal stays null for its dedicated delete guard', () => {
    expect(normalizePreHeatTreatmentResultEditBatch({ changes: [{ rowId: 1, relationId: 2,
      expectedVersion: 'v1', result: null }] }).changes[0].result).toBeNull()
  })
})
