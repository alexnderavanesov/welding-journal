import { memo, type MouseEvent } from 'react'
import { DialogRowMenuButton } from '@/components/dialog-row-menu-button'
import { RequestRowJointHeading } from '@/components/request-row-joint-heading'
import { getAvailableLnkRequestMethods } from '@/lib/lnk-status'
import { getLnkRowRequestMethods } from '@/lib/report-modal-rows'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

type LnkRequestRowProps = {
  row: WeldRow
  selected: boolean
  selectedMethods: ReadonlySet<WeldFieldKey>
  onToggleRow: (rowId: number) => void
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, row: WeldRow) => void
}

function LnkRequestRowComponent({ row, selected, selectedMethods, onToggleRow, onOpenContextMenu }: LnkRequestRowProps) {
  const availableMethods = getAvailableLnkRequestMethods(row)
  const existingMethods = getLnkRowRequestMethods(row, '')
  const disabled = availableMethods.length === 0

  return (
    <div
      onClick={() => {
        if (!disabled) onToggleRow(row.id)
      }}
      onContextMenu={(event) => onOpenContextMenu(event, row)}
      className={`group/dialog-row grid grid-cols-[28px_minmax(0,1fr)_auto_32px] items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
        disabled
          ? 'cursor-not-allowed bg-slate-100 text-slate-400'
          : selected
            ? 'cursor-pointer bg-sky-50/70 shadow-[inset_3px_0_0_#38bdf8]'
            : 'cursor-pointer bg-white hover:bg-slate-50'
      }`}
    >
      <input
        type="checkbox"
        aria-label={`Выбрать стык ${String(row.line ?? '').trim()} ${String(row.joint ?? row.id).trim()}`.trim()}
        checked={selected}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggleRow(row.id)}
        disabled={disabled}
        className="h-4 w-4 rounded border-slate-300 text-slate-900"
      />
      <span className="min-w-0">
        <RequestRowJointHeading row={row} />
      </span>
      <span className="flex max-w-[28rem] flex-wrap justify-end gap-1.5">
        {availableMethods.length > 0 ? (
          availableMethods.map((method) => {
            const isSelectedMethod = selected && selectedMethods.has(method.requestKey)
            return (
              <span
                key={method.requestKey}
                className={`rounded border px-2 py-1 text-xs font-medium ${
                  isSelectedMethod
                    ? 'border-sky-300 bg-sky-100 text-sky-900'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                {method.code}
              </span>
            )
          })
        ) : (
          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
            Все заявки уже созданы
          </span>
        )}
        {existingMethods.map((method) => (
          <span
            key={`${method.requestKey}-existing`}
            className="inline-flex max-w-full flex-wrap items-center gap-1 overflow-visible rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800"
            title={`${method.code}: ${String(row[method.requestKey] ?? '')}`}
          >
            <span>{method.code}</span>
            <span className="overflow-visible break-all whitespace-normal text-sky-600 [text-overflow:clip]">
              {String(row[method.requestKey] ?? '')}
            </span>
          </span>
        ))}
      </span>
      <DialogRowMenuButton
        label={`Действия: стык ${String(row.joint ?? row.line ?? row.id)}`}
        onOpen={(event) => onOpenContextMenu(event, row)}
      />
    </div>
  )
}

export const LnkRequestRow = memo(LnkRequestRowComponent, (previous, next) => {
  if (
    previous.row !== next.row ||
    previous.selected !== next.selected ||
    previous.onOpenContextMenu !== next.onOpenContextMenu
  ) return false
  if (!next.selected) return true
  return areSetsEqual(previous.selectedMethods, next.selectedMethods)
})

function areSetsEqual(left: ReadonlySet<WeldFieldKey>, right: ReadonlySet<WeldFieldKey>) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}
