import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProgramApprovalActions } from './line-program-approval-actions'
import type { ProgramApprovalOption } from '@/lib/program-approval-actions'

afterEach(cleanup)
const combination: ProgramApprovalOption = { key: 'combination', rowId: 1, kind: 'common', duplicate: true }
const pvk: ProgramApprovalOption = { key: 'pvk', rowId: 1, kind: 'pvk', duplicate: false }
describe('compact approval actions', () => {
  it('does not revoke an independent PVK decision with the combination on the same joint', () => {
    const onAction = vi.fn()
    render(<ProgramApprovalActions approve={[]} revoke={[combination, pvk]} disabled={false} draft={false} onAction={onAction} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'revoke:combination' } })
    expect(onAction).toHaveBeenCalledExactlyOnceWith('revoke', [combination])
    expect(screen.getByRole('option', { name: 'Снять согласование ПВК · 1' })).toBeTruthy()
  })
  it('uses one compact button and blocks decisions while assignments have an unsaved draft', () => {
    const onAction = vi.fn()
    render(<ProgramApprovalActions approve={[combination]} revoke={[]} disabled={false} draft onAction={onAction} />)
    const button = screen.getByRole('button', { name: 'Согласовать сочетание · 1' })
    expect(button).toBeDisabled(); fireEvent.click(button); expect(onAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
  it('adds no empty controls when nothing is selected', () => {
    const { container } = render(<ProgramApprovalActions approve={[]} revoke={[]} disabled={false} draft={false} onAction={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
