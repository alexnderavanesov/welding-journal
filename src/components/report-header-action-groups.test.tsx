import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LnkHeaderActions } from '@/components/report-header-action-groups'

function renderActions() {
  const onCreateRequest = vi.fn()
  const onExtendRequest = vi.fn()
  const onOpenRequestRegistry = vi.fn()
  const onAddResult = vi.fn()
  const onEditSelectedResults = vi.fn()
  const onOpenResultRegistry = vi.fn()
  render(
    <LnkHeaderActions
      onCreateRequest={onCreateRequest}
      onExtendRequest={onExtendRequest}
      onOpenRequestRegistry={onOpenRequestRegistry}
      requestPending={false}
      onAddResult={onAddResult}
      resultDisabled={false}
      onEditSelectedResults={onEditSelectedResults}
      editSelectedResultsDisabled={false}
      onOpenResultRegistry={onOpenResultRegistry}
      resultRegistryDisabled={false}
      onOpenOfficiality={vi.fn()}
      officialityPending={false}
      onOpenDuplicateControl={vi.fn()}
      duplicateControlPending={false}
      isShowMenuOpen={false}
      onToggleShowMenu={vi.fn()}
      onOpenCurrentReport={vi.fn()}
      onOpenToRequestReport={vi.fn()}
      onOpenWaitingNkReport={vi.fn()}
      onOpenConclusionsReport={vi.fn()}
    />,
  )
  return {
    onCreateRequest,
    onExtendRequest,
    onOpenRequestRegistry,
    onAddResult,
    onEditSelectedResults,
    onOpenResultRegistry,
  }
}

describe('LnkHeaderActions', () => {
  it('keeps new, extend and registry workflows as separate commands', () => {
    const actions = renderActions()

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    fireEvent.click(screen.getByRole('button', { name: 'Добавить позиции' }))
    expect(actions.onExtendRequest).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    fireEvent.click(screen.getByRole('button', { name: 'Все заявки ЛНК' }))
    expect(actions.onOpenRequestRegistry).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка' }))
    expect(actions.onCreateRequest).toHaveBeenCalledTimes(1)
  })

  it('keeps add, selected edit and full result registry as separate commands', () => {
    const actions = renderActions()

    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    fireEvent.click(screen.getByRole('button', { name: 'Внести результаты' }))
    expect(actions.onAddResult).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать выбранные' }))
    expect(actions.onEditSelectedResults).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    fireEvent.click(screen.getByRole('button', { name: 'Все результаты ЛНК' }))
    expect(actions.onOpenResultRegistry).toHaveBeenCalledTimes(1)
  })
})
