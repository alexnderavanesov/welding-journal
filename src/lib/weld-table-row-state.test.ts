import { describe, expect, it } from 'vitest'

import {
  getWeldTableRowClassName,
  getWeldTableRowTitle,
  getWeldTableStickyCellBackgroundClassName,
} from '@/lib/weld-table-row-state'

describe('weld table row state', () => {
  it('highlights rows with dispatcher tasks', () => {
    const className = getWeldTableRowClassName({
      readOnly: false,
      isHighlighted: false,
      isSelected: false,
      isDuplicate: false,
      hasDispatcherTask: true,
    })

    expect(className).toContain('bg-amber-100')
    expect(
      getWeldTableStickyCellBackgroundClassName({
        rowIndex: 0,
        isHighlighted: false,
        isSelected: false,
        isDuplicate: false,
        hasDispatcherTask: true,
      }),
    ).toContain('bg-amber-100')
    expect(getWeldTableRowTitle({ isHighlighted: false, isDuplicate: false, hasDispatcherTask: true })).toBe(
      'По этому стыку есть активная задача диспетчера',
    )
  })

  it('uses one visual color for duplicates and dispatcher tasks', () => {
    const className = getWeldTableRowClassName({
      readOnly: false,
      isHighlighted: false,
      isSelected: false,
      isDuplicate: true,
      hasDispatcherTask: true,
    })

    expect(className).toContain('bg-amber-100')
    expect(getWeldTableRowTitle({ isHighlighted: false, isDuplicate: true, hasDispatcherTask: true })).toBe(
      'Возможный дубль: совпадают ключевые поля стыка',
    )
  })

  it('keeps hover-like row highlight while context menu is open', () => {
    const className = getWeldTableRowClassName({
      readOnly: false,
      isHighlighted: false,
      isSelected: false,
      isDuplicate: false,
      hasDispatcherTask: false,
      isContextMenuAnchor: true,
    })

    expect(className).toContain('bg-[#cfeeff]')
    expect(
      getWeldTableStickyCellBackgroundClassName({
        rowIndex: 0,
        isHighlighted: false,
        isSelected: false,
        isDuplicate: false,
        hasDispatcherTask: false,
        isContextMenuAnchor: true,
      }),
    ).toContain('bg-[#cfeeff]')
  })
})
