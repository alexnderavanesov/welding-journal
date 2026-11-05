import { LnkOfficialityDialog } from './lnk-officiality-dialog'
import { DuplicateControlDialog } from './duplicate-control-dialog'
import { createEmptyDuplicateControlDraft } from '@/lib/duplicate-control-types'
import type { WeldRow } from '@/lib/dispatcher-types'
import { useLayoutEffect, useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LargeDialogShell } from './large-dialog-shell'
import { ConfirmActionDialog } from './confirm-action-dialog'
import { TechnologyCardEditor } from './technology-card-editor'
import { WdiTableEditorDialog } from './settings-reference-table-dialogs'
import { ConfirmActionProvider } from '@/lib/confirm-action-context'
import { useWindowEscapeKey } from '@/lib/use-window-escape-key'
import { RequestDocumentCombobox } from './request-document-combobox'
import { ProgramViewSettings } from './line-program-view-settings'
import { ProgramControlDetails } from './line-program-control-details'
import { shouldDeferModalEscape } from '@/lib/use-report-modal-escape-key'

afterEach(() => vi.unstubAllGlobals())

it('handles Escape as soon as a reopened upper dialog is mounted', () => {
  const lower = vi.fn(), upper = vi.fn()
  function ImmediateEscape() {
    // The DOM is already interactive during this commit. Do not leave the new
    // dialog waiting for passive effects while older report listeners see it.
    useLayoutEffect(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) }, [])
    return <><LargeDialogShell onEscape={lower}><input defaultValue="Нижний черновик" /></LargeDialogShell><LargeDialogShell onEscape={upper}>Верхнее окно</LargeDialogShell></>
  }
  render(<ImmediateEscape />)
  expect(upper).toHaveBeenCalledOnce()
  expect(lower).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox')).toHaveValue('Нижний черновик')
})

