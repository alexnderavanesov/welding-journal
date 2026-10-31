import { useLayoutEffect } from 'react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useWeldTableContextMenu } from './use-weld-table-context-menu'

describe('context menu opened between a block commit and passive effects', () => {
  it.each(['group', 'row'] as const)('does not discard a new %s menu with the previous render cleanup', kind => {
    const initial = { rows: [{ id: 1, joint: 'F1', rowVersion: 'v1' }], open: false }
    const selectedIds = new Set<number>()
    const custom = { x: 10, y: 20, heading: 'Group', items: [{ type: 'label' as const, id: 'expand', label: 'Развернуть все' }] }
    const { result, rerender } = renderHook(props => {
      const menu = useWeldTableContextMenu({ rowsReady: true, queryIdentity: 'same', customQueryIdentity: 'same:line',
        rows: props.rows, selectedIds, getItems: () => custom.items })
      useLayoutEffect(() => {
        if (props.open) {
          if (kind === 'group') menu.openCustom(custom)
          else menu.openRow(props.rows[0]!, { x: 10, y: 20 })
        }
      }, [props.rows, props.open])
      return menu
    }, { initialProps: initial })
    rerender({ rows: [...initial.rows, { id: 2, joint: 'F2', rowVersion: 'v1' }], open: true })
    expect(result.current.menu?.items).toEqual(custom.items)
    expect(result.current.menu?.heading).toBe(kind === 'group' ? 'Group' : 'Стык F1')
  })
})
