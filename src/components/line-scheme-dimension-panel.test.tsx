import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SchemeDimension } from '@/lib/line-schemes'
import { LineSchemeDimensionInput, type DimensionEditing } from './line-scheme-dimension-input'

const item: SchemeDimension = { id: 'size', fromPointId: 'a', toPointId: 'b', page: 1, distanceMm: 1250, offsetX: 0, offsetY: .1 }
const editing = (): DimensionEditing => ({ item, surface: 'list', editable: true, buffer: { current: null }, onApply: vi.fn(), onCancel: vi.fn(), onDirty: vi.fn() })
describe('inline dimension input', () => {
  it('preserves text across loss of editing access and rejects writes without access', () => {
    const handlers = editing(), view = render(<LineSchemeDimensionInput item={item} editing={handlers} />)
    const input = screen.getByLabelText('Расстояние, мм', { exact: true })
    fireEvent.change(input, { target: { value: '999,5' } }); expect(handlers.onDirty).toHaveBeenLastCalledWith(true)
    view.rerender(<LineSchemeDimensionInput item={item} editing={{ ...handlers, editable: false }} />)
    expect(input).toBeDisabled(); expect(input).toHaveValue('999,5')
    fireEvent.submit(screen.getByRole('form')); expect(handlers.onApply).not.toHaveBeenCalled()
    view.rerender(<LineSchemeDimensionInput item={item} editing={handlers} />)
    fireEvent.submit(screen.getByRole('form')); expect(handlers.onApply).toHaveBeenCalledWith({ ...item, distanceMm: 999.5 })
  })
  it('retains raw text if a virtual row unmounts and does not apply invalid values', () => {
    const handlers = editing(), view = render(<LineSchemeDimensionInput item={item} editing={handlers} />)
    fireEvent.change(screen.getByLabelText('Расстояние, мм'), { target: { value: '0' } })
    view.unmount(); render(<LineSchemeDimensionInput item={item} editing={handlers} />)
    expect(screen.getByLabelText('Расстояние, мм')).toHaveValue('0'); fireEvent.submit(screen.getByRole('form'))
    expect(screen.getByRole('alert')).toHaveTextContent('положительное'); expect(handlers.onApply).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByLabelText('Расстояние, мм'), { key: 'Escape' }); expect(handlers.onCancel).toHaveBeenCalledOnce()
  })
})