it('closes only the upper dialog after clicking text, retaining the lower draft and never saving it', () => {
  const save = vi.fn()
  function Example() {
    const [above, setAbove] = useState(true), [below, setBelow] = useState(true)
    return <>{below && <TechnologyCardEditor card={null} busy={false} message="" onClose={() => setBelow(false)} onSave={save} />}
      {above && <ConfirmActionDialog title="Подтверждение" onConfirm={save} onClose={() => setAbove(false)} />}</>
  }
  render(<Example />)
  const input = within(screen.getByRole('dialog', { name: 'Новая технологическая карта' })).getAllByRole('textbox')[0]
  fireEvent.change(input, { target: { value: 'Черновик ТК' } })
  input.focus(); input.blur()
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Подтверждение' })).toBeNull()
  expect(input).toHaveValue('Черновик ТК')
  expect(save).not.toHaveBeenCalled()
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('keeps an edited WDI matrix intact when Escape dismisses the discard confirmation', async () => {
  const save = vi.fn(), close = vi.fn()
  render(<ConfirmActionProvider><WdiTableEditorDialog table={null} onSave={save} onClose={close} /></ConfirmActionProvider>)
  const input = screen.getByLabelText('Диаметр 1')
  fireEvent.change(input, { target: { value: '57' } })
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(await screen.findByRole('dialog', { name: 'Закрыть редактор WDI?' })).toBeInTheDocument()
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Закрыть редактор WDI?' })).toBeNull()
  expect(input).toHaveValue('57')
  expect(save).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it('blocks Escape during an operation without closing the window underneath', () => {
  const below = vi.fn(), above = vi.fn()
  render(<><LargeDialogShell onEscape={below}>Нижнее окно</LargeDialogShell><LargeDialogShell onEscape={above} escapeDisabled>Сохранение</LargeDialogShell></>)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(above).not.toHaveBeenCalled()
  expect(below).not.toHaveBeenCalled()
})

it('defers an older capture handler to the active shell before it can reset the underlying draft', () => {
  const below = vi.fn(), above = vi.fn()
  function LegacyParent() {
    useWindowEscapeKey(true, event => {
      if (shouldDeferModalEscape()) return
      event.preventDefault(); below()
    }, { capture: true })
    return <LargeDialogShell onEscape={above}>Новое окно</LargeDialogShell>
  }
  render(<LegacyParent />)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(above).toHaveBeenCalledOnce()
  expect(below).not.toHaveBeenCalled()
})

it('closes the visually upper layer even when a lower portal appears later in the DOM', () => {
  const lower = vi.fn(), upper = vi.fn()
  render(<><LargeDialogShell ariaLabel="Верхнее" onEscape={upper}>Связи</LargeDialogShell><LargeDialogShell ariaLabel="Нижнее" onEscape={lower}>Редактор</LargeDialogShell></>)
  screen.getByRole('dialog', { name: 'Верхнее' }).parentElement!.style.zIndex = '170'
  screen.getByRole('dialog', { name: 'Нижнее' }).parentElement!.style.zIndex = '90'
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(upper).toHaveBeenCalledOnce()
  expect(lower).not.toHaveBeenCalled()
})

it.each(['hidden', 'display', 'visibility', 'aria'])('ignores a %s popup left in the DOM', mode => {
  const close = vi.fn()
  render(<LargeDialogShell onEscape={close}>Редактор<div role="tooltip" className="ag-popup-child" hidden={mode === 'hidden'} aria-hidden={mode === 'aria' ? true : undefined}
    style={{ display: mode === 'display' ? 'none' : undefined, visibility: mode === 'visibility' ? 'hidden' : undefined }}>Скрытая подсказка</div></LargeDialogShell>)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
})

it('ignores the dropdown of a lower modal without discarding its draft', () => {
  const above = vi.fn(), below = vi.fn()
  render(<><LargeDialogShell onEscape={below}><input defaultValue="Черновик" /><div data-select-listbox>Нижний список</div></LargeDialogShell><LargeDialogShell onEscape={above}>Верхнее окно</LargeDialogShell></>)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(above).toHaveBeenCalledOnce()
  expect(below).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox')).toHaveValue('Черновик')
})

it('lets the first Escape close the request picker and the next close its dialog, with reopening by click', () => {
  const close = vi.fn(), change = vi.fn()
  render(<LargeDialogShell onEscape={close}><input aria-label="Черновик" defaultValue="Введённые данные" /><RequestDocumentCombobox ariaLabel="Заявка" options={[]} value="" onChange={change} /></LargeDialogShell>)
  const picker = screen.getByRole('combobox', { name: 'Заявка' })
  fireEvent.click(picker)
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(close).not.toHaveBeenCalled()
  expect(change).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Черновик' })).toHaveValue('Введённые данные')
  fireEvent.click(picker)
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
})

it('closes line program settings and control details after focus moves to body', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  render(<><ProgramViewSettings api={null} /><ProgramControlDetails additional={2} onAdditional={vi.fn()} /></>)
  for (const name of ['Настроить вид программы линий', 'Ещё показатели контроля']) {
    fireEvent.click(screen.getByRole('button', { name }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  }
})

it('dismisses the nested density list before closing the program view settings', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  render(<ProgramViewSettings api={null} />)
  fireEvent.click(screen.getByRole('button', { name: 'Настроить вид программы линий' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Оформление' }))
  const density = screen.getByRole('combobox')
  fireEvent.click(density)
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  fireEvent.keyDown(density, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Вид программы линий' })).toBeInTheDocument()
  fireEvent.keyDown(density, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it.each(['officiality', 'duplicate'] as const)('closes only the nested %s selection preview without losing the draft', kind => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  const close = vi.fn(), save = vi.fn(), change = vi.fn()
  const row = { id: 1, joint: 'F1', line: 'Л1', d1: 89, officiality: 'неофициальный' } as WeldRow
  function Editor() {
    useWindowEscapeKey(true, event => { if (!shouldDeferModalEscape()) { event.preventDefault(); close() } }, { capture: true })
    return kind === 'officiality'
      ? <LnkOfficialityDialog draft={{ search: 'Черновик', officiality: 'official', rowIds: new Set([1]) }} filteredRows={[row]} selectedRows={[row]} counters={{ unofficial: 1, rejectedOfficial: 0 }} saveBlockReason={null} isSaveDisabled={false}
        onClose={close} onSave={save} onDraftChange={change} onToggleRow={vi.fn()} onSetVisibleRowsSelected={vi.fn()} />
      : <DuplicateControlDialog draft={{ ...createEmptyDuplicateControlDraft(), conclusion: 'Черновик', rowIds: new Set([1]), methods: new Set(['ВИК']) }} filteredRows={[row]} selectedRows={[row]} controls={[]} saveBlockReason={null} isSaving={false}
        onClose={close} onSave={save} onDelete={vi.fn()} onEdit={vi.fn()} onDraftChange={change} onToggleRow={vi.fn()} onSetVisibleRowsSelected={vi.fn()} onToggleMethod={vi.fn()} />
  }
  render(<Editor />)
  fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр (1)' }))
  expect(screen.getByRole('dialog', { name: 'Предпросмотр выбранных стыков' })).toBeInTheDocument()
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Предпросмотр выбранных стыков' })).toBeNull()
  expect(screen.getByDisplayValue('Черновик')).toBeInTheDocument()
  expect(close).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  expect(change).not.toHaveBeenCalled()
})
