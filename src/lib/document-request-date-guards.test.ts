import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { buildLnkResultRows } from './lnk-result-create-updates'
import { buildPstoResultRows } from './psto-report-mutation-updates'
import { buildPrimaryTvmtResultRows } from './tvmt-field-updates'
import { buildPreHeatTreatmentResultWrite, buildPreHeatTreatmentResultCorrectionWrite } from './pre-heat-treatment-control-updates'
import { buildRepeatPstoResultCycle, buildRepeatTvmtResultCycle } from './psto-repeat-cycle-updates'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'

const base: WeldRow = { id: 1, joint: 'F1', pstoRequired: 'да', preHeatTreatmentLnkEnabled: false,
  pstoRequest: 'ПСТО-1', pstoRequestDate: '2026-08-01', pstoDate: '2026-08-02', pstoResult: 'проведено',
  heatTreatmentDiagram: 'Диаграмма-1', tvmtRequest: 'ТВМТ-1', tvmtRequestDate: '2026-08-03' }
const settings = { ...DEFAULT_SAVE_CHECK_SETTINGS, lnkResultRequestDateOrder: false, pstoResultRequestDateOrder: false }
const builders: Array<[string, (requestDate: string) => unknown]> = [
  ['основной НК', requestDate => {
    const row: WeldRow = { id: 1, joint: 'F1', hasVik: 'да', vikRequest: 'ВИК-1', vikRequestDate: requestDate }
    return buildLnkResultRows({ records: [row], methodKey: 'vikRequest', resultById: { 1: 'годен' },
      controlDate: '2026-08-05', conclusionName: 'ВИК-1', saveCheckSettings: settings })
  }],
  ['ПСТО', requestDate => {
    const row = { ...base, pstoRequestDate: requestDate, pstoResult: '', pstoDate: '', heatTreatmentDiagram: '', tvmtRequest: '' }
    return buildPstoResultRows({ records: [row], rows: [row], pstoDate: '2026-08-05', result: 'проведено', diagramName: 'Д-1', saveCheckSettings: settings })
  }],
  ['ТВМТ', requestDate => buildPrimaryTvmtResultRows({ records: [{ ...base, tvmtRequestDate: requestDate }],
    controlDate: '2026-08-05', result: 'годен', conclusionName: 'ТВМТ-1', saveCheckSettings: settings })],
  ['НК до ТО: создание', requestDate => {
    const row: WeldRow = { id: 1, joint: 'F1', pstoRequired: 'да', hasVik: 'да', preHeatTreatmentLnkEnabled: true,
      preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', requestName: 'ВИК-до-ТО', requestDate }] }
    return buildPreHeatTreatmentResultWrite({ row, methodCode: 'ВИК', result: 'годен', controlDate: '2026-08-05', conclusionName: 'ВИК-1', saveCheckSettings: settings })
  }],
  ['НК до ТО: исправление', requestDate => {
    const control = { id: 1, weldJointId: 1, method: 'ВИК', requestName: 'ВИК-до-ТО', requestDate, result: 'годен' }
    const row: WeldRow = { id: 1, joint: 'F1', pstoRequired: 'да', hasVik: 'да', preHeatTreatmentLnkEnabled: true, preHeatTreatmentControls: [control] }
    return buildPreHeatTreatmentResultCorrectionWrite({ row, control, result: 'годен', controlDate: '2026-08-05', conclusionName: 'ВИК-1', saveCheckSettings: settings })
  }],
  ['повторная ПСТО', requestDate => buildRepeatPstoResultCycle({ row: { ...base, tvmtResult: 'не годен', tvmtConclusionDate: '2026-08-03', tvmtConclusion: 'ТВМТ-1',
    pstoRepeatCycles: [{ id: 2, weldJointId: 1, sequence: 2, pstoRequest: 'ПСТО-2', pstoRequestDate: requestDate }] },
    pstoDate: '2026-08-06', diagramName: 'Д-2', saveCheckSettings: settings })],
  ['повторная ТВМТ', requestDate => buildRepeatTvmtResultCycle({ row: { ...base, tvmtResult: 'не годен', tvmtConclusionDate: '2026-08-03', tvmtConclusion: 'ТВМТ-1',
    pstoRepeatCycles: [{ id: 2, weldJointId: 1, sequence: 2, pstoRequest: 'ПСТО-2', pstoRequestDate: '2026-08-04', pstoResult: 'проведено',
      pstoDate: '2026-08-05', heatTreatmentDiagram: 'Д-2', tvmtRequest: 'ТВМТ-2', tvmtRequestDate: requestDate }] },
    controlDate: '2026-08-06', result: 'годен', conclusionName: 'ТВМТ-2', saveCheckSettings: settings })],
]

describe('result workflows require the date of their existing request', () => {
  it.each(builders)('%s rejects an empty or invalid request date despite old disabled settings', (_name, build) => {
    for (const date of ['', 'не дата']) expect(() => build(date)).toThrow(/дат.*заявк|заявк.*дат/i)
  })
})
