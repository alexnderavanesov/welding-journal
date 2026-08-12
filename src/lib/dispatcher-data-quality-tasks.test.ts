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

  it('matches ZВ-27 exactly for DЗ-34 and ignores a request without a result history', () => {
    const tasks = buildControlHistoryCheckTasks([
      row({ id: 1, hasRk: '', rkResult: 'годен' }),
      row({ id: 2, joint: 'F2', hasRk: '', rkRequest: 'Заявка РК' }),
      row({ id: 3, joint: 'F3', hasRk: 'отменен', rkResult: 'годен' }),
      row({ id: 4, joint: 'F4', pstoRequired: '', pstoResult: '', heatTreatmentDiagram: 'Диаграмма 1' }),
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
