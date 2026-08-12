import { describe, expect, it } from 'vitest'
import { buildWeldingDynamicsJointTypeTable } from '@/lib/statistics-welding-dynamics-report'
import { buildWeldingDynamics } from '@/lib/welding-dynamics'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('buildWeldingDynamicsJointTypeTable', () => {
  it('prints the complete material by S/F matrix and total row', () => {
    const dynamics = buildWeldingDynamics(
      [
        row(1, 'S1', 'М01', '1.5', 'F1'),
        row(2, 'F2', 'М01', '2', 'F1'),
        row(3, 'F3', 'М11', '3', 'F2'),
      ],
      '2026-07-01',
      '2026-07-01',
      'wdi',
    )

    expect(buildWeldingDynamicsJointTypeTable(dynamics, 'all', 'wdi')).toEqual({
      title: 'Типы стыков и группы материалов за период',
      subtitle: 'Перекрестный разрез общего объема; повторные стыки относятся к типу базового стыка цепочки.',
      columns: ['Группа материалов', 'S · база', 'F · поле', 'Всего', 'Сварщики', 'На сварщика в смену', 'Доля'],
      rows: [
        ['М01', '1,5', '2', '3,5', '1', '3,5 WDI', '54%'],
        ['М11', '0', '3', '3', '1', '3 WDI', '46%'],
        ['Всего', '1,5', '5', '6,5', '2', '3,3 WDI', '100%'],
      ],
    })
  })

  it('does not add the cross table when one joint type is selected', () => {
    const dynamics = buildWeldingDynamics([row(1, 'F1', 'М01', '1')], '2026-07-01', '2026-07-01', 'wdi')

    expect(buildWeldingDynamicsJointTypeTable(dynamics, 'f', 'wdi')).toBeNull()
  })
})

function row(id: number, joint: string, materialGroup: string, wdi: string, stamp1KFact = ''): WeldRow {
  return {
    id,
    joint,
    materialGroup,
    wdi,
    weldDate: '2026-07-01',
    stamp1KFact,
  } as WeldRow
}
