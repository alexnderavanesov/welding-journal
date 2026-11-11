import { useEffect } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { LineJointPage } from './line-program-joint-page'
import { ProgramDraftProvider } from './line-program-drafts'
import type { WeldRow } from '@/lib/dispatcher-types'

const mocks = vi.hoisted(() => ({ rows: vi.fn(), ensure: vi.fn() }))
vi.mock('@/server/line-program', () => ({ getLineProgramJointPage: mocks.rows }))
vi.mock('@/server/line-program-control', () => ({ applyLineProgramControl: vi.fn(), previewLineProgramControl: vi.fn() }))
vi.mock('@/server/line-program-report', () => ({ getLineProgramReport: vi.fn() }))
vi.mock('@/lib/security-context', () => ({ useAccess: () => ({ can: () => true }), useSecurityGuard: () => ({ requireEditPassword: async () => true }) }))
vi.mock('@/lib/confirm-action-context', () => ({ useConfirmAction: () => vi.fn() }))
vi.mock('./line-program-assignment-table', () => ({
  ProgramAssignmentTable: () => null,
  ProgramReadOnlyTable: ({ onReady }: { onReady: (api: unknown) => void }) => {
    useEffect(() => {
      onReady({ isDestroyed: () => false,
        getRowNode: () => ({ id: '1', data: { id: 1 }, rowIndex: 70, rowTop: 3080, rowHeight: 44 }),
        getFilterModel: () => ({}), ensureNodeVisible: mocks.ensure,
      })
    }, [onReady])
    return <div data-testid="reveal-table" />
  },
}))

const line = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', category: 'II', groupName: 'A', weldControlPercent: 100, pvkControlPercent: 100, configurationIssue: null, version: '2026-11-11T00:00:00Z' }
const row: WeldRow = { id: 1, joint: 'F1', connectionType: 'С', weldDate: '2026-11-01', stamp1K: 'STAMP' }
let client: QueryClient | undefined
let container: HTMLDivElement | undefined

afterEach(() => { cleanup(); client?.clear(); container?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); mocks.ensure.mockClear(); mocks.rows.mockReset() })

async function beginReveal() {
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++sequence; frames.set(id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  const frame = async () => {
    const pending = [...frames.values()]; frames.clear()
    await act(async () => { pending.forEach(callback => callback(performance.now())) })
  }
  const nextRows = { rows: [{ ...row, rowVersion: '124' }], total: 1, approvedKeys: [] }
  let finish!: (value: typeof nextRows) => void
  mocks.rows.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(['line-program', 'rows', 1, 'welds'], { rows: [row], total: 1, approvedKeys: [] })
  container = document.createElement('div'); document.body.append(container)
  const workspace = { key: 'all', selection: { slice: 'all' as const, focusedJoint: 1, reveal: 101 }, container, open: true }
  render(<QueryClientProvider client={client}><ProgramDraftProvider><LineJointPage line={line} workspaces={[workspace]} /></ProgramDraftProvider></QueryClientProvider>)
  await waitFor(() => expect(mocks.rows).toHaveBeenCalledOnce())
  await frame(); await frame(); await frame()
  expect(mocks.ensure).toHaveBeenCalledTimes(1)
  return { frame, finish: () => act(async () => { finish(nextRows) }) }
}

it('continues an unfinished joint reveal when fresh rows replace the cached snapshot', async () => {
  const { frame, finish } = await beginReveal()
  await finish()
  await waitFor(() => expect(client!.getQueryData<{ rows: WeldRow[] }>(['line-program', 'rows', 1, 'welds'])?.rows[0].rowVersion).toBe('124'))
  await frame(); await frame(); await frame()
  expect(mocks.ensure.mock.calls.length).toBeGreaterThan(1)
})

it('does not restart a reveal explicitly cancelled by the operator when fresh rows arrive', async () => {
  const { frame, finish } = await beginReveal()
  act(() => { window.dispatchEvent(new Event('pointerdown')) })
  await finish()
  await frame(); await frame(); await frame(); await frame()
  expect(mocks.ensure).toHaveBeenCalledTimes(1)
})

it('keeps the reveal bounded and does not repeat a completed attempt on later refresh', async () => {
  const { frame, finish } = await beginReveal()
  for (let i = 0; i < 12; i++) await frame()
  const calls = mocks.ensure.mock.calls.length
  expect(calls).toBe(8)
  await finish()
  for (let i = 0; i < 12; i++) await frame()
  expect(mocks.ensure).toHaveBeenCalledTimes(calls)
})
