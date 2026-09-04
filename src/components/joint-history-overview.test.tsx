import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JointHistoryOverview } from '@/components/joint-history-overview'
import { LNK_RESULT_COMPLETENESS_REASON } from '@/lib/dispatcher-check-reasons'
import type { RepeatedJointCheckTask, RepeatedJointCreateTask, WeldRow } from '@/lib/dispatcher-types'

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
    expect(screen.getAllByText('Создать F3R1')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Создать F3R1' }))
    expect(onRunNextAction).toHaveBeenCalledWith(row, expect.objectContaining({
      kind: 'dispatcherTask',
      taskKey: task.key,
      taskActionId: 'create-joint',
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

  it('keeps one primary next step and lists a different dispatcher task only once below', () => {
    const row = {
      id: 9,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F9',
      weldDate: '2026-08-01',
      hasVik: 'да',
      vikRequest: 'Заявка ВИК-1',
    } as WeldRow
    const task: RepeatedJointCheckTask = {
      kind: 'check',
      key: 'check:F9:lnk-completeness',
      row,
      sourceRow: row,
      sourceJoint: 'F9',
      targetJoint: 'F9',
      baseJoint: 'F9',
      suffix: 'R',
      reason: LNK_RESULT_COMPLETENESS_REASON,
      details: 'Не заполнена дата заключения.',
    }

    render(
      <JointHistoryOverview
        row={row}
        dispatcherTasks={[task]}
        onOpenDocument={vi.fn()}
        onOpenReport={vi.fn()}
        onRunNextAction={vi.fn()}
        onRunDispatcherTaskAction={vi.fn()}
      />,
    )

    expect(screen.getByText('Внести результат основного НК')).toBeInTheDocument()
    expect(screen.getByText('Активные ДЗ')).toBeInTheDocument()
    expect(screen.getAllByText('Дозаполнить результат ЛНК')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Исправить в ЛНК' })).toBeInTheDocument()
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

  it('uses the same no-need statuses and section name after rejected pre-TO control', () => {
    render(
      <JointHistoryOverview
        row={{
          id: 15,
          projectTitle: 'Риформинг',
          subtitleCode: '73281024/4152-330-ТКМ5',
          line: '2',
          joint: 'F9Y1',
          weldDate: '2026-09-02',
          pstoRequired: 'да',
          pstoResult: 'ожидает заявку',
          hasVik: 'да',
          hasPvk: 'да',
          preHeatTreatmentControls: [{
            id: 24,
            weldJointId: 15,
            method: 'ВИК',
            requestName: 'Заявка ВИК до ТО',
            requestDate: '2026-09-03',
            result: 'вырез',
            conclusionDate: '2026-09-03',
          }, {
            id: 25,
            weldJointId: 15,
            method: 'ПВК',
            requestName: 'Заявка ПВК до ТО',
            requestDate: '2026-09-03',
            result: 'ожидает НК',
          }],
          finalStatus: 'не годен',
        } as WeldRow}
        onOpenDocument={vi.fn()}
        onOpenReport={vi.fn()}
        onRunNextAction={vi.fn()}
      />,
    )

    expect(screen.getByText('НК до ТО не годен')).toBeInTheDocument()
    expect(screen.getByText('Основной этап НК')).toBeInTheDocument()
    expect(screen.queryByText('Основной НК')).not.toBeInTheDocument()
    expect(screen.getAllByText('нет потребности')).toHaveLength(4)
    expect(screen.queryByText(/ожидает заявку ПСТО/)).not.toBeInTheDocument()
    expect(screen.queryByText('Цикл ПСТО пока заблокирован')).not.toBeInTheDocument()
  })
})
