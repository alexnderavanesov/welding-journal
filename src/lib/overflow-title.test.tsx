import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { overflowTitle } from './overflow-title'

afterEach(cleanup)

it('does not measure on render or repeat fitting text; rechecks truncation on the next hover', () => {
  render(<span {...overflowTitle('Длинное название')}>Длинное название</span>)
  const label = screen.getByText('Длинное название')
  const width = vi.fn(() => 200)
  Object.defineProperties(label, { clientWidth: { get: width }, scrollWidth: { value: 150 } })
  expect(width).not.toHaveBeenCalled()
  expect(label).not.toHaveAttribute('title')
  fireEvent.mouseEnter(label)
  expect(label).not.toHaveAttribute('title')
  fireEvent.mouseLeave(label)
  width.mockReturnValue(100)
  fireEvent.mouseEnter(label)
  expect(label).toHaveAttribute('title', 'Длинное название')
  fireEvent.mouseLeave(label)
  expect(label).not.toHaveAttribute('title')
  width.mockReturnValue(200)
  fireEvent.mouseEnter(label)
  expect(label).not.toHaveAttribute('title')
})

it('reveals clipped child text for keyboard focus without duplicating fitting button labels', () => {
  render(<button {...overflowTitle('Полное имя документа')}><span className="truncate">Полное имя документа</span></button>)
  const label = screen.getByText('Полное имя документа'), button = screen.getByRole('button')
  Object.defineProperties(label, { clientWidth: { value: 100 }, scrollWidth: { value: 180 } })
  fireEvent.focus(button)
  expect(button).toHaveAttribute('title', 'Полное имя документа')
  fireEvent.blur(button)
  expect(button).not.toHaveAttribute('title')
})

it('uses the grid cell when an inline import value is clipped by its parent', () => {
  render(<div className="ag-cell"><span {...overflowTitle('Полное значение', '.ag-cell')}>Полное значение</span></div>)
  const label = screen.getByText('Полное значение')
  Object.defineProperties(label.parentElement!, { clientWidth: { value: 100 }, scrollWidth: { value: 200 } })
  fireEvent.mouseEnter(label)
  expect(label).toHaveAttribute('title', 'Полное значение')
})
