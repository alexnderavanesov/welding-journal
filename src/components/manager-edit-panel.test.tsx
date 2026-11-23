import { useEffect } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ManagerEditPanel, ManagerEditSection } from './manager-edit-panel'

it('mounts editors on demand and preserves a draft when folded or reopened through the menu', () => {
  const load = vi.fn()
  function Editor() {
    useEffect(load, [])
    return <ManagerEditSection title="Редактирование заключения" description="Все позиции"><input aria-label="Название" defaultValue="Общее" /></ManagerEditSection>
  }
  const view = render(<ManagerEditPanel title="Документ"><Editor /></ManagerEditPanel>)
  expect(load).not.toHaveBeenCalled()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }))
  expect(load).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Черновик' } })
  fireEvent.click(screen.getByRole('button', { name: 'Свернуть редактирование' }))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  view.rerender(<ManagerEditPanel title="Документ" requestToken={1}><Editor /></ManagerEditPanel>)
  expect(screen.getByRole('textbox')).toHaveValue('Черновик')
  expect(load).toHaveBeenCalledTimes(1)
})
