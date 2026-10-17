import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GridAppearanceSwitch, GridDensitySelect, GridThemeChoices } from './grid-view-settings-controls'

afterEach(cleanup)

describe('shared grid view controls', () => {
  it('preserves the journal density label and gives simultaneous grids distinct option IDs', () => {
    const journalChange = vi.fn(), documentsChange = vi.fn()
    render(<><GridDensitySelect value="comfortable" onChange={journalChange} /><GridDensitySelect label="Плотность строк документов" value="spacious" onChange={documentsChange} /></>)
    const journal = screen.getByRole('combobox', { name: 'Плотность строк' }), documents = screen.getByRole('combobox', { name: 'Плотность строк документов' })
    expect(journal.getAttribute('aria-controls')).not.toBe(documents.getAttribute('aria-controls'))
    fireEvent.click(journal)
    expect(document.getElementById(journal.getAttribute('aria-activedescendant')!)).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(journal, { key: 'End' }); fireEvent.keyDown(journal, { key: 'Enter' })
    expect(journalChange).toHaveBeenCalledWith('spacious')
    expect(documentsChange).not.toHaveBeenCalled()
    fireEvent.click(documents)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('renders caller-owned switches and retains the journal theme choices', () => {
    const toggle = vi.fn(), theme = vi.fn()
    render(<><GridAppearanceSwitch label="Жёлтая заливка задач и дублей" checked onChange={toggle} /><GridThemeChoices value="balham" onChange={theme} /></>)
    const control = screen.getByRole('switch', { name: 'Жёлтая заливка задач и дублей' })
    expect(control).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(control); expect(toggle).toHaveBeenCalledWith(false)
    expect(screen.getByRole('radiogroup', { name: 'Тема таблицы' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Нейтральная/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: /Светлая/ }))
    expect(theme).toHaveBeenCalledWith('quartz')
  })
})
