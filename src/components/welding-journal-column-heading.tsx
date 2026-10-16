import { useEffect, useState } from 'react'
import type { IHeaderParams } from 'ag-grid-community'
import { Pin } from 'lucide-react'

/** Only replace the label; AG still owns sorting, filtering, resizing and focus. */
export function JournalColumnHeading({ column, displayName, api }: IHeaderParams) {
  const [pinned, setPinned] = useState(column.getPinned())
  useEffect(() => {
    const update = () => setPinned(column.getPinned())
    update()
    api.addEventListener('columnPinned', update)
    return () => { if (!api.isDestroyed()) api.removeEventListener('columnPinned', update) }
  }, [api, column])
  return <span className="journal-column-heading"><span>{displayName}</span>{pinned && !column.getColId().startsWith('ag-Grid-SelectionColumn') ? <span className="journal-column-pin" aria-hidden="true"
    title={`Закреплён ${pinned === 'left' ? 'слева' : 'справа'}. Изменить — через ПКМ.`}>
    <Pin size={12} strokeWidth={1.7} />
  </span> : null}</span>
}
