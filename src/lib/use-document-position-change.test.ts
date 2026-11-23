import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useDocumentPositionChange } from './use-document-position-change'

const confirm = vi.hoisted(() => vi.fn())
vi.mock('./confirm-action-context', () => ({ useConfirmAction: () => confirm }))

it('explains moving one position and does not save a cancelled change', async () => {
  const save = vi.fn()
  const { result } = renderHook(useDocumentPositionChange)
  const data = { previousName: 'Общее', nextName: 'Отдельное', position: 'Линия · F1 · ВИК', save }
  confirm.mockResolvedValueOnce(false)
  await result.current(data)
  expect(save).not.toHaveBeenCalled()
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
    itemName: data.position,
    description: expect.stringContaining('«Общее» → «Отдельное»'),
    warning: expect.stringContaining('последняя позиция'),
  }))
  confirm.mockResolvedValueOnce(true)
  await result.current(data)
  expect(save).toHaveBeenCalledTimes(1)
  confirm.mockClear()
  await result.current({ ...data, nextName: 'Общее' })
  expect(confirm).not.toHaveBeenCalled()
  expect(save).toHaveBeenCalledTimes(2)
})
