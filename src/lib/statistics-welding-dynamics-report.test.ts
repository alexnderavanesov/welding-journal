import { describe, expect, it } from 'vitest'
import { buildWeldingDynamicsJointTypeTable } from '@/lib/statistics-welding-dynamics-report'
import { buildWeldingDynamics } from '@/lib/welding-dynamics'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('buildWeldingDynamicsJointTypeTable', () => {
  it('prints the complete project-material hierarchy and total row', () => {
    const dynamics = buildWeldingDynamics(
      [
        row(1, 'S1', 'Проект А', 'М01', '1.5', 'F1'),
        row(2, 'F2', 'Проект А', 'М01', '2', 'F1'),
        row(3, 'F3', 'Проект Б', 'М11', '3', 'F2'),
      ],
      '2026-07-01',
      '2026-07-01',
      'wdi',
    )

    expect(buildWeldingDynamicsJointTypeTable(dynamics, 'all', 'wdi')).toEqual({
      title: 'Проекты и группы материалов за период',
      subtitle: 'Иерархия: проект → группа материалов; повторные стыки относятся к типу базового стыка цепочки.',
      columns: ['Проект / группа материалов', 'S · база', 'F · поле', 'Всего', 'Сварщики', 'На сварщика в смену', 'Доля'],
      rows: [
        ['Итого за период', '1,5', '5', '6,5', '2', '3,3 WDI', '100%'],
        ['Проект А', '1,5', '2', '3,5', '1', '3,5 WDI', '54%'],
        ['М01', '1,5', '2', '3,5', '1', '3,5 WDI', '54%'],
        ['Проект Б', '0', '3', '3', '1', '3 WDI', '46%'],
        ['М11', '0', '3', '3', '1', '3 WDI', '46%'],
      ],
      rowKinds: ['total', 'group', 'detail', 'group', 'detail'],
    })
  })

  it('reverses the hierarchy for material grouping', () => {
    const dynamics = buildWeldingDynamics(
      [
        row(1, 'S1', 'Проект А', 'М01', '1', 'F1'),
        row(2, 'F2', 'Проект Б', 'М01', '2', 'F2'),
      ],
      '2026-07-01',
      '2026-07-01',
      'wdi',
    )

    const table = buildWeldingDynamicsJointTypeTable(dynamics, 'all', 'wdi', 'materials')

    expect(table?.title).toBe('Группы материалов и проекты за период')
    expect(table?.columns[0]).toBe('Группа материалов / проект')
    expect(table?.rows.map((row) => row[0])).toEqual(['Итого за период', 'М01', 'Проект Б', 'Проект А'])
    expect(table?.rowKinds).toEqual(['total', 'group', 'detail', 'detail'])
  })

  it('keeps only the selected joint-type column', () => {
    const dynamics = buildWeldingDynamics(
      [row(1, 'F1', 'Проект А', 'М01', '1')],
      '2026-07-01',
      '2026-07-01',
      'wdi',
    )

    expect(buildWeldingDynamicsJointTypeTable(dynamics, 'f', 'wdi')?.columns).toEqual([
      'Проект / группа материалов',
      'F · поле',
      'Всего',
      'Сварщики',
      'На сварщика в смену',
      'Доля',
    ])
  })
})

function row(
  id: number,
  joint: string,
  projectTitle: string,
  materialGroup: string,
  wdi: string,
  stamp1KFact = '',
): WeldRow {
  return {
    id,
    joint,
    projectTitle,
    materialGroup,
    wdi,
    weldDate: '2026-07-01',
    stamp1KFact,
  } as WeldRow
}
