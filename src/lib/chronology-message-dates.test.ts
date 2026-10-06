import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildPreHeatTreatmentRequestWrites,
  buildPreHeatTreatmentRequestCorrectionWrite,
  buildPreHeatTreatmentResultWrite,
  buildPreHeatTreatmentResultCorrectionWrite,
} from '@/lib/pre-heat-treatment-control-updates'
import { buildPrimaryTvmtRequestRows, buildPrimaryTvmtResultRows } from '@/lib/tvmt-field-updates'
import { buildRepeatPstoRequestCycle, buildRepeatPstoResultCycle, buildRepeatTvmtRequestCycle, buildRepeatTvmtResultCycle } from '@/lib/psto-repeat-cycle-updates'
import { applyPstoCycleCorrection } from '@/lib/psto-cycle-corrections'
import { assertPstoCancellationDateAfterHistory } from '@/lib/psto-line-assignment'
import { getDispatcherLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { getDispatcherPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

const settings = DEFAULT_SAVE_CHECK_SETTINGS
const base: WeldRow = {
  id: 626, joint: 'F52', weldDate: '2026-07-01', pstoRequired: 'да', hasVik: 'да',
  preHeatTreatmentLnkEnabled: true, pstoRequest: 'P1', pstoRequestDate: '2026-07-02',
  pstoDate: '2026-07-10', pstoResult: 'проведено', heatTreatmentDiagram: 'D1',
}
const control = { id: 1, weldJointId: 626, method: 'ВИК', requestName: 'PRE', requestDate: '2026-07-07' }
const failedPrimary: WeldRow = {
  ...base, pstoDate: '2026-07-02', tvmtRequest: 'T1', tvmtRequestDate: '2026-07-02',
  tvmtResult: 'не годен', tvmtConclusionDate: '2026-07-03', tvmtConclusion: 'TC1',
}
const repeat = {
  id: 2, weldJointId: 626, sequence: 2, pstoRequest: 'P2', pstoRequestDate: '2026-07-04',
  pstoResult: 'проведено', pstoDate: '2026-07-05', heatTreatmentDiagram: 'D2',
  tvmtRequest: 'T2', tvmtRequestDate: '2026-07-06', tvmtResult: 'годен',
  tvmtConclusion: 'TC2', tvmtConclusionDate: '2026-07-07',
}

describe('chronology messages show the actual compared dates without changing validation', () => {
  it.each([
    ['30.6.26', 'дата заявки НК до ТО (30.06.2026) не может быть раньше даты сварки (01.07.2026)'],
    ['11.7.26', 'дата заявки НК до ТО (11.07.2026) не может быть позже даты ПСТО (10.07.2026)'],
  ])('shows the draft date and boundary for a pre-TO request (%s)', (requestDate, message) => {
    const before = structuredClone(base)
    expect(() => buildPreHeatTreatmentRequestWrites({ row: base, methodCodes: ['ВИК'], requestName: 'PRE', requestDate, saveCheckSettings: settings }))
      .toThrow(`Стык F52: ${message}.`)
    expect(base).toEqual(before)
  })

  it.each([false, true])('shows both dates for pre-TO results and corrections (correction=%s)', (correction) => {
    const row = { ...base, preHeatTreatmentControls: [control] }
    for (const [date, message] of [
      ['2026-07-06', 'дата НК до ТО (06.07.2026) не может быть раньше даты заявки (07.07.2026)'],
      ['2026-07-11', 'дата НК до ТО (11.07.2026) не может быть позже даты ПСТО (10.07.2026)'],
    ]) {
      const input = { row, controlDate: date, result: 'годен', conclusionName: 'C', saveCheckSettings: settings }
      expect(() => correction ? buildPreHeatTreatmentResultCorrectionWrite({ ...input, control })
        : buildPreHeatTreatmentResultWrite({ ...input, methodCode: 'ВИК' })).toThrow(`Стык F52: ${message}.`)
    }
  })

  it('compares the edited request date with the saved conclusion, not the old request date', () => {
    expect(() => buildPreHeatTreatmentRequestCorrectionWrite({ row: base,
      control: { ...control, result: 'годен', conclusionDate: '2026-07-08' },
      requestName: 'PRE', requestDate: '2026-07-09', saveCheckSettings: settings,
    })).toThrow('дата заявки НК до ТО (09.07.2026) не может быть позже даты контроля (08.07.2026)')
  })

  it('identifies the exact method and its date when moving VIK after another pre-TO result', () => {
    expect(() => buildPreHeatTreatmentResultWrite({ row: { ...base, hasPvk: 'да', preHeatTreatmentControls: [
      control, { ...control, id: 2, method: 'ПВК', result: 'годен', conclusionDate: '2026-07-07' },
    ] }, methodCode: 'ВИК', controlDate: '2026-07-08', result: 'годен', conclusionName: 'C', saveCheckSettings: settings }))
      .toThrow('ВИК до ТО (08.07.2026) должен быть выполнен не позже остальных видов НК до ТО: ПВК (07.07.2026)')
  })

  it('shows VIK as the boundary when another pre-TO result is earlier', () => {
    const pvk = { ...control, id: 2, method: 'ПВК' }
    expect(() => buildPreHeatTreatmentResultWrite({ row: { ...base, hasPvk: 'да', preHeatTreatmentControls: [
      { ...control, result: 'годен', conclusionDate: '2026-07-09' }, pvk,
    ] }, methodCode: 'ПВК', controlDate: '2026-07-08', result: 'годен', conclusionName: 'C', saveCheckSettings: settings }))
      .toThrow('ПВК до ТО (08.07.2026) не может быть раньше ВИК до ТО (09.07.2026)')
  })

  it('keeps equality, missing boundaries and disabled chronology checks unchanged', () => {
    const create = (row: WeldRow, requestDate: string, saveCheckSettings = settings) =>
      buildPreHeatTreatmentRequestWrites({ row, requestDate, methodCodes: ['ВИК'], requestName: 'PRE', saveCheckSettings })
    expect(create(base, '2026-07-10')[0].requestDate).toBe('2026-07-10')
    expect(create({ ...base, pstoDate: null }, '2026-07-11')[0].requestDate).toBe('2026-07-11')
    expect(create(base, '2026-07-11', { ...settings, lnkResultRequestDateOrder: false })[0].requestDate).toBe('2026-07-11')
    expect(() => create(base, 'not a date')).toThrow('корректную дату')
  })

  it('shows both dates for primary TVMT requests and results', () => {
    expect(() => buildPrimaryTvmtRequestRows({ records: [base], requestName: 'T', requestDate: '2026-07-09', saveCheckSettings: settings }))
      .toThrow('дата заявки ТВМТ (09.07.2026) не может быть раньше даты ПСТО (10.07.2026)')
    const row = { ...base, tvmtRequest: 'T', tvmtRequestDate: '2026-07-12', tvmtResult: 'ожидает НК' }
    expect(() => buildPrimaryTvmtResultRows({ records: [row], controlDate: '2026-07-11', result: 'годен', conclusionName: 'C', saveCheckSettings: settings }))
      .toThrow('дата ТВМТ (11.07.2026) не может быть раньше даты заявки ТВМТ (12.07.2026)')
  })

  it('names both cycles when a repeat request predates the failed TVMT', () => {
    expect(() => buildRepeatPstoRequestCycle({ row: failedPrimary, requestName: 'P2', requestDate: '2026-07-02', saveCheckSettings: settings }))
      .toThrow('дата повторной заявки ПСТО цикла #2 (02.07.2026) не может быть раньше даты негодной ТВМТ цикла #1 (03.07.2026)')
  })

  it('shows dates and the current repeat cycle in result and request creation', () => {
    expect(() => buildRepeatPstoResultCycle({ row: { ...failedPrimary, pstoRepeatCycles: [
      { id: 2, weldJointId: 626, sequence: 2, pstoRequest: 'P2', pstoRequestDate: '2026-07-04' },
    ] }, pstoDate: '2026-07-03', diagramName: 'D2', saveCheckSettings: settings }))
      .toThrow('дата повторной ПСТО цикла #2 (03.07.2026) не может быть раньше даты заявки (04.07.2026)')
    expect(() => buildRepeatTvmtRequestCycle({ row: { ...failedPrimary, pstoRepeatCycles: [
      { ...repeat, tvmtRequest: null, tvmtRequestDate: null, tvmtResult: null, tvmtConclusionDate: null, tvmtConclusion: null },
    ] }, requestName: 'T2', requestDate: '2026-07-04', saveCheckSettings: settings }))
      .toThrow('дата заявки ТВМТ цикла #2 (04.07.2026) не может быть раньше даты повторной ПСТО (05.07.2026)')
    const row = { ...failedPrimary, pstoRepeatCycles: [{ ...repeat, tvmtResult: 'ожидает НК', tvmtConclusionDate: null, tvmtConclusion: null }] }
    for (const [date, boundary] of [['2026-07-04', 'даты повторной ПСТО (05.07.2026)'], ['2026-07-05', 'даты заявки ТВМТ (06.07.2026)']]) {
      expect(() => buildRepeatTvmtResultCycle({ row, controlDate: date, result: 'годен', conclusionName: 'TC2', saveCheckSettings: settings }))
        .toThrow(`не может быть раньше ${boundary}`)
    }
  })

  it.each([
    ['pstoRequest', '2026-07-02', 'Дата заявки ПСТО цикла #2 (02.07.2026) не может быть раньше предыдущей ТВМТ цикла #1 (03.07.2026)'],
    ['pstoResult', '2026-07-03', 'Дата результата ПСТО цикла #2 (03.07.2026) не может быть раньше даты заявки (04.07.2026)'],
    ['tvmtRequest', '2026-07-04', 'Дата заявки ТВМТ цикла #2 (04.07.2026) не может быть раньше ПСТО (05.07.2026)'],
    ['tvmtResult', '2026-07-05', 'Дата результата ТВМТ цикла #2 (05.07.2026) не может быть раньше даты заявки (06.07.2026)'],
  ] as const)('retains exact cycle context in %s correction', (stage, date, message) => {
    expect(() => applyPstoCycleCorrection({ ...failedPrimary, pstoRepeatCycles: [repeat] }, {
      sequence: 2, cycleId: 2, stage, date, action: 'update', name: 'edited', result: 'годен',
    }, settings)).toThrow(message)
  })

  it('shows both dates for cancellation conflicts', () => {
    expect(() => assertPstoCancellationDateAfterHistory([failedPrimary], '2026-07-02'))
      .toThrow('Дата решения об отмене ПСТО (02.07.2026) не может быть раньше последнего сохраненного события (03.07.2026)')
    expect(() => applyPstoCycleCorrection({ ...base, pstoCancellationDate: '2026-07-10' }, {
      sequence: 1, stage: 'pstoResult', action: 'update', date: '2026-07-11', name: 'D',
    }, settings)).toThrow('цикла #1 (11.07.2026) не может быть позже даты официальной отмены ПСТО (10.07.2026)')
  })

  it('carries the same dates and cycle context into dispatcher diagnostics', () => {
    const completed: WeldRow = { ...failedPrimary, pstoRepeatCycles: [repeat],
      vikRequest: 'V', vikRequestDate: '2026-07-01', vikResult: 'годен', vikConclusionDate: '2026-07-06',
    }
    const lnk = getDispatcherLnkChronologyIssues([completed]).find((issue) => issue.kind === 'post-before-tvmt')
    expect(lnk?.message).toBe('Стык F52: дата заключения ВИК после ТО (06.07.2026) раньше ТВМТ цикла #2 (07.07.2026).')
    const earlier: WeldRow = { ...failedPrimary, pstoRepeatCycles: [{ ...repeat, pstoRequestDate: '2026-07-02' }] }
    const psto = getDispatcherPstoChronologyIssues([earlier])
      .find((issue) => issue.kind === 'previous-tvmt-after-repeat-request')
    expect(psto?.message).toBe('Стык F52: дата заявки повторной ПСТО #2 (02.07.2026) раньше результата предыдущей ТВМТ цикла #1 (03.07.2026).')
  })
})
