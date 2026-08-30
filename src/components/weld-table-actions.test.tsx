import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WeldTableRowActions } from '@/components/weld-table-actions'
import type { WeldRow } from '@/lib/dispatcher-types'
import { createReportRowActionHandlers } from '@/lib/report-row-action-handlers'
import { getReportRowActions } from '@/lib/report-row-actions'

function renderActions(row: WeldRow) {
  const handlers = createReportRowActionHandlers({
    openCreatePstoRequestModalForRow: vi.fn(),
    openAddPstoResultModalForRow: vi.fn(),
    openCreateLnkRequestModalForRow: vi.fn(),
    openAddLnkResultModalForRow: vi.fn(),
  })
  const rowActions = getReportRowActions('heatTreatment', handlers)
  if (!rowActions) throw new Error('PSTO row actions are not configured')

  render(
    <table>
      <tbody>
        <tr>
          <WeldTableRowActions row={row} rowActions={rowActions} />
        </tr>
      </tbody>
    </table>,
  )
}

describe('WeldTableRowActions for PSTO', () => {
  it('shows the actual pre-TO prerequisite instead of claiming that a request exists', () => {
    renderActions({
      id: 1,
      pstoRequired: 'да',
      hasVik: 'да',
    } as WeldRow)

    expect(screen.getByRole('button', { name: 'Создать заявку ПСТО на этот стык' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Создать заявку ПСТО на этот стык' })).toHaveAttribute(
      'title',
      'Сначала создайте заявки НК до ТО: ВИК.',
    )
    expect(screen.getByRole('button', { name: 'Добавить результат ПСТО на этот стык' })).toHaveAttribute(
      'title',
      'Сначала создайте заявки НК до ТО: ВИК.',
    )
  })

  it('enables result entry and explains why another request cannot be created', () => {
    renderActions({
      id: 2,
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-001',
      pstoRequestDate: '2026-08-28',
      pstoResult: 'ожидает',
    } as WeldRow)

    expect(screen.getByRole('button', { name: 'Создать заявку ПСТО на этот стык' })).toHaveAttribute(
      'title',
      'Заявка ПСТО для цикла 1 уже создана: Заявка ПСТО-001.',
    )
    expect(screen.getByRole('button', { name: 'Добавить результат ПСТО на этот стык' })).toBeEnabled()
  })
})
