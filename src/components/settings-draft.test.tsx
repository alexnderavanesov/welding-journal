import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsDirtyContext, SettingsDraftActions, useSettingsDraft } from './settings-draft'
const allow = async (action: () => void | Promise<void>) => { await action(); return true }
afterEach(cleanup)
describe('settings drafts', () => {
  it('keeps changes local, recognizes a revert, and awaits persistence', async () => {
    let finish!: () => void
    const persist = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const { result } = renderHook(() => useSettingsDraft('rules.input', { enabled: true }, allow, persist))
    act(() => result.current.change({ enabled: false }))
    expect(result.current.dirty).toBe(true)
    expect(persist).not.toHaveBeenCalled()
    act(() => result.current.change({ enabled: true }))
    expect(result.current.dirty).toBe(false)
    act(() => result.current.change({ enabled: false }))
    let pending!: Promise<boolean>
    act(() => { pending = result.current.save(); void result.current.save() })
    expect(persist).toHaveBeenCalledOnce()
    expect(result.current.busy).toBe(true)
    act(() => result.current.reset())
    expect(result.current.dirty).toBe(true)
    await act(async () => { finish(); await pending })
    expect(result.current.dirty).toBe(false)
  })
  it('retains a draft after a denied guard, cancelled confirmation or rejected save', async () => {
    for (const mode of ['denied', 'cancelled', 'failed']) {
      const persist = vi.fn(async () => { if (mode === 'failed') throw new Error('Ошибка сети'); return false })
      const { result, unmount } = renderHook(() => useSettingsDraft('other', 1, mode === 'denied' ? async () => false : allow, persist))
      act(() => result.current.change(2))
      await act(() => result.current.save())
      expect(result.current.dirty).toBe(true)
      expect(result.current.value).toBe(2)
      expect(result.current.busy).toBe(false)
      if (mode === 'failed') expect(result.current.message).toBe('Ошибка сети')
      if (mode === 'denied') expect(persist).not.toHaveBeenCalled()
      unmount()
    }
  })
  it('preserves stale input and rechecks a concurrent change after the access guard', async () => {
    let unlock!: () => void
    const persist = vi.fn()
    const guard = async (action: () => void | Promise<void>) => { await new Promise<void>(resolve => { unlock = resolve }); await action(); return true }
    const { result, rerender } = renderHook(({ saved }) => useSettingsDraft('rules.tasks', saved, guard, persist), { initialProps: { saved: 1 } })
    act(() => result.current.change(2))
    let pending!: Promise<boolean>
    act(() => { pending = result.current.save() })
    rerender({ saved: 3 })
    expect(result.current.value).toBe(2)
    expect(result.current.stale).toBe(true)
    await act(async () => { unlock(); await pending })
    expect(persist).not.toHaveBeenCalled()
    expect(result.current.dirty).toBe(true)
    act(() => result.current.reset())
    expect(result.current.value).toBe(3)
  })
  it('tracks independent editors and reserves the footer before changes', async () => {
    const states = new Map<string, boolean>()
    const update = (source: string, dirty: boolean) => { states.set(source, dirty) }
    function Editor({ source }: { source: string }) {
      const draft = useSettingsDraft(source, false, allow, async () => {})
      return <section><button onClick={() => draft.change(true)}>{source}</button><SettingsDraftActions draft={draft} /></section>
    }
    render(<SettingsDirtyContext.Provider value={update}><Editor source="rules.input" /><Editor source="rules.tasks" /></SettingsDirtyContext.Provider>)
    expect(document.querySelectorAll('[data-settings-save-footer]')).toHaveLength(2)
    expect(screen.queryByText('Есть несохранённые изменения')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('rules.input')); fireEvent.click(screen.getByText('rules.tasks'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Сохранить изменения' })[0])
    await waitFor(() => expect(states.get('rules.input')).toBe(false))
    expect(states.get('rules.tasks')).toBe(true)
  })
})
