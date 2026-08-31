import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JointChainCard } from '@/components/joint-chain-card'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('JointChainCard', () => {
  it('explains the PSTO workflow, main LNK stage, and final joint status in order', () => {
    const row = {
      id: 13,
      projectTitle: 'Риформинг',
      subtitleCode: '73281024/4152-330-ТКМ5',
      line: '222bto',
      joint: 'S13',
      weldDate: '2026-07-24',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО 1',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ 1',
      tvmtResult: 'не годен',
      pstoRepeatCycles: [{
        id: 22,
        weldJointId: 13,
        sequence: 2,
        pstoRequest: 'Заявка ПСТО 2',
        pstoResult: 'проведено',
        tvmtRequest: 'Заявка ТВМТ 2',
        tvmtResult: 'ожидает НК',
      }],
      hasVik: 'да',
      vikRequest: 'Заявка ВИК основная',
      vikResult: 'ожидает НК',
      finalStatus: 'ожидает НК',
    } as unknown as WeldRow

    const { container } = render(
      <JointChainCard
        row={row}
        index={0}
        isCurrent
        onOpenRow={vi.fn()}
      />,
    )

    expect(screen.getByText('ПСТО и ТВМТ')).toBeInTheDocument()
    expect(screen.getByText('Цикл 2: ожидает ТВМТ')).toBeInTheDocument()
    expect(screen.getByText('Основной этап НК')).toBeInTheDocument()
    expect(screen.getByText('ВИК: ожидает НК')).toBeInTheDocument()
    expect(screen.getByText('Итог по стыку')).toBeInTheDocument()
    expect(screen.getByText('ожидает НК', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText('ПСТО: проведено')).not.toBeInTheDocument()

    const content = container.textContent ?? ''
    expect(content.indexOf('ПСТО и ТВМТ')).toBeLessThan(content.indexOf('Основной этап НК'))
    expect(content.indexOf('Основной этап НК')).toBeLessThan(content.indexOf('Итог по стыку'))
  })
})
