import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { useWeldTableContextMenu } from './use-weld-table-context-menu'

const rows: WeldRow[] = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, joint: `F${index + 1}`, rowVersion: 'v1' }))
const selectedIds = new Set(rows.map(row => row.id))
const position = { x: 12, y: 25 }
function deferred() {
  let resolve!: (rows: WeldRow[]) => void, reject!: (error: Error) => void
  const promise = new Promise<WeldRow[]>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  const pending = deferred(), loadRowsByIds = vi.fn(() => pending.promise), onError = vi.fn(), onSelect = vi.fn()
  const getItems = vi.fn((_row: WeldRow, selected: WeldRow[]) => [{ id: 'action', label: `Все ${selected.length}`, onSelect: () => onSelect(selected) }])
  const initial = { rowsReady: true, queryIdentity: 'A', selectedIds, rows: rows.slice(0, 10) }
  const hook = renderHook(props => useWeldTableContextMenu({ ...props, loadRowsByIds, onError, getItems }), { initialProps: initial })
  return { ...hook, pending, loadRowsByIds, onError, getItems, onSelect, initial }
}

describe('explicit exact-selection context menus', () => {
  it('coalesces repeated opens into one exact batch and never offers a partial action', async () => {
    const { result, pending, loadRowsByIds, getItems, onSelect } = setup()
    expect(loadRowsByIds).not.toHaveBeenCalled()
    act(() => { result.current.openRow(rows[4]!, position, 'joint'); result.current.openRow(rows[4]!, position, 'joint') })
    expect(loadRowsByIds).toHaveBeenCalledExactlyOnceWith([...selectedIds])
    expect(getItems).not.toHaveBeenCalled()
    expect(result.current.menu?.items).toEqual([{ type: 'label', id: 'selection-loading', label: 'Загружаем выбранные стыки…' }])
    await act(async () => { pending.resolve([...rows].reverse()); await pending.promise })
    expect(result.current.menu?.anchorRowId).toBe(5)
    expect(getItems).toHaveBeenCalledExactlyOnceWith(rows[4], rows, 'joint')
    const item = result.current.menu!.items[0]!
    if (item.type === 'separator' || item.type === 'label') throw new Error('action missing')
    act(() => item.onSelect())
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(rows)
    expect(loadRowsByIds).toHaveBeenCalledTimes(1)
  })

  it.each(['missing', 'extra', 'duplicate', 'offline'] as const)('refuses %s results, closes the shell and allows explicit retry with the same full selection', async kind => {
    const { result, pending, loadRowsByIds, getItems, onError } = setup()
    act(() => result.current.openSelection(position))
    await act(async () => {
      if (kind === 'offline') pending.reject(new Error('offline'))
      else pending.resolve(kind === 'missing' ? rows.slice(1) : kind === 'extra' ? [...rows, { id: 999 }] : [...rows.slice(1), rows[1]!])
      await pending.promise.catch(() => {})
    })
    expect(result.current.menu).toBeNull()
    expect(getItems).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(selectedIds.size).toBe(100)
    expect(loadRowsByIds).toHaveBeenCalledTimes(1)
    loadRowsByIds.mockResolvedValueOnce(rows)
    await act(async () => { result.current.openSelection(position) })
    expect(getItems).toHaveBeenCalledExactlyOnceWith(rows[0], rows)
    expect(loadRowsByIds).toHaveBeenCalledTimes(2)
  })

  it.each(['close', 'row', 'group'] as const)('does not reopen after %s replaces a pending intent', async replacement => {
    const { result, pending, getItems, onError } = setup()
    act(() => result.current.openRow(rows[0]!, position))
    act(() => {
      if (replacement === 'close') result.current.close()
      if (replacement === 'row') result.current.openRow({ id: 500, joint: 'OTHER' }, position)
      if (replacement === 'group') result.current.openCustom({ ...position, heading: 'Группа', items: [{ type: 'label', id: 'group', label: 'Свернуть' }] })
    })
    const expected = result.current.menu
    await act(async () => { pending.resolve(rows); await pending.promise })
    expect(result.current.menu).toBe(expected)
    expect(getItems).toHaveBeenCalledTimes(replacement === 'row' ? 1 : 0)
    expect(onError).not.toHaveBeenCalled()
  })

  it('cancels an earlier selected anchor while a later selected anchor is pending', async () => {
    const { result, pending, loadRowsByIds, getItems } = setup()
    const next = deferred()
    act(() => result.current.openRow(rows[0]!, position))
    loadRowsByIds.mockImplementationOnce(() => next.promise)
    act(() => result.current.openRow(rows[1]!, position))
    await act(async () => { pending.resolve(rows); await pending.promise })
    expect(getItems).not.toHaveBeenCalled()
    await act(async () => { next.resolve(rows); await next.promise })
    expect(result.current.menu?.anchorRowId).toBe(2)
    expect(getItems).toHaveBeenCalledExactlyOnceWith(rows[1], rows)
    expect(loadRowsByIds).toHaveBeenCalledTimes(2)
  })

  it('does not open a late menu on a virtualized or replaced anchor', async () => {
    const { result, pending, getItems } = setup()
    const anchor = document.createElement('div')
    document.body.append(anchor)
    act(() => result.current.openRow(rows[0]!, { ...position, anchorElement: anchor }))
    anchor.remove()
    await act(async () => { pending.resolve(rows); await pending.promise })
    expect(result.current.menu).toBeNull()
    expect(getItems).not.toHaveBeenCalled()
  })

  it.each(['identity', 'selection', 'version', 'readiness'] as const)('closes loading state on A/B/A %s changes and ignores its result', async change => {
    const { result, rerender, initial, pending, getItems } = setup()
    act(() => result.current.openSelection(position))
    rerender({ ...initial, ...(change === 'identity' ? { queryIdentity: 'B' } : change === 'selection' ? { selectedIds: new Set([1]) }
      : change === 'version' ? { rows: [{ ...rows[0]!, rowVersion: 'v2' }] } : { rowsReady: false }) })
    expect(result.current.menu).toBeNull()
    rerender(initial)
    await act(async () => { pending.resolve(rows); await pending.promise })
    expect(result.current.menu).toBeNull()
    expect(getItems).not.toHaveBeenCalled()
  })

  it('cancels modal A/B/A even with frozen report props, and ignores a late rejection', async () => {
    const { result, pending, getItems, onError, loadRowsByIds } = setup()
    act(() => result.current.openSelection(position))
    await act(async () => {
      const portal = document.createElement('div')
      portal.innerHTML = '<section data-modal-dialog="true"></section>'
      document.body.append(portal)
      portal.remove()
      await Promise.resolve()
    })
    expect(result.current.menu).toBeNull()
    await act(async () => { pending.reject(new Error('late')); await pending.promise.catch(() => {}) })
    expect(getItems).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    loadRowsByIds.mockResolvedValueOnce(rows)
    await act(async () => { result.current.openSelection(position) })
    expect(getItems).toHaveBeenCalledTimes(1)
  })

  it('blocks entry while a modal is already open and closes a ready menu on row-version change', async () => {
    const { result, rerender, initial, loadRowsByIds } = setup()
    const portal = document.createElement('section')
    portal.dataset.modalDialog = 'true'
    document.body.append(portal)
    act(() => result.current.openRow(rows[0]!, position))
    expect(result.current.menu).toBeNull()
    expect(loadRowsByIds).not.toHaveBeenCalled()
    portal.remove()
    rerender({ ...initial, selectedIds: new Set([1]) })
    act(() => result.current.openRow(rows[0]!, position))
    expect(result.current.menu?.heading).toBe('Стык F1')
    rerender({ ...initial, selectedIds: new Set([1]), rows: [{ ...rows[0]!, rowVersion: 'v2' }] })
    expect(result.current.menu).toBeNull()
    expect(loadRowsByIds).not.toHaveBeenCalled()
  })
})
