import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { PermissionEditor } from './permission-editor'
import { normalizePermissions, PERMISSIONS, type Permission } from '@/lib/access-permissions'

function Editor({ initial = [] }: { initial?: Permission[] }) {
  const [value, setValue] = useState(initial)
  return <><PermissionEditor value={value} onChange={next => { normalizePermissions(next); setValue(next) }} />
    <output aria-label="Выбранные права">{JSON.stringify(value)}</output></>
}
const box = (name: string) => screen.getByRole('checkbox', { name })
const value = () => JSON.parse(screen.getByLabelText('Выбранные права').textContent!) as Permission[]

it('selects every applicable cell in each column once, adds required views and preserves unrelated rights on removal', () => {
  render(<Editor />)
  const headers = within(screen.getAllByRole('row')[0]).getAllByRole('checkbox')
  for (const header of headers) fireEvent.click(header)
  expect(value().sort()).toEqual([...PERMISSIONS].sort())
  expect(new Set(value()).size).toBe(value().length)
  for (const header of headers.slice(1)) {
    const index = headers.indexOf(header) + 1
    fireEvent.click(header)
    for (const row of screen.getAllByRole('row').slice(1)) {
      const cell = row.children[index]
      const checkbox = within(cell as HTMLElement).queryByRole('checkbox')
      if (checkbox) expect(checkbox).not.toBeChecked()
    }
    expect(box('Все: Просмотр')).toBeChecked()
  }
  fireEvent.click(box('Все: Просмотр'))
  expect(value()).toEqual([])
})

it('reflects partial selection, keeps the two history rights independent and clears dependent actions with all views', () => {
  render(<Editor initial={['welding.view', 'welding.edit', 'history.joint']} />)
  expect(box('Все: Просмотр')).toBePartiallyChecked()
  expect(box('Все: Изменение')).toBePartiallyChecked()
  fireEvent.click(box('Все: Просмотр'))
  expect(box('Все: Просмотр')).toBeChecked()
  fireEvent.click(box('Журнал действий: Просмотр'))
  expect(box('История отдельного стыка: Просмотр')).toBeChecked()
  expect(box('Все: Просмотр')).toBePartiallyChecked()
  fireEvent.click(box('Все: Просмотр'))
  fireEvent.click(box('Все: Просмотр'))
  expect(value()).toEqual([])
  fireEvent.click(box('Все: Импорт и массовое заполнение'))
  expect(value().sort()).toEqual(['welding.import', 'welding.view'])
})

it('updates column states after replacing a profile and keeps read-only controls disabled', () => {
  const change = vi.fn()
  const { rerender } = render(<PermissionEditor value={['welding.view']} onChange={change} />)
  expect(box('Все: Просмотр')).toBePartiallyChecked()
  rerender(<PermissionEditor value={PERMISSIONS} onChange={change} disabled />)
  for (const checkbox of screen.getAllByRole('checkbox')) {
    expect(checkbox).toBeChecked(); expect(checkbox).toBeDisabled()
  }
  expect(box('Все: Просмотр')).not.toBePartiallyChecked()
  rerender(<PermissionEditor value={[]} />)
  for (const checkbox of screen.getAllByRole('checkbox')) {
    expect(checkbox).not.toBeChecked(); expect(checkbox).toBeDisabled()
  }
  expect(change).not.toHaveBeenCalled()
})
