import { describe, expect, it, vi } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildPstoCycleHistoryContextMenuItem } from '@/lib/psto-report-context-menu'

describe('PSTO report context menu', () => {
  it('opens the exact cycle history from a direct report menu item', () => {
    const row = { id: 7, joint: 'F7', pstoRequired: 'да' } as WeldRow
    const onOpen = vi.fn()
    const item = buildPstoCycleHistoryContextMenuItem({ rows: [row], onOpen })

    expect(item).toMatchObject({
      id: 'psto-cycle-history',
      label: 'История циклов ПСТО/ТВМТ',
      disabled: false,
    })

    item.onSelect()
    expect(onOpen).toHaveBeenCalledWith([row])
  })

  it('keeps the history action visible with a reason when no cycle exists', () => {
    const item = buildPstoCycleHistoryContextMenuItem({
      rows: [{ id: 8, joint: 'F8' } as WeldRow],
      onOpen: vi.fn(),
    })

    expect(item).toMatchObject({
      disabled: true,
      title: 'Для выбранных стыков история ПСТО и ТВМТ пока пуста',
    })
  })

  it('opens legacy repeat-only cycle history instead of disabling the action', () => {
    const row = {
      id: 9,
      joint: 'F9',
      pstoRepeatCycles: [{ id: 20, weldJointId: 9, sequence: 2, pstoRequest: 'ПСТО-002' }],
    } as WeldRow
    const onOpen = vi.fn()
    const item = buildPstoCycleHistoryContextMenuItem({ rows: [row], onOpen })

    expect(item.disabled).toBe(false)
    item.onSelect()
    expect(onOpen).toHaveBeenCalledWith([row])
  })

  it('names a selected-row history action explicitly', () => {
    const item = buildPstoCycleHistoryContextMenuItem({
      rows: [
        { id: 7, pstoRequired: 'да' } as WeldRow,
        { id: 8, pstoRequired: 'да' } as WeldRow,
      ],
      onOpen: vi.fn(),
    })

    expect(item.label).toBe('История циклов ПСТО/ТВМТ выбранных (2)')
  })
})
