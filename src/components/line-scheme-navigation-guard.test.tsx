import { render } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { LineSchemeNavigationGuard, LineSchemeOpening } from './line-scheme-navigation-guard'

const mocks = vi.hoisted(() => ({ blocker: vi.fn(), confirm: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({}), useBlocker: mocks.blocker }))
vi.mock('@/lib/confirm-action-context', () => ({ useConfirmAction: () => mocks.confirm }))
const navigation = { current: { pathname: '/line-schemes' }, next: { pathname: '/percentage-lines' } }
const options = () => mocks.blocker.mock.lastCall![0]
beforeEach(() => { vi.clearAllMocks(); mocks.confirm.mockResolvedValue(false) })

it('protects a selected file before the lazy workspace mounts, without blocking an ordinary opening', async () => {
  const { rerender } = render(<LineSchemeOpening hasSelectedFile />)
  expect(options().disabled).toBe(false)
  expect(await options().shouldBlockFn(navigation)).toBe(true)
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('Выбранный файл') }))
  rerender(<LineSchemeOpening />)
  expect(options().disabled).toBe(true)
})

it('asks before losing a drawing draft, keeps it after cancel, and permits an explicit discard', async () => {
  render(<LineSchemeNavigationGuard dirty busy={false} uncertain={false} onBlocked={vi.fn()} />)
  expect(options().disabled).toBe(false)
  expect(await options().shouldBlockFn(navigation)).toBe(true)
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Уйти из схемы линии?', confirmLabel: 'Уйти без сохранения' }))
  mocks.confirm.mockResolvedValueOnce(true)
  expect(await options().shouldBlockFn(navigation)).toBe(false)
})

it.each(['busy', 'uncertain'] as const)('keeps the drawing mounted during %s without offering a misleading discard', async state => {
  const blocked = vi.fn()
  render(<LineSchemeNavigationGuard dirty busy={state === 'busy'} uncertain={state === 'uncertain'} onBlocked={blocked} />)
  expect(await options().shouldBlockFn(navigation)).toBe(true)
  expect(mocks.confirm).not.toHaveBeenCalled()
  expect(blocked).toHaveBeenCalledOnce()
})

it('coalesces repeated navigation attempts while one confirmation is open', async () => {
  let resolve!: (confirmed: boolean) => void
  mocks.confirm.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done }))
  render(<LineSchemeNavigationGuard dirty busy={false} uncertain={false} onBlocked={vi.fn()} />)
  const first = options().shouldBlockFn(navigation), second = options().shouldBlockFn(navigation)
  expect(mocks.confirm).toHaveBeenCalledOnce()
  resolve(false)
  expect(await Promise.all([first, second])).toEqual([true, true])
})

it('allows same-section navigation and clean exits; native unloading protects unconfirmed operations too', async () => {
  const { rerender, unmount } = render(<LineSchemeNavigationGuard dirty={false} busy={false} uncertain onBlocked={vi.fn()} />)
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  expect(await options().shouldBlockFn({ current: navigation.current, next: navigation.current })).toBe(false)
  rerender(<LineSchemeNavigationGuard dirty={false} busy={false} uncertain={false} onBlocked={vi.fn()} />)
  expect(options().disabled).toBe(true)
  expect(await options().shouldBlockFn(navigation)).toBe(false)
  const clean = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(clean)
  expect(clean.defaultPrevented).toBe(false)
  unmount()
})
