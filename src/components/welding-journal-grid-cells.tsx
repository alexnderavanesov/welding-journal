import type { ICellRendererComp, ICellRendererParams } from 'ag-grid-community'
import { Edit2, MoreHorizontal, Trash2 } from 'lucide-react'
import { WeldTableBodyCell } from './weld-table-body-cell'
import { useJournalGrid, useJournalGridExtras } from './welding-journal-grid-context'
import { FIELD_BY_KEY, RESULT_FIELD_KEYS, type WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

// No React tree or business-link discovery for each plain cell entering the viewport.
// Native AG Grid manages its lifecycle; textContent keeps imported text inert.
export class JournalPlainCell implements ICellRendererComp<WeldRow> {
  private element!: HTMLDivElement
  private text!: HTMLSpanElement
  init(params: ICellRendererParams<WeldRow>) {
    this.element = document.createElement('div')
    this.element.className = 'journal-plain-cell'
    this.text = document.createElement('span')
    this.element.append(this.text)
    this.refresh(params)
  }
  getGui() { return this.element }
  refresh(params: ICellRendererParams<WeldRow>) {
    this.text.textContent = params.data ? String(params.valueFormatted ?? params.value ?? '') : ''
    return true
  }
}

export function JournalCell({ data, column, value }: ICellRendererParams<WeldRow>) {
  const { table, getActionRow, canEditCell } = useJournalGrid()
  const field = FIELD_BY_KEY.get(column?.getColId() as WeldFieldKey)
  if (!data || !field) return null
  const row = getActionRow(data)
  const ready = table.rowsReady !== false
  return <WeldTableBodyCell presentation="grid" row={row} field={field} displayValue={value}
    isEditableCell={ready && canEditCell(row, field.key)} isBlockedEditableCell={false}
    isHighlightedRow={false} isSelectedRow={false} hasDispatcherTask={false} isHighlightedCell={false}
    isResultField={RESULT_FIELD_KEYS.has(field.key)} stickyLeft={0} stickyIdentityLeadingWidth={0}
    stickyIdentityColumns={false} stickyBackgroundClassName="" isSectionEnd={false}
    onEdit={ready ? table.onEdit : undefined} onOpenDocument={ready ? table.onOpenDocument : undefined}
    onOpenLnkRequest={ready ? table.onOpenLnkRequest : undefined} onOpenLnkResult={ready ? table.onOpenLnkResult : undefined}
    onOpenJoint={ready ? table.onOpenJoint : undefined} onOpenJointOverview={ready ? table.onOpenJointOverview : undefined}
    controlBasisEditorEnabled={table.controlBasisEditorEnabled} />
}

export function JournalActions({ data }: ICellRendererParams<WeldRow>) {
  const { table, getActionRow, openMenu } = useJournalGrid()
  if (!data) return null
  const row = getActionRow(data)
  return <div className="flex h-full items-center justify-center gap-1">
    <button type="button" className="journal-icon-button" title="Редактировать" aria-label="Редактировать" disabled={table.rowsReady === false || !table.onEdit} onClick={() => table.onEdit?.(row)}><Edit2 size={14} /></button>
    <button type="button" className="journal-icon-button" title="Удалить" aria-label="Удалить" disabled={table.rowsReady === false || !table.onDelete} onClick={() => table.onDelete?.(row.id)}><Trash2 size={14} /></button>
    <button type="button" className="journal-icon-button" title="Действия со стыком" aria-label="Действия со стыком" disabled={table.rowsReady === false} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); openMenu(row, { x: rect.left, y: rect.bottom, anchorElement: event.currentTarget }) }}><MoreHorizontal size={16} /></button>
  </div>
}

export function JournalExtraCell({ data, column }: ICellRendererParams<WeldRow>) {
  const { table, getActionRow } = useJournalGridExtras()
  const extra = table.extraColumns?.find(item => item.key === column?.getColId())
  return data && extra ? <div inert={table.rowsReady === false} className={`journal-grid-extra h-full ${table.rowsReady === false ? 'opacity-50' : ''}`}>{extra.renderCell(getActionRow(data))}</div> : null
}
