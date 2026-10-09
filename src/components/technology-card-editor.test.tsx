import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { saveDataListSettings, DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { TechnologyCardEditor } from './technology-card-editor'

beforeEach(() => {
  localStorage.clear()
  saveDataListSettings({ ...DEFAULT_DATA_LIST_SETTINGS, weldingTypes: ['РАД', 'РД', 'АФ'] }, { syncRemote: false })
})

it('limits methods and groups to two, allowing deselection and replacement', () => {
  render(<TechnologyCardEditor card={null} busy={false} message="" onClose={vi.fn()} onSave={vi.fn()} />)
  for (const values of [['РАД', 'РД', 'АФ'], ['М01', 'М05', 'М11']]) {
    const controls = values.map(name => screen.getByRole('checkbox', { name }))
    fireEvent.click(controls[0]); fireEvent.click(controls[1])
    expect(controls[2]).toBeDisabled()
    expect(controls[0]).toBeEnabled()
    fireEvent.click(controls[0])
    expect(controls[2]).toBeEnabled()
    fireEvent.click(controls[2])
    expect(controls[0]).toBeDisabled()
    expect(controls[2]).toBeChecked()
  }
})

it('keeps form errors together and help outside the scrollable editor', () => {
  const save = vi.fn(), close = vi.fn()
  render(<TechnologyCardEditor card={null} busy={false} message="" onClose={close} onSave={save} />)
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить ТК' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Выберите способы сварки')
  expect(screen.getByRole('alert')).toHaveTextContent('Диаметр от')
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Как проверяются размеры ТК' }))
  expect(screen.getByRole('tooltip')).toHaveTextContent('D57 и T3')
  expect(within(screen.getByRole('dialog')).queryByRole('tooltip')).toBeNull()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
})
