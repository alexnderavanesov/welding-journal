import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { canSelectLnkResultRow } from './lnk-result-modal-rows'
import { getPendingLnkResultMethods } from './lnk-result-navigation'
import { buildPreHeatTreatmentResultWrite, buildPreHeatTreatmentRequestWrites, canAddPreHeatTreatmentResult, canCreatePreHeatTreatmentRequest, getPreHeatTreatmentResultRemovalBlockReason } from './pre-heat-treatment-control-updates'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import { buildLnkRequestRows } from './lnk-request-mutation-updates'
import { getAvailableLnkRequestMethods } from './lnk-status'
import { buildLnkToRequestRows, buildLnkWaitingNkRows } from './lnk-report-rows'
import { buildJointNextActions } from './joint-next-actions'
import { findFirstNewLnkChronologySaveBlockReason } from './lnk-chronology-checks'

const primary: WeldRow = { id: 1, joint: 'F1', connectionType: 'СШ', weldDate: '2026-09-01',
  hasVik: 'да', vikResult: 'годен', vikConclusionDate: '2026-09-09',
  hasRk: 'да', rkResult: 'ремонт', rkConclusionDate: '2026-09-11',
  hasUzk: 'да', uzkRequest: 'UZK', uzkRequestDate: '2026-09-09', uzkResult: 'ожидает НК' }
const staged: WeldRow = { id: 2, joint: 'F2', connectionType: 'СШ', weldDate: '2026-09-01',
  hasVik: 'да', hasRk: 'да', hasUzk: 'да', pstoRequired: 'да', preHeatTreatmentLnkEnabled: true,
  preHeatTreatmentControls: [
    { id: 1, weldJointId: 2, method: 'ВИК', requestName: 'VIK', requestDate: '2026-09-09', result: 'годен', conclusionDate: '2026-09-09', conclusionName: 'VIK-C' },
    { id: 2, weldJointId: 2, method: 'РК', requestName: 'RK', requestDate: '2026-09-09', result: 'ремонт', conclusionDate: '2026-09-11', conclusionName: 'RK-C' },
    { id: 3, weldJointId: 2, method: 'УЗК', requestName: 'UZK', requestDate: '2026-09-09', result: 'ожидает НК' },
  ] }
const settings = { ...DEFAULT_SAVE_CHECK_SETTINGS, lnkResultVikRequiredBeforeOther: false, lnkResultVikDateBeforeOther: false }

describe('entry points for factual result backfill after own rejection', () => {
  it('allows historical primary requests, not new waiting debt, and checks all factual dates', () => {
    const previous = { ...primary, uzkRequest: null, uzkRequestDate: null, uzkResult: null }
    expect(getAvailableLnkRequestMethods(previous).map(method => method.code)).toContain('УЗК')
    expect(buildLnkToRequestRows([previous])).toEqual([])
    expect(buildJointNextActions(previous).map(action => action.kind)).not.toContain('primaryLnkRequest')
    const [requested] = buildLnkRequestRows({ records: [previous], methodKeys: ['uzkRequest'], requestName: 'UZK', requestDate: '2026-09-09' })
    expect(requested.uzkRequest).toBe('UZK')
    expect(buildLnkWaitingNkRows([requested])).toEqual([])
    for (const date of ['2026-08-31', '2026-09-12']) expect(() => buildLnkRequestRows({ records: [previous], methodKeys: ['uzkRequest'], requestName: 'UZK', requestDate: date })).toThrow(/Дата исторической заявки/)
    const unchecked = { ...settings, lnkResultRequestDateOrder: false, lnkResultDateAfterWeldDate: false }
    expect(findFirstNewLnkChronologySaveBlockReason([{ ...requested, uzkResult: 'годен', uzkConclusionDate: '2026-09-08' }], [requested], unchecked)).toContain('сварка ≤ заявка ≤ заключение')
    expect(findFirstNewLnkChronologySaveBlockReason([{ ...requested, uzkResult: 'годен', uzkConclusionDate: '2026-09-10' }], [requested], unchecked)).toBe('')
  })
  it('allows historical pre-TO requests with date guards even when optional checks are off', () => {
    const previous = { ...staged, preHeatTreatmentControls: staged.preHeatTreatmentControls!.filter(control => control.method !== 'УЗК') }
    const unchecked = { ...settings, lnkResultRequestDateOrder: false }
    expect(canCreatePreHeatTreatmentRequest(previous, 'УЗК')).toBe(true)
    expect(buildPreHeatTreatmentRequestWrites({ row: previous, methodCodes: ['УЗК'], requestName: 'UZK', requestDate: '2026-09-09', saveCheckSettings: unchecked })).toHaveLength(1)
    for (const date of ['2026-08-31', '2026-09-12']) expect(() => buildPreHeatTreatmentRequestWrites({ row: previous, methodCodes: ['УЗК'], requestName: 'UZK', requestDate: date, saveCheckSettings: unchecked })).toThrow(/Дата исторической заявки/)
  })
  it('keeps a requested primary peer selectable without demanding new control', () => {
    expect(canSelectLnkResultRow(primary, 'UZK', 'uzkRequest', '2026-09-09')).toBe(true)
    expect(getPendingLnkResultMethods(primary).map(method => method.code)).toContain('УЗК')
    expect(canSelectLnkResultRow({ ...primary, vikResult: 'вырез', rkResult: null }, 'UZK', 'uzkRequest')).toBe(false)
  })
  it.each(['2026-09-10', '2026-09-11'])('opens and saves earlier or same-day pre-TO UZK: %s', date => {
    expect(canAddPreHeatTreatmentResult(staged, 'УЗК', settings)).toBe(true)
    expect(buildPreHeatTreatmentResultWrite({ row: staged, methodCode: 'УЗК', controlDate: date,
      result: 'годен', conclusionName: 'UZK-C', saveCheckSettings: settings })).toMatchObject({ result: 'годен', conclusionDate: date })
  })
  it('shows a date error or second-failure error before submitting pre-TO results', () => {
    expect(() => buildPreHeatTreatmentResultWrite({ row: staged, methodCode: 'УЗК', controlDate: '2026-09-12',
      result: 'годен', conclusionName: 'UZK-C', saveCheckSettings: settings })).toThrow('после негодного РК')
    expect(() => buildPreHeatTreatmentResultWrite({ row: staged, methodCode: 'УЗК', controlDate: '2026-09-11',
      result: 'вырез', conclusionName: 'UZK-C', saveCheckSettings: settings })).toThrow('только один негодный результат')
  })
  it('never disables pre-TO prerequisites or their removal guards with optional settings', () => {
    const vik = staged.preHeatTreatmentControls![0]!
    expect(canAddPreHeatTreatmentResult({ ...staged, preHeatTreatmentControls: staged.preHeatTreatmentControls!.filter(c => c.method !== 'ВИК') }, 'УЗК', settings)).toBe(false)
    expect(getPreHeatTreatmentResultRemovalBlockReason(staged, vik, settings)).toContain('сохранены результаты: РК')
    const pvk = { ...vik, id: 4, method: 'ПВК' }
    expect(getPreHeatTreatmentResultRemovalBlockReason({ ...staged, hasPvk: 'да', preHeatTreatmentControls: [...staged.preHeatTreatmentControls!, pvk] }, pvk, settings)).toContain('сохранены результаты: РК')
  })
})
