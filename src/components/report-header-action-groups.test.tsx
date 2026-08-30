import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { HeatTreatmentHeaderActions, LnkHeaderActions } from '@/components/report-header-action-groups'

function renderActions() {
  const onCreateRequest = vi.fn()
  const onExtendRequest = vi.fn()
  const onOpenRequestRegistry = vi.fn()
  const onOpenPreHeatTreatmentResultRegistry = vi.fn()
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
      onOpenPreHeatTreatmentResultRegistry={onOpenPreHeatTreatmentResultRegistry}
      preHeatTreatmentResultRegistryDisabled={false}
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
    onOpenPreHeatTreatmentResultRegistry,
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

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    fireEvent.click(screen.getByRole('button', { name: 'Все заявки до ТО' }))
    expect(actions.onOpenPreHeatTreatmentResultRegistry).toHaveBeenCalledTimes(1)
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

    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    fireEvent.click(screen.getByRole('button', { name: 'Все результаты до ТО' }))
    expect(actions.onOpenPreHeatTreatmentResultRegistry).toHaveBeenCalledTimes(1)
  })
})

function renderPstoActions() {
  const onOpenLineProgram = vi.fn()
  const onCreateRequest = vi.fn()
  const onEditSelectedRequest = vi.fn()
  const onOpenRequestRegistry = vi.fn()
  const onAddResult = vi.fn()
  const onEditSelectedResults = vi.fn()
  const onOpenResultRegistry = vi.fn()
  const onCreateTvmtRequest = vi.fn()
  const onAddTvmtResult = vi.fn()
  render(
    <HeatTreatmentHeaderActions
      onOpenLineProgram={onOpenLineProgram}
      onCreateRequest={onCreateRequest}
      createRequestDisabled={false}
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
      onCreateTvmtRequest={onCreateTvmtRequest}
      createTvmtRequestDisabled={false}
      onAddTvmtResult={onAddTvmtResult}
      addTvmtResultDisabled={false}
      tvmtPending={false}
      isShowMenuOpen={false}
      onToggleShowMenu={vi.fn()}
      onOpenCurrentReport={vi.fn()}
      onOpenWaitingRequestReport={vi.fn()}
      onOpenResultsReport={vi.fn()}
    />,
  )
  return {
    onOpenLineProgram,
    onCreateRequest,
    onEditSelectedRequest,
    onOpenRequestRegistry,
    onAddResult,
    onEditSelectedResults,
    onOpenResultRegistry,
    onCreateTvmtRequest,
    onAddTvmtResult,
  }
}

describe('HeatTreatmentHeaderActions', () => {
  it('opens the line-level PSTO program as a separate command', () => {
    const actions = renderPstoActions()

    fireEvent.click(screen.getByRole('button', { name: 'Программа ПСТО' }))

    expect(actions.onOpenLineProgram).toHaveBeenCalledTimes(1)
  })

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
        onOpenLineProgram={vi.fn()}
        onCreateRequest={vi.fn()}
        createRequestDisabled={false}
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
        onCreateTvmtRequest={vi.fn()}
        createTvmtRequestDisabled={false}
        onAddTvmtResult={vi.fn()}
        addTvmtResultDisabled={false}
        tvmtPending={false}
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

  it('keeps create, selected edit and shared PSTO history as separate commands', () => {
    const actions = renderPstoActions()

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка' }))
    expect(actions.onCreateRequest).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать выбранную' }))
    expect(actions.onEditSelectedRequest).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    fireEvent.click(screen.getByRole('button', { name: 'История ПСТО и ТВМТ' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'История ПСТО и ТВМТ' }))
    expect(actions.onOpenResultRegistry).toHaveBeenCalledTimes(1)
  })

  it('opens TVMT requests and results as a separate heat-treatment workflow', () => {
    const actions = renderPstoActions()

    fireEvent.click(screen.getByRole('button', { name: 'ТВМТ' }))
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка ТВМТ' }))
    expect(actions.onCreateTvmtRequest).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'ТВМТ' }))
    fireEvent.click(screen.getByRole('button', { name: 'Внести результаты ТВМТ' }))
    expect(actions.onAddTvmtResult).toHaveBeenCalledTimes(1)
  })

  it('uses one PSTO request and result command for every cycle', () => {
    renderPstoActions()

    fireEvent.click(screen.getByRole('button', { name: 'Заявка' }))
    expect(screen.queryByRole('button', { name: 'Повторная заявка' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    expect(screen.queryByRole('button', { name: 'Результат повторной ПСТО' })).not.toBeInTheDocument()
  })

  it('requests workflow context while a menu is open and releases it after an action', () => {
    const onWorkflowMenuOpenChange = vi.fn()
    const onAddTvmtResult = vi.fn()
    render(
      <HeatTreatmentHeaderActions
        onOpenLineProgram={vi.fn()}
        onCreateRequest={vi.fn()}
        createRequestDisabled={false}
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
        onCreateTvmtRequest={vi.fn()}
        createTvmtRequestDisabled={false}
        onAddTvmtResult={onAddTvmtResult}
        addTvmtResultDisabled={false}
        tvmtPending={false}
        isShowMenuOpen={false}
        onToggleShowMenu={vi.fn()}
        onOpenCurrentReport={vi.fn()}
        onOpenWaitingRequestReport={vi.fn()}
        onOpenResultsReport={vi.fn()}
        onWorkflowMenuOpenChange={onWorkflowMenuOpenChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'ТВМТ' }))
    expect(onWorkflowMenuOpenChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: 'Внести результаты ТВМТ' }))
    expect(onAddTvmtResult).toHaveBeenCalledOnce()
    expect(onWorkflowMenuOpenChange).toHaveBeenLastCalledWith(false)
  })
})
