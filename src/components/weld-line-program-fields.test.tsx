import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WeldLineProgramFields } from '@/components/weld-line-program-fields'
import type { WeldInput } from '@/lib/weld-fields'

vi.mock('@/server/line-program', () => ({ findLineProgram: vi.fn() }))
vi.mock('@/server/line-program-control', () => ({ changeLayeredControl: vi.fn() }))

describe('line-program fields in the weld form', () => {
  it('does not replace the draft when program values already match', () => {
    const { row, apply } = renderCachedProgram()
    expect(apply(row)).toBe(row)
  })

  it('does not apply a previous program to a newer line, project or code', () => {
    const { row, apply } = renderCachedProgram()
    for (const key of ['line', 'projectTitle', 'subtitleCode']) {
      const newer = { ...row, [key]: 'new identity', category: 'new category' }
      expect(apply(newer)).toBe(newer)
    }
  })

  it('clears shared properties when the line is removed, preserving individual data and assignments', () => {
    const client = new QueryClient()
    const row: WeldInput = { line: '', category: 'II', groupName: 'Б(а)', weldControlPercent: 30,
      pvkControlPercent: 10, lineProgramId: 1, isometry: 'ISO-1', hasRk: 'да' }
    const setDraft = vi.fn()
    render(<QueryClientProvider client={client}><WeldLineProgramFields draft={row} setDraft={setDraft} /></QueryClientProvider>)
    const next = setDraft.mock.calls[0][0](row)
    expect(next).toEqual({ ...row, category: null, groupName: null, weldControlPercent: null, pvkControlPercent: null, lineProgramId: null })
  })
})

function renderCachedProgram() {
  const identity = { projectTitle: 'Проект', subtitleCode: 'Шифр', line: 'L-1' }
  const row: WeldInput = { ...identity, category: 'II', groupName: 'Б(а)', weldControlPercent: 10, pvkControlPercent: 5, lineProgramId: 1, hasVik: 'да' }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['line-program', 'identity', identity], { ...row, id: 1 })
  const setDraft = vi.fn()
  render(<QueryClientProvider client={client}><WeldLineProgramFields draft={row} setDraft={setDraft} /></QueryClientProvider>)
  expect(setDraft).toHaveBeenCalledTimes(1)
  return { row, apply: setDraft.mock.calls[0][0] as (value: WeldInput) => WeldInput }
}
