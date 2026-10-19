import { memo } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { JournalGridContext, useJournalCellContext, useJournalGrid } from './welding-journal-grid-context'
import type { WeldTableProps } from '@/lib/weld-report-table-types'
import type { WeldRow } from '@/lib/dispatcher-types'

const row = { id: 1, joint: 'F1' } as WeldRow
const getActionRow = (row: WeldRow) => row
const canEditCell = () => true
const openMenu = () => undefined

describe('journal cell rendering boundary', () => {
  it('does not rerender cells for unrelated report updates, but calls the newest workflow and updates availability', () => {
    let renders = 0
    const Cell = memo(function Cell() {
      renders++
      const { table } = useJournalGrid()
      return <button disabled={table.rowsReady === false || !table.onEdit} onClick={() => table.onEdit?.(row)}>Edit</button>
    })
    function Report({ revision, ready = true, onEdit }: { revision: number; ready?: boolean; onEdit?: WeldTableProps['onEdit'] }) {
      const context = useJournalCellContext({ onEdit, rowsReady: ready }, getActionRow, canEditCell, openMenu)
      return <><span>{revision}</span><JournalGridContext.Provider value={context}><Cell /></JournalGridContext.Provider></>
    }
    const first = vi.fn(), latest = vi.fn()
    const view = render(<Report revision={1} onEdit={first} />)
    expect(renders).toBe(1)
    view.rerender(<Report revision={2} onEdit={latest} />)
    expect(renders).toBe(1)
    fireEvent.click(screen.getByRole('button'))
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledWith(row)
    view.rerender(<Report revision={3} onEdit={latest} ready={false} />)
    expect(renders).toBe(2)
    expect(screen.getByRole('button')).toBeDisabled()
    view.rerender(<Report revision={4} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
