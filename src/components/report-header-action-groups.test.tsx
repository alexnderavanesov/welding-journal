import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { HeatTreatmentHeaderActions, LnkHeaderActions } from '@/components/report-header-action-groups'

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
  it('keeps only one workflow menu open at a time', () => {
    renderActions()

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    expect(screen.getByRole('button', { name: 'Новая заявка' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    expect(screen.queryByRole('button', { name: 'Новая заявка' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Внести результаты' })).toBeInTheDocument()
  })

  it('keeps the show menu mutually exclusive with the workflow menus', () => {
    function Harness() {
      const [isShowMenuOpen, setIsShowMenuOpen] = useState(false)
      return (
        <LnkHeaderActions
          onCreateRequest={vi.fn()}
          onExtendRequest={vi.fn()}
          onOpenRequestRegistry={vi.fn()}
          requestPending={false}
          onAddResult={vi.fn()}
          resultDisabled={false}
          onEditSelectedResults={vi.fn()}
          editSelectedResultsDisabled={false}
          onOpenResultRegistry={vi.fn()}
          resultRegistryDisabled={false}
          onOpenOfficiality={vi.fn()}
          officialityPending={false}
          onOpenDuplicateControl={vi.fn()}
          duplicateControlPending={false}
          isShowMenuOpen={isShowMenuOpen}
          onToggleShowMenu={() => setIsShowMenuOpen((current) => !current)}
          onOpenCurrentReport={vi.fn()}
          onOpenToRequestReport={vi.fn()}
          onOpenWaitingNkReport={vi.fn()}
          onOpenConclusionsReport={vi.fn()}
        />
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
    expect(screen.getByRole('button', { name: 'Текущая версия' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    expect(screen.queryByRole('button', { name: 'Текущая версия' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Новая заявка' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
    expect(screen.queryByRole('button', { name: 'Новая заявка' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Текущая версия' })).toBeInTheDocument()
  })

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

function renderPstoActions() {
  const onCreateRequest = vi.fn()
  const onEditSelectedRequest = vi.fn()
  const onOpenRequestRegistry = vi.fn()
  const onAddResult = vi.fn()
  const onEditSelectedResults = vi.fn()
  const onOpenResultRegistry = vi.fn()
  render(
    <HeatTreatmentHeaderActions
      onCreateRequest={onCreateRequest}
      onEditSelectedRequest={onEditSelectedRequest}
      editSelectedRequestDisabled={false}
      onOpenRequestRegistry={onOpenRequestRegistry}
      requestPending={false}
      onAddResult={onAddResult}
      resultDisabled={false}
      onEditSelectedResults={onEditSelectedResults}
      editSelectedResultsDisabled={false}
      onOpenResultRegistry={onOpenResultRegistry}
      resultRegistryDisabled={false}
      isShowMenuOpen={false}
      onToggleShowMenu={vi.fn()}
      onOpenCurrentReport={vi.fn()}
      onOpenWaitingRequestReport={vi.fn()}
      onOpenResultsReport={vi.fn()}
    />,
  )
  return {
    onCreateRequest,
    onEditSelectedRequest,
    onOpenRequestRegistry,
    onAddResult,
    onEditSelectedResults,
    onOpenResultRegistry,
  }
}

describe('HeatTreatmentHeaderActions', () => {
  it('keeps only one workflow menu open at a time', () => {
    renderPstoActions()

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    expect(screen.getByRole('button', { name: 'Новая заявка' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    expect(screen.queryByRole('button', { name: 'Новая заявка' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Внести результаты' })).toBeInTheDocument()
  })

  it('closes the show menu when a workflow menu opens', () => {
    const onToggleShowMenu = vi.fn()
    render(
      <HeatTreatmentHeaderActions
        onCreateRequest={vi.fn()}
        onEditSelectedRequest={vi.fn()}
        editSelectedRequestDisabled={false}
        onOpenRequestRegistry={vi.fn()}
        requestPending={false}
        onAddResult={vi.fn()}
        resultDisabled={false}
        onEditSelectedResults={vi.fn()}
        editSelectedResultsDisabled={false}
        onOpenResultRegistry={vi.fn()}
        resultRegistryDisabled={false}
        isShowMenuOpen
        onToggleShowMenu={onToggleShowMenu}
        onOpenCurrentReport={vi.fn()}
        onOpenWaitingRequestReport={vi.fn()}
        onOpenResultsReport={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))

    expect(onToggleShowMenu).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Внести результаты' })).toBeInTheDocument()
  })

  it('keeps create, selected edit and full request registry as separate commands', () => {
    const actions = renderPstoActions()

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка' }))
    expect(actions.onCreateRequest).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать выбранную' }))
    expect(actions.onEditSelectedRequest).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    fireEvent.click(screen.getByRole('button', { name: 'Все заявки ПСТО' }))
    expect(actions.onOpenRequestRegistry).toHaveBeenCalledTimes(1)
  })

  it('keeps add, selected edit and full result registry as separate commands', () => {
    const actions = renderPstoActions()

    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    fireEvent.click(screen.getByRole('button', { name: 'Внести результаты' }))
    expect(actions.onAddResult).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать выбранные' }))
    expect(actions.onEditSelectedResults).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    fireEvent.click(screen.getByRole('button', { name: 'Все результаты ПСТО' }))
    expect(actions.onOpenResultRegistry).toHaveBeenCalledTimes(1)
  })
})
