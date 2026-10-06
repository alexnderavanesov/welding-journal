import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import { getLnkChronologyIssues, findFirstNewLnkChronologySaveBlockReason } from './lnk-chronology-checks'
import { getLayeredControlSaveIssues } from './layered-control-rules'

const row: WeldRow = { id: 1, joint: 'F1', connectionType: 'СШ', weldDate: '2026-09-01', hasVik: 'да',
  vikResult: 'годен', vikConclusionDate: '2026-09-10', hasPvk: 'да', pvkResult: 'годен', pvkConclusionDate: '2026-09-11' }
const settings = { ...DEFAULT_SAVE_CHECK_SETTINGS, lnkResultRequestDateOrder: false,
  lnkResultVikRequiredBeforeOther: false, lnkResultVikDateBeforeOther: false }
const systemIssues = (value: WeldRow) => getLnkChronologyIssues([value], settings).filter(issue =>
  ['method-order', 'multiple-rejections'].includes(issue.kind))

describe('non-optional system order of own NDT', () => {
  it('allows assigning PVK after completed RK, but checks the actual PVK date and new downstream results', () => {
    const previous = { ...row, hasPvk: null, pvkResult: null, pvkConclusionDate: null, rkResult: 'годен', rkConclusionDate: '2026-09-12' }
    const assigned = { ...previous, hasPvk: 'да' }
    expect(findFirstNewLnkChronologySaveBlockReason([assigned], [previous], settings)).toBe('')
    expect(findFirstNewLnkChronologySaveBlockReason([{ ...assigned, uzkResult: 'годен', uzkConclusionDate: '2026-09-12' }], [previous], settings)).toContain('требуется годный ПВК')
    expect(findFirstNewLnkChronologySaveBlockReason([{ ...assigned, pvkResult: 'годен', pvkConclusionDate: '2026-09-11' }], [assigned], settings)).toBe('')
    expect(findFirstNewLnkChronologySaveBlockReason([{ ...assigned, pvkResult: 'годен', pvkConclusionDate: '2026-09-13' }], [assigned], settings)).toContain('позже РК')
    expect(findFirstNewLnkChronologySaveBlockReason([{ ...assigned, rkConclusionDate: '2026-09-13' }], [previous], settings)).toContain('требуется годный ПВК')
  })
  it('also permits late PVK assignment before TO without substituting results between stages', () => {
    const previous: WeldRow = { ...row, hasPvk: null, pvkResult: null, preHeatTreatmentLnkEnabled: true, preHeatTreatmentControls: [
      { id: 1, weldJointId: 1, method: 'ВИК', result: 'годен', conclusionDate: '2026-09-09' },
      { id: 2, weldJointId: 1, method: 'РК', result: 'годен', conclusionDate: '2026-09-12' },
    ] }
    expect(findFirstNewLnkChronologySaveBlockReason([{ ...previous, hasPvk: 'да' }], [previous], settings)).toBe('')
  })
  it('requires good assigned PVK before completed RK, regardless of the optional settings', () => {
    expect(systemIssues({ ...row, pvkResult: 'ожидает НК', rkResult: 'годен', rkConclusionDate: '2026-09-12' })).toHaveLength(1)
    expect(systemIssues({ ...row, pvkResult: null, rkRequest: 'RK', rkRequestDate: '2026-09-09' })).toEqual([])
  })
  it('accepts same-day results and earlier factual backfill, rejects a later PVK', () => {
    for (const date of ['2026-09-11', '2026-09-12']) expect(systemIssues({ ...row, rkResult: 'годен', rkConclusionDate: date })).toEqual([])
    expect(systemIssues({ ...row, pvkConclusionDate: '2026-09-13', rkResult: 'годен', rkConclusionDate: '2026-09-12' })).toHaveLength(1)
    const previous = { ...row, pvkResult: null, rkResult: 'годен', rkConclusionDate: '2026-09-12' }
    expect(findFirstNewLnkChronologySaveBlockReason([{ ...previous, pvkResult: 'годен' }], [previous], settings)).toBe('')
  })
  it('allows a good peer method before or on the rejection date, never after it', () => {
    const rejected = { ...row, rkResult: 'ремонт', rkConclusionDate: '2026-09-12', uzkResult: 'годен' }
    for (const date of ['2026-09-11', '2026-09-12']) expect(systemIssues({ ...rejected, uzkConclusionDate: date })).toEqual([])
    expect(systemIssues({ ...rejected, uzkConclusionDate: '2026-09-13' })).toHaveLength(1)
  })
  it('rejects two own failures even on the same date, and stops later levels after failed VIK', () => {
    expect(systemIssues({ ...row, rkResult: 'ремонт', rkConclusionDate: '2026-09-12', uzkResult: 'вырез', uzkConclusionDate: '2026-09-12' }).some(issue => issue.kind === 'multiple-rejections')).toBe(true)
    expect(systemIssues({ ...row, vikResult: 'ремонт' }).some(issue => issue.kind === 'method-order')).toBe(true)
  })
  const methods = ['vik', 'pvk', 'rk', 'uzk'] as const
  const slots = [false, true].flatMap(beforeHeatTreatment => methods.map(method => ({ beforeHeatTreatment, method })))
  for (let left = 0; left < slots.length; left++) for (let right = left + 1; right < slots.length; right++) {
    const pair = [slots[left], slots[right]]
    it(`counts own failures across both stages: ${pair.map(slot => `${slot.method}/${slot.beforeHeatTreatment ? 'pre' : 'primary'}`).join(' + ')}`, () => {
      const value: WeldRow = { ...row, preHeatTreatmentLnkEnabled: true,
        rkResult: 'годен', uzkResult: 'годен', rkConclusionDate: '2026-09-11', uzkConclusionDate: '2026-09-11',
        preHeatTreatmentControls: methods.map((method, index) => ({
          id: index + 1, weldJointId: 1, method: { vik: 'ВИК', pvk: 'ПВК', rk: 'РК', uzk: 'УЗК' }[method],
          result: 'годен', conclusionDate: '2026-09-11',
        })),
      }
      pair.forEach((slot, index) => {
        const result = index === 0 ? 'ремонт' : 'вырез'
        if (slot.beforeHeatTreatment) value.preHeatTreatmentControls![methods.indexOf(slot.method)].result = result
        else value[`${slot.method}Result`] = result
      })
      expect(systemIssues(value).filter(issue => issue.kind === 'multiple-rejections')).toHaveLength(1)
    })
  }
  it('checks the pre-TO stage separately, without substituting a primary VIK', () => {
    const before: WeldRow = { ...row, preHeatTreatmentLnkEnabled: true, preHeatTreatmentControls: [
      { id: 10, weldJointId: 1, method: 'РК', result: 'годен', conclusionDate: '2026-09-09' },
    ] }
    expect(systemIssues(before).length).toBeGreaterThan(0)
    expect(systemIssues({ ...before, preHeatTreatmentControls: [
      { id: 10, weldJointId: 1, method: 'РК', result: 'годен', conclusionDate: '2026-09-09' },
      { id: 11, weldJointId: 1, method: 'ВИК', result: 'годен', conclusionDate: '2026-09-08' },
      { id: 12, weldJointId: 1, method: 'ПВК', result: 'годен', conclusionDate: '2026-09-09' },
    ] })).toEqual([])
  })
  it('does not impose our sequence on duplicates, and preserves unrelated legacy edits', () => {
    expect(systemIssues({ ...row, rkResult: 'ремонт', rkConclusionDate: '2026-09-12', duplicateControls: [{ id: 1, weldJointId: 1, method: 'УЗК', result: 'ремонт', conclusion: 'D', conclusionDate: '2026-09-01', controlDate: '2026-09-01' }] })).toEqual([])
    const legacy = { ...row, rkResult: 'ремонт', uzkResult: 'ремонт', rkConclusionDate: '2026-09-12', uzkConclusionDate: '2026-09-12' }
    expect(findFirstNewLnkChronologySaveBlockReason([{ ...legacy, joint: 'F2' }], [legacy], settings)).toBe('')
  })
  it('allows one rejection on each separate record in a repair chain', () => {
    const source = { ...row, joint: 'S1', rkResult: 'ремонт', rkConclusionDate: '2026-09-12' }
    const repair: WeldRow = { ...source, id: 2, joint: 'S1R1', programChainState: {
      weldJointId: 2, kind: 'repair', physicalRootId: 1, sourceRowId: 1,
      coilParentId: null, coilSide: null, replacedByCoil: false, replacementCoilIds: [],
    } }
    expect(getLnkChronologyIssues([source, repair], settings)).toEqual([])
  })
  it('rejects layered plus any saved duplicate and reports overlapping PVK errors together', () => {
    const value: WeldRow = { ...row, connectionType: 'УШ', layeredControlAssigned: true, hasPvk: null,
      duplicateControls: [{ id: 1, weldJointId: 1, method: 'УЗК', result: 'годен', conclusion: 'D', conclusionDate: '2026-09-01', controlDate: '2026-09-01' }] }
    const issues = getLayeredControlSaveIssues(value)
    expect(issues.some(issue => issue.message.includes('дубль'))).toBe(true)
    expect(issues.some(issue => issue.message.includes('ПВК ='))).toBe(true)
  })
})
