import { describe, expect, it } from 'vitest'

import { getDispatcherTaskCode, getDispatcherTaskTypeLabel } from '@/lib/dispatcher-settings'
import { getRepeatedJointTaskTitle } from '@/lib/dispatcher-text'
import {
  buildControlHistoryCheckTasks,
  buildForbiddenRepairByDiameterCheckTasks,
  buildIncompleteWelderStampGroupTasks,
  buildJointCoreDataCheckTasks,
  buildLnkChronologyCheckTasks,
  buildLnkResultCompletenessCheckTasks,
  buildPrimaryLnkStageDebtSystemWarnings,
  buildPstoChronologyCheckTasks,
  buildPstoResultCompletenessCheckTasks,
  buildWelderStampCompatibilityCheckTasks,
} from '@/lib/repeated-joint-check-tasks'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'

describe('dispatcher data quality tasks', () => {
  it('moves LNK control-before-weld chronology into one DЗ-20 task and does not emit DЗ-16', () => {
    const tasks = buildLnkChronologyCheckTasks([
      row({
        weldDate: '2026-07-10',
        vikRequest: 'Заявка-ВИК',
        vikRequestDate: '2026-07-10',
        vikResult: 'годен',
        vikConclusion: 'ВИК-1',
        vikConclusionDate: '2026-07-09',
      }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-20')
    expect(tasks[0].details).toContain('раньше даты сварки')
    expect(tasks.map(getDispatcherTaskCode)).not.toContain('ДЗ-16')
  })

  it('moves an incomplete staged-control sequence from DZ-20 to the required SP-01 warning', () => {
    const legacyPrimary = row({
      id: 8,
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      hasVik: 'да',
      vikRequest: 'Существующая заявка ВИК основная',
      vikRequestDate: '2026-08-07',
      vikResult: 'годен',
      vikConclusionDate: '2026-08-08',
      vikConclusion: 'Существующее заключение ВИК основное',
    })

    expect(buildLnkChronologyCheckTasks([legacyPrimary])).toEqual([])
    const pendingWarnings = buildPrimaryLnkStageDebtSystemWarnings([legacyPrimary])
    expect(pendingWarnings).toHaveLength(1)
    expect(getDispatcherTaskCode(pendingWarnings[0])).toBe('СП-01')
    expect(getDispatcherTaskTypeLabel(pendingWarnings[0])).toBe('Предыдущие этапы пропущены')
    expect(getRepeatedJointTaskTitle(pendingWarnings[0]).type).toBe('Предыдущие этапы пропущены')
    expect(pendingWarnings[0].details).toContain('уже внесены данные результата основного НК по методам ВИК')
    expect(pendingWarnings[0].details).toContain('Подтвердите этапы после получения фактических данных')
    expect(pendingWarnings[0].details).not.toContain('фиктивные документы')
    expect(pendingWarnings[0].rootCauseActions?.[0].label).toBe('Создать заявку НК до ТО')

    const completedTasks = buildLnkChronologyCheckTasks([row({
      ...legacyPrimary,
      preHeatTreatmentControls: [{
        id: 80,
        weldJointId: 8,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        requestDate: '2026-08-02',
        result: 'годен',
        conclusionDate: '2026-08-03',
        conclusionName: 'Заключение ВИК до ТО',
      }],
      pstoRequest: 'Заявка ПСТО',
      pstoRequestDate: '2026-08-04',
      pstoResult: 'проведено',
      pstoDate: '2026-08-05',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtRequestDate: '2026-08-05',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-06',
      tvmtConclusion: 'Заключение ТВМТ',
    })])
    expect(completedTasks).toEqual([])
    expect(buildPrimaryLnkStageDebtSystemWarnings([row({
      ...legacyPrimary,
      preHeatTreatmentControls: [{
        id: 80,
        weldJointId: 8,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        requestDate: '2026-08-02',
        result: 'годен',
        conclusionDate: '2026-08-03',
        conclusionName: 'Заключение ВИК до ТО',
      }],
      pstoRequest: 'Заявка ПСТО',
      pstoRequestDate: '2026-08-04',
      pstoResult: 'проведено',
      pstoDate: '2026-08-05',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtRequestDate: '2026-08-05',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-06',
      tvmtConclusion: 'Заключение ТВМТ',
    })])).toEqual([])
  })

  it('keeps real LNK date errors as DZ-20 alongside SP-01', () => {
    const incomplete = row({
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      hasVik: 'да',
      vikRequest: 'Основная заявка ВИК',
      vikRequestDate: '2026-07-31',
      vikResult: 'годен',
    })

    expect(buildLnkChronologyCheckTasks([incomplete]).map(getDispatcherTaskCode)).toEqual(['ДЗ-20'])
    expect(buildPrimaryLnkStageDebtSystemWarnings([incomplete]).map(getDispatcherTaskCode)).toEqual(['СП-01'])
  })

  it('aggregates methods into one SP-01 and advances its contextual action', () => {
    const base = row({
      pstoRequired: 'да',
      hasVik: 'да',
      hasRk: 'да',
      vikRequest: 'Основная заявка ВИК',
      rkRequest: 'Основная заявка РК',
      vikResult: 'годен',
      rkResult: 'годен',
    })

    const [requestWarning] = buildPrimaryLnkStageDebtSystemWarnings([base])
    expect(requestWarning.details).toContain('ВИК, РК')
    expect(requestWarning.rootCauseActions?.[0].label).toBe('Создать заявку НК до ТО')

    const [resultWarning] = buildPrimaryLnkStageDebtSystemWarnings([row({
      ...base,
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
      }, {
        id: 2,
        weldJointId: 1,
        method: 'РК',
        requestName: 'Заявка РК до ТО',
      }],
    })])
    expect(resultWarning.rootCauseActions?.[0].label).toBe('Внести результат НК до ТО')

    const [mixedWarning] = buildPrimaryLnkStageDebtSystemWarnings([row({
      ...base,
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        result: 'годен',
      }],
    })])
    expect(mixedWarning.details).toContain('заявка РК до ТО')
    expect(mixedWarning.rootCauseActions?.[0]).toMatchObject({
      label: 'Создать заявку НК до ТО',
      target: {
        kind: 'lnk-control',
        methodCode: 'РК',
        documentPart: 'request',
      },
    })

    const preComplete = row({
      ...base,
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        result: 'годен',
      }, {
        id: 2,
        weldJointId: 1,
        method: 'РК',
        requestName: 'Заявка РК до ТО',
        result: 'годен',
      }],
    })
    expect(buildPrimaryLnkStageDebtSystemWarnings([preComplete])[0]
      .rootCauseActions?.[0].label).toBe('Открыть ПСТО')

    expect(buildPrimaryLnkStageDebtSystemWarnings([row({
      ...preComplete,
      pstoRequest: 'Заявка ПСТО',
      pstoResult: 'проведено',
      pstoDate: '2026-08-05',
    })])[0].rootCauseActions?.[0].label).toBe('Открыть ТВМТ')
  })

  it('does not create SP-01 for a request alone, including with pre-TO disabled', () => {
    const rowWithoutPrimaryTrace = row({ pstoRequired: 'да', hasVik: 'да' })
    expect(buildPrimaryLnkStageDebtSystemWarnings([rowWithoutPrimaryTrace])).toEqual([])

    const staleTraceForUnassignedMethod = row({
      pstoRequired: 'да',
      hasVik: 'нет',
      vikRequest: 'Старая заявка ВИК',
    })
    expect(buildPrimaryLnkStageDebtSystemWarnings([staleTraceForUnassignedMethod])).toEqual([])

    const rowWithPrimaryTrace = row({
      pstoRequired: 'да',
      hasVik: 'да',
      vikRequest: 'Основная заявка ВИК',
    })
    expect(buildPrimaryLnkStageDebtSystemWarnings([rowWithPrimaryTrace], {
      ...DEFAULT_CONTROL_PROCESS_SETTINGS,
      preHeatTreatmentLnkEnabled: false,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    })).toEqual([])
  })

  it('persists exact F5 chronology correction targets on the DZ-20 task', () => {
    const [task] = buildLnkChronologyCheckTasks([row({
      id: 5,
      joint: 'F5',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО',
      pstoRequestDate: '2026-08-20',
      pstoResult: 'проведено',
      pstoDate: '2026-08-29',
      heatTreatmentDiagram: 'Диаграмма ПСТО',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtRequestDate: '2026-08-29',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-30',
      tvmtConclusion: 'Заключение ТВМТ',
      hasVik: 'да',
      vikRequest: 'Заявка ВИК',
      vikRequestDate: '2026-08-09',
      vikResult: 'годен',
      vikConclusion: 'Заключение ВИК',
      vikConclusionDate: '2026-08-09',
    })])

    expect(getDispatcherTaskCode(task)).toBe('ДЗ-20')
    expect(task.rootCauseActions?.map((action) => action.label)).toEqual([
      'Исправить дату заключения ВИК',
      'Исправить дату ПСТО',
      'Исправить дату заключения ТВМТ',
    ])
    expect(task.rootCauseActions?.[0].target).toMatchObject({
      kind: 'lnk-control',
      rowId: 5,
      stage: 'primary',
      methodCode: 'ВИК',
      documentPart: 'conclusion',
      focus: 'date',
    })
  })

  it('moves PSTO result-before-weld chronology into DЗ-23', () => {
    const tasks = buildPstoChronologyCheckTasks([
      row({
        weldDate: '2026-07-10',
        pstoRequest: 'ПСТО-1',
        pstoRequestDate: '2026-07-10',
        pstoResult: 'проведено',
        pstoDate: '2026-07-09',
      }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-23')
    expect(tasks[0].details).toContain('раньше даты сварки')
  })

  it('reports a repeat PSTO cycle without a failed previous TVMT through DЗ-23', () => {
    const tasks = buildPstoChronologyCheckTasks([
      row({
        pstoRequest: 'ПСТО-1',
        pstoRequestDate: '2026-07-01',
        pstoResult: 'проведено',
        pstoDate: '2026-07-02',
        tvmtRequest: 'ТВМТ-1',
        tvmtRequestDate: '2026-07-03',
        tvmtResult: 'годен',
        tvmtConclusionDate: '2026-07-04',
        pstoRepeatCycles: [{
          id: 2,
          weldJointId: 1,
          sequence: 2,
          pstoRequest: 'ПСТО-2',
          pstoRequestDate: '2026-07-05',
        }],
      }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-23')
    expect(tasks[0].details).toContain('без негодной ТВМТ предыдущего цикла')
  })

  it('combines a future weld date, missing required weld fields and invalid joint structure in one DЗ-31 task', () => {
    const tasks = buildJointCoreDataCheckTasks([
      row({ joint: 'X1', weldDate: '2999-01-01', materialGroup: '', connectionType: '', weldingMethod: '' }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-31')
    expect(tasks[0].details).toContain('позже сегодняшней даты')
    expect(tasks[0].details).toContain(
      'при заполненной дате сварки не указаны группа материалов, тип соединения и способ сварки',
    )
    expect(tasks[0].details).toContain('Стык должен начинаться')
    expect(tasks[0].details).not.toContain('. при заполненной')
  })

  it('reports invalid general weld dates together through DЗ-31', () => {
    const tasks = buildJointCoreDataCheckTasks([
      row({ testDate: '31.02.2026', piDate: '2023-12-31' }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-31')
    expect(tasks[0].details).toContain('Дата ГИ: укажите дату')
    expect(tasks[0].details).toContain('Дата ПИ не может быть раньше 01.01.2024')
  })

  it('routes invalid LNK and PSTO dates to the existing chronology tasks', () => {
    const lnkTasks = buildLnkChronologyCheckTasks([
      row({ vikRequest: 'ВИК-1', vikRequestDate: '31.02.2026' }),
    ])
    const pstoTasks = buildPstoChronologyCheckTasks([
      row({ pstoRequest: 'ПСТО-1', pstoRequestDate: '31.02.2026' }),
    ])

    expect(lnkTasks).toHaveLength(1)
    expect(getDispatcherTaskCode(lnkTasks[0])).toBe('ДЗ-20')
    expect(lnkTasks[0].details).toContain('укажите дату в формате')
    expect(pstoTasks).toHaveLength(1)
    expect(getDispatcherTaskCode(pstoTasks[0])).toBe('ДЗ-23')
    expect(pstoTasks[0].details).toContain('укажите дату в формате')
  })

  it('does not require core weld fields before the weld date is filled', () => {
    expect(buildJointCoreDataCheckTasks([
      row({ weldDate: '', materialGroup: '', connectionType: '', weldingMethod: '' }),
    ])).toEqual([])
  })

  it('reports a missing welding method through DЗ-31', () => {
    const tasks = buildJointCoreDataCheckTasks([
      row({ weldDate: '2026-07-01', materialGroup: 'М01', connectionType: 'С17', weldingMethod: '' }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-31')
    expect(tasks[0].details).toContain('при заполненной дате сварки не указан способ сварки')
  })

  it('aggregates missing LNK result fields by method in one DЗ-32 task', () => {
    const tasks = buildLnkResultCompletenessCheckTasks([
      row({
        vikResult: 'годен',
        vikConclusionDate: '',
        vikConclusion: '',
        rkResult: 'ремонт',
        rkConclusionDate: '2026-07-02',
        rkConclusion: '',
      }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-32')
    expect(tasks[0].details).toContain('ВИК: не заполнены дата контроля и заключение')
    expect(tasks[0].details).toContain('РК: не заполнено заключение')
  })

  it('keeps a cancelled good LNK result covered by DЗ-32', () => {
    const tasks = buildLnkResultCompletenessCheckTasks([
      row({ hasVik: 'отменен', vikResult: 'годен (отменен)', vikConclusionDate: '', vikConclusion: '' }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-32')
    expect(tasks[0].details).toContain('ВИК: не заполнены дата контроля и заключение')
  })

  it('aggregates missing PSTO result fields in one DЗ-33 task', () => {
    const tasks = buildPstoResultCompletenessCheckTasks([
      row({ pstoResult: 'проведено', pstoDate: '', heatTreatmentDiagram: '' }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-33')
    expect(tasks[0].details).toContain('дата ПСТО и диаграмма термообработки')
  })

  it('keeps cancelled completed PSTO history covered by DЗ-33', () => {
    const tasks = buildPstoResultCompletenessCheckTasks([
      row({
        pstoRequired: 'отменен',
        pstoResult: 'проведено (отменен)',
        pstoDate: '2026-07-02',
        heatTreatmentDiagram: '',
      }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-33')
    expect(tasks[0].details).toContain('основной цикл ПСТО: не заполнено диаграмма термообработки')
  })

  it('checks PSTO and TVMT completeness in repeat cycles through the same DЗ-33 task', () => {
    const tasks = buildPstoResultCompletenessCheckTasks([
      row({
        pstoRequired: 'да',
        pstoRequest: 'ПСТО-1',
        pstoResult: 'проведено',
        pstoDate: '2026-07-02',
        heatTreatmentDiagram: 'Диаграмма-1',
        tvmtRequest: 'ТВМТ-1',
        tvmtResult: 'не годен',
        tvmtConclusionDate: '2026-07-03',
        tvmtConclusion: 'ТВМТ-1',
        pstoRepeatCycles: [{
          id: 2,
          weldJointId: 1,
          sequence: 2,
          pstoRequest: 'ПСТО-2',
          pstoResult: 'проведено',
          pstoDate: '',
          heatTreatmentDiagram: '',
          tvmtRequest: 'ТВМТ-2',
          tvmtResult: 'годен',
          tvmtConclusionDate: '',
          tvmtConclusion: '',
        }],
      }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-33')
    expect(tasks[0].details).toContain('повторный цикл #2 ПСТО')
    expect(tasks[0].details).toContain('повторный цикл #2 ТВМТ')
  })

  it('does not include duplicate controls in PSTO cycle completeness', () => {
    const tasks = buildPstoResultCompletenessCheckTasks([
      row({
        duplicateControls: [{
          id: 10,
          weldJointId: 1,
          method: 'ТВМТ',
          result: 'годен',
          controlDate: '',
          conclusion: '',
          conclusionDate: '',
        }],
      }),
    ])

    expect(tasks).toEqual([])
  })

  it('matches ZВ-27 exactly for DЗ-34 and ignores requests or accounting fields without physical history', () => {
    const tasks = buildControlHistoryCheckTasks([
      row({ id: 1, hasRk: '', rkResult: 'годен' }),
      row({ id: 2, joint: 'F2', hasRk: '', rkRequest: 'Заявка РК' }),
      row({ id: 3, joint: 'F3', hasRk: 'отменен', rkResult: 'годен' }),
      row({ id: 4, joint: 'F4', pstoRequired: '', pstoResult: '', pstoBoq: 'Учтено' }),
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks.map(getDispatcherTaskCode)).toEqual(['ДЗ-34'])
    expect(tasks.map((task) => task.row.id)).toEqual([1])
    expect(tasks[0].details).toContain('РК')
  })

  it('keeps cancelled good LNK history covered by ZВ-27 and DЗ-34', () => {
    const tasks = buildControlHistoryCheckTasks([
      row({ id: 5, hasRk: '', rkResult: 'годен (отменен)', rkConclusionDate: '', rkConclusion: '' }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-34')
    expect(tasks[0].details).toContain('РК')
  })

  it('audits an unknown official stamp through DЗ-18 even when the registry is empty', () => {
    const tasks = buildWelderStampCompatibilityCheckTasks([
      row({ stamp1K: 'ABC1', stamp1Z: 'ABC1', stamp1O: 'ABC1' }),
    ], [])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-18')
    expect(tasks[0].details).toContain('ABC1')
  })

  it('requires the first stamp group through DЗ-19 when only the second group is filled', () => {
    const tasks = buildIncompleteWelderStampGroupTasks([
      row({
        stamp1K: '',
        stamp1Z: '',
        stamp1O: '',
        stamp2K: 'B2',
        stamp2Z: 'B2',
        stamp2O: 'B2',
        stamp2KFact: 'B2',
        stamp2ZFact: 'B2',
        stamp2OFact: 'B2',
      }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-19')
    expect(tasks[0].details).toContain('группа клейма_1 пустая')
  })

  it('checks the official repair limit through DЗ-17', () => {
    const tasks = buildForbiddenRepairByDiameterCheckTasks([
      row({ joint: 'F1R2', d1: 159, d2: 159, rkResult: 'ремонт' }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-17')
    expect(tasks[0].details).toContain('после двух уже выполненных официальных ремонтов')
  })

  it('checks a pre-TO repair against the same official repair limit through DЗ-17', () => {
    const tasks = buildForbiddenRepairByDiameterCheckTasks([
      row({
        joint: 'F1R2',
        d1: 159,
        d2: 159,
        pstoRequired: 'да',
        hasRk: 'да',
        preHeatTreatmentControls: [{
          id: 10,
          weldJointId: 1,
          method: 'РК',
          result: 'ремонт',
        }],
      }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-17')
    expect(tasks[0].details).toContain('РК до ТО')
  })

  it('checks a duplicate-control repair against the same diameter rule through DЗ-17', () => {
    const tasks = buildForbiddenRepairByDiameterCheckTasks([
      row({
        joint: 'F2',
        d1: 57,
        d2: 57,
        duplicateControls: [{
          id: 20,
          weldJointId: 1,
          method: 'РК',
          result: 'ремонт',
          controlDate: '',
          conclusion: '',
          conclusionDate: '',
        }],
      }),
    ])

    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-17')
    expect(tasks[0].details).toContain('РК (дубль)')
  })
})

function row(values: Partial<WeldRow>): WeldRow {
  return {
    id: values.id ?? 1,
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line: 'Линия',
    joint: 'F1',
    weldDate: '2026-07-01',
    ...values,
  } as WeldRow
}
