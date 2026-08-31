import { describe, expect, it } from 'vitest'

import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import {
  buildControlHistoryCheckTasks,
  buildJointCoreDataCheckTasks,
  buildLnkChronologyCheckTasks,
  buildLnkResultCompletenessCheckTasks,
  buildPstoChronologyCheckTasks,
  buildPstoResultCompletenessCheckTasks,
} from '@/lib/repeated-joint-check-tasks'
import type { WeldRow } from '@/lib/dispatcher-types'

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

  it('keeps DZ-20 until a preserved primary LNK set receives its missing pre-TO and PSTO history', () => {
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

    const pendingTasks = buildLnkChronologyCheckTasks([legacyPrimary])
    expect(pendingTasks).toHaveLength(1)
    expect(getDispatcherTaskCode(pendingTasks[0])).toBe('ДЗ-20')
    expect(pendingTasks[0].details).toContain('до завершения цикла ПСТО и ТВМТ')

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

  it('matches ZВ-27 exactly for DЗ-34 and ignores a request without a result history', () => {
    const tasks = buildControlHistoryCheckTasks([
      row({ id: 1, hasRk: '', rkResult: 'годен' }),
      row({ id: 2, joint: 'F2', hasRk: '', rkRequest: 'Заявка РК' }),
      row({ id: 3, joint: 'F3', hasRk: 'отменен', rkResult: 'годен' }),
      row({ id: 4, joint: 'F4', pstoRequired: '', pstoResult: '', pstoBoq: 'Учтено' }),
    ])

    expect(tasks).toHaveLength(2)
    expect(tasks.map(getDispatcherTaskCode)).toEqual(['ДЗ-34', 'ДЗ-34'])
    expect(tasks.map((task) => task.row.id)).toEqual([1, 4])
    expect(tasks[0].details).toContain('РК')
    expect(tasks[1].details).toContain('ПСТО')
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
