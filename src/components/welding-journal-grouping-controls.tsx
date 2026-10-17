import { useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, GripVertical, ListTree, X } from 'lucide-react'

export type JournalGrouping = { id: string; label: string }
type GroupDrag = {
  id: string; pointerId: number; startX: number; startY: number; rect: DOMRect
  order: string; active: boolean; target: number | null
}
type DragPreview = { group: JournalGrouping; level: number; left: number; top: number; width: number; height: number; target: number | null }

/** Lives in the existing toolbar: adding levels never shifts the grid or its header. */
export function JournalGroupingControls({ groups, onChange, scope = 'loaded' }: { groups: JournalGrouping[]; onChange: (ids: string[]) => void; scope?: 'loaded' | 'documents' }) {
  const levels = useRef<HTMLDivElement>(null)
  const dragged = useRef<GroupDrag | null>(null)
  const [preview, setPreview] = useState<DragPreview | null>(null)
  const move = (id: string, to: number) => {
    const from = groups.findIndex(group => group.id === id)
    if (from < 0 || to < 0 || to >= groups.length || from === to) return
    const ids = groups.map(group => group.id)
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    onChange(ids)
  }
  const finishDrag = (event: PointerEvent<HTMLButtonElement>, commit: boolean) => {
    const drag = dragged.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragged.current = null
    setPreview(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (commit && drag.active && drag.target !== null && drag.order === JSON.stringify(groups.map(group => group.id))) {
      move(drag.id, drag.target)
      const button = event.currentTarget
      requestAnimationFrame(() => { if (button.isConnected) button.focus({ preventScroll: true }) })
    }
  }
  const trackDrag = (event: PointerEvent<HTMLButtonElement>, group: JournalGrouping, index: number) => {
    const drag = dragged.current, list = levels.current
    if (!drag || drag.pointerId !== event.pointerId || !list) return
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY
    if (!drag.active && Math.hypot(dx, dy) < 5) return
    drag.active = true
    const bounds = list.getBoundingClientRect()
    const inside = event.clientY >= bounds.top - 12 && event.clientY <= bounds.bottom + 12 && event.clientX >= bounds.left - 12 && event.clientX <= bounds.right + 12
    // Keep distant levels reachable when the chain is wider than the toolbar.
    if (inside) {
      if (event.clientX > bounds.right - 24) list.scrollLeft += 12
      else if (event.clientX < bounds.left + 24) list.scrollLeft -= 12
    }
    const boxes = Array.from(list.querySelectorAll<HTMLElement>('[data-group-id]')).map(chip => chip.getBoundingClientRect())
    // Drop on either half of a neighbouring chip exchanges its position with
    // the dragged level; gaps choose the nearest edge, including unequal labels.
    const distances = boxes.map(box => Math.max(box.left - event.clientX, event.clientX - box.right, 0))
    drag.target = inside ? distances.indexOf(Math.min(...distances)) : null
    setPreview({ group, level: index, left: drag.rect.left + dx, top: drag.rect.top + dy, width: drag.rect.width, height: drag.rect.height, target: drag.target })
  }
  return <div className="journal-grouping" data-dragging={Boolean(preview)} aria-label={scope === 'documents' ? 'Группировка документов' : 'Группировка загруженных строк'} title={scope === 'documents' ? 'Группируется весь отфильтрованный реестр документов. Добавить уровень — ПКМ по заголовку столбца.' : 'Группируются только загруженные строки. Добавить уровень — ПКМ по заголовку столбца.'}>
    <ListTree size={15} aria-hidden="true" className="journal-grouping-icon" />
    {groups.length ? <>
      <div ref={levels} className="journal-grouping-levels" role="list" aria-label="Порядок группировок">
        {groups.map((group, index) => <div key={group.id} role="listitem" className="journal-grouping-level">
          {index > 0 ? <ChevronRight size={13} aria-hidden="true" /> : null}
          <div className={`journal-grouping-chip journal-group-tone-${index % 4}`} data-group-id={group.id}
            data-drag-source={preview?.group.id === group.id}
            data-drop-side={preview && preview.target === index && preview.level !== index ? (preview.level > index ? 'before' : 'after') : undefined}>
            <button type="button" className="journal-grouping-handle" aria-label={`Группировка: ${group.label}`}
              title={`${index + 1}. ${group.label}. Перетащите или нажмите Alt + ← / →, чтобы изменить порядок.`}
              onPointerDown={event => {
                if (event.button !== 0 || !event.isPrimary) return
                event.preventDefault()
                event.currentTarget.focus({ preventScroll: true })
                dragged.current = { id: group.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
                  rect: event.currentTarget.parentElement!.getBoundingClientRect(), order: JSON.stringify(groups.map(item => item.id)), active: false, target: index }
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={event => trackDrag(event, group, index)}
              onPointerUp={event => finishDrag(event, true)}
              onPointerCancel={event => finishDrag(event, false)}
              onLostPointerCapture={event => finishDrag(event, false)}
              onKeyDown={event => {
                if (event.key === 'Escape' && dragged.current) {
                  event.preventDefault(); event.stopPropagation()
                  const pointerId = dragged.current.pointerId
                  dragged.current = null; setPreview(null)
                  if (event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId)
                  return
                }
                if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                  event.preventDefault(); event.stopPropagation(); move(group.id, index + (event.key === 'ArrowLeft' ? -1 : 1))
                }
              }}><GripVertical size={12} aria-hidden="true" /><span>{group.label}</span></button>
            <button type="button" className="journal-grouping-remove" aria-label={`Убрать группировку: ${group.label}`}
              onClick={() => onChange(groups.filter(item => item.id !== group.id).map(item => item.id))}><X size={13} /></button>
          </div>
        </div>)}
      </div>
      <button type="button" className="journal-grouping-clear" title="Снять все группировки" aria-label="Снять все группировки" onClick={() => onChange([])}><X size={15} aria-hidden="true" /></button>
    </> : <span className="journal-grouping-hint">Группировка — ПКМ по столбцу</span>}
    {preview ? createPortal(<div aria-hidden="true" className="journal-grouping-drag-layer">
      <div className={`journal-grouping-chip journal-grouping-drag-preview journal-group-tone-${preview.level % 4}`}
        style={{ left: preview.left, top: preview.top, width: preview.width, height: preview.height }}>
        <GripVertical size={12} /><span>{preview.group.label}</span><X size={13} />
      </div>
    </div>, document.body) : null}
  </div>
}
