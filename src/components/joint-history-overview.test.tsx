import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JointHistoryOverview } from '@/components/joint-history-overview'
import type { RepeatedJointCreateTask, WeldRow } from '@/lib/dispatcher-types'

describe('JointHistoryOverview', () => {
  it('shows and routes the exact dispatcher continuation after a rejected result', () => {
    const row = {
      id: 3,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F3',
      weldDate: '2026-08-01',
      rkResult: 'ремонт',
      finalStatus: 'не годен',
    } as WeldRow
    const task: RepeatedJointCreateTask = {
      kind: 'create',
      key: 'create:F3:F3R1',
      row,
      sourceJoint: 'F3',
      targetJoint: 'F3R1',
      result: 'ремонт',
      suffix: 'R',
      methodCode: 'РК',
    }
    const onRunNextAction = vi.fn()

    render(
      <JointHistoryOverview
        row={row}
        dispatcherTasks={[task]}
        onOpenDocument={vi.fn()}
        onOpenReport={vi.fn()}
        onRunNextAction={onRunNextAction}
      />,
    )

    expect(screen.getByText('Что дальше')).toBeInTheDocument()
    expect(screen.getByText('Создать F3R1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Перейти к созданию/ }))
    expect(onRunNextAction).toHaveBeenCalledWith(row, expect.objectContaining({
      kind: 'dispatcherTask',
      taskKey: task.key,
    }))
  })

  it('shows a performed PSTO as pending until TVMT finishes the cycle', () => {
    render(
      <JointHistoryOverview
        row={{
          id: 8,
          projectTitle: 'Проект',
          subtitleCode: '400',
          line: 'L-1',
          joint: 'F8',
          weldDate: '2026-08-01',
          pstoRequired: 'да',
          pstoRequest: 'Заявка ПСТО-1',
          pstoRequestDate: '2026-08-02',
          pstoDate: '2026-08-03',
          pstoResult: 'проведено',
          heatTreatmentDiagram: 'ПСТО-Д-1',
        } as WeldRow}
        onOpenDocument={vi.fn()}
        onOpenReport={vi.fn()}
        onRunNextAction={vi.fn()}
      />,
    )

    const status = screen.getByText('ПСТО: проведено · ТВМТ ожидается')
    expect(status.className).toContain('bg-amber-50')
    expect(status.className).not.toContain('bg-emerald-50')
  })

  it('shows cancellation without inventing a pending PSTO cycle for a completed joint', () => {
    render(
      <JointHistoryOverview
        row={{
          id: 14,
          projectTitle: 'Проект',
          subtitleCode: '400',
          line: 'L-1',
          joint: 'S14',
          weldDate: '2026-08-01',
          pstoRequired: 'отменен',
          pstoCancellationDate: '2026-09-03',
          pstoResult: 'ожидает заявку',
          hasVik: 'да',
          vikRequest: 'Заявка ВИК-1',
          vikResult: 'годен',
          finalStatus: 'годен',
        } as WeldRow}
        onOpenDocument={vi.fn()}
        onOpenReport={vi.fn()}
        onRunNextAction={vi.fn()}
      />,
    )

    expect(screen.getByText('Работа по стыку завершена')).toBeInTheDocument()
    expect(screen.getByText('Линия ПСТО')).toBeInTheDocument()
    expect(screen.getByText('отменена')).toBeInTheDocument()
    expect(screen.queryByText('Цикл 1')).not.toBeInTheDocument()
    expect(screen.queryByText(/ПСТО: ожидает заявку/)).not.toBeInTheDocument()
  })
})
