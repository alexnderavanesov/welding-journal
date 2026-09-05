import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JointHistoryOverview } from '@/components/joint-history-overview'
import { LNK_RESULT_COMPLETENESS_REASON } from '@/lib/dispatcher-check-reasons'
import type { RepeatedJointCheckTask, RepeatedJointCreateTask, WeldRow } from '@/lib/dispatcher-types'

describe('JointHistoryOverview', () => {
  it('uses the compact PSTO label and opens the standard weld editor', () => {
    const row = {
      id: 2,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F2',
      weldDate: '2026-08-01',
    } as WeldRow
    const onOpenReport = vi.fn()
    const onEditRow = vi.fn()

    render(
      <JointHistoryOverview
        row={row}
        onOpenDocument={vi.fn()}
        onOpenReport={onOpenReport}
        onEditRow={onEditRow}
        onRunNextAction={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Термообработка' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ПСТО' }))
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }))
    expect(onOpenReport).toHaveBeenCalledWith(row, 'heatTreatment')
    expect(onEditRow).toHaveBeenCalledWith(row)
  })

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
        onEditRow={vi.fn()}
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
        onEditRow={vi.fn()}
        onRunNextAction={vi.fn()}
      />,
    )

    const status = screen.getByText('ПСТО: проведено · ТВМТ ожидается')
    expect(status.className).toContain('bg-amber-50')
    expect(status.className).not.toContain('bg-emerald-50')
  })

  it('opens documents from the exact PSTO cycle shown in the picture', () => {
    const onOpenDocument = vi.fn()
    const row = {
      id: 8,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F8',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      pstoRequest: 'Основная заявка ПСТО',
      pstoRequestDate: '2026-08-02',
      pstoRepeatCycles: [{
        id: 18,
        weldJointId: 8,
        sequence: 2,
        pstoRequest: 'Повторная заявка ПСТО',
        pstoRequestDate: '2026-08-12',
      }],
    } as WeldRow

    render(
      <JointHistoryOverview
        row={row}
        onOpenDocument={onOpenDocument}
        onOpenReport={vi.fn()}
        onEditRow={vi.fn()}
        onRunNextAction={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Основная заявка ПСТО' }))
    expect(onOpenDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pstoRequest: 'Основная заявка ПСТО',
        pstoRepeatCycles: [],
      }),
      'pstoRequest',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Повторная заявка ПСТО' }))
    expect(onOpenDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pstoRequest: 'Повторная заявка ПСТО',
        pstoRepeatCycles: [expect.objectContaining({ sequence: 2 })],
      }),
      'pstoRequest',
    )
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
        onEditRow={vi.fn()}
        onRunNextAction={vi.fn()}
        onRunDispatcherTaskAction={vi.fn()}
      />,
    )

    expect(screen.getByText('Внести результат основного НК')).toBeInTheDocument()
    expect(screen.getByText('Активные ДЗ')).toBeInTheDocument()
    expect(screen.getAllByText('Дозаполнить результат ЛНК')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Исправить в ЛНК' })).toBeInTheDocument()
  })

  it('passes the exact DZ root-cause action through the joint picture', () => {
    const row = {
      id: 5,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F5',
      weldDate: '2026-08-01',
    } as WeldRow
    const rootCauseAction = {
      key: 'lnk:5:primary:ВИК:request:date:0',
      label: 'Исправить дату заявки ВИК',
      tone: 'primary' as const,
      target: {
        kind: 'lnk-control' as const,
        rowId: 5,
        stage: 'primary' as const,
        methodCode: 'ВИК',
        documentPart: 'request' as const,
        focus: 'date' as const,
        documentName: 'Заявка ВИК',
        documentDate: '2026-08-09',
      },
    }
    const task: RepeatedJointCheckTask = {
      kind: 'check',
      key: 'check:F5:chronology',
      row,
      sourceRow: row,
      sourceJoint: 'F5',
      targetJoint: 'F5',
      baseJoint: 'F5',
      suffix: 'R',
      reason: 'проверить даты ЛНК',
      rootCauseActions: [rootCauseAction],
    }
    const onRunNextAction = vi.fn()

    render(
      <JointHistoryOverview
        row={row}
        dispatcherTasks={[task]}
        onOpenDocument={vi.fn()}
        onOpenReport={vi.fn()}
        onEditRow={vi.fn()}
        onRunNextAction={onRunNextAction}
        onRunDispatcherTaskAction={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: rootCauseAction.label }))
    expect(onRunNextAction).toHaveBeenCalledWith(row, expect.objectContaining({
      taskAction: expect.objectContaining({
        id: 'open-root-cause',
        rootCauseAction,
      }),
    }))
  })

  it('does not show an active-DZ section when the joint has no active DZ', () => {
    render(
      <JointHistoryOverview
        row={{
          id: 18,
          projectTitle: 'Проект',
          subtitleCode: '400',
          line: 'L-1',
          joint: 'F18',
          weldDate: '2026-08-01',
          finalStatus: 'годен',
        } as WeldRow}
        dispatcherTasks={[]}
        onOpenDocument={vi.fn()}
        onOpenReport={vi.fn()}
        onEditRow={vi.fn()}
        onRunNextAction={vi.fn()}
      />,
    )

    expect(screen.queryByText('Активные ДЗ')).not.toBeInTheDocument()
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
        onEditRow={vi.fn()}
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
        onEditRow={vi.fn()}
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
