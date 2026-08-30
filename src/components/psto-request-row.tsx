import { memo, type MouseEvent } from 'react'

import { DialogRowMenuButton } from '@/components/dialog-row-menu-button'
import { RequestRowJointHeading } from '@/components/request-row-joint-heading'
import { PstoJointStatusBadge, PstoResultStatusBadge } from '@/components/psto-status-badges'
import type { WeldRow } from '@/lib/dispatcher-types'

type PstoRequestRowProps = {
  row: WeldRow
  selected: boolean
  disabled: boolean
  disabledReason: string
  onToggleRow: (rowId: number) => void
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, row: WeldRow) => void
}

function PstoRequestRowComponent({ row, selected, disabled, disabledReason, onToggleRow, onOpenContextMenu }: PstoRequestRowProps) {
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
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <PstoJointStatusBadge row={row} />
          <PstoResultStatusBadge row={row} />
        </span>
      </span>
      <span className="flex max-w-[28rem] flex-wrap justify-end gap-1.5">
        {disabled ? (
          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
            {disabledReason || 'Заявка ПСТО недоступна'}
          </span>
        ) : (
          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">
            ПСТО
          </span>
        )}
      </span>
      <DialogRowMenuButton
        label={`Действия: стык ${String(row.joint ?? row.line ?? row.id)}`}
        onOpen={(event) => onOpenContextMenu(event, row)}
      />
    </div>
  )
}

export const PstoRequestRow = memo(PstoRequestRowComponent, (previous, next) => (
  previous.row === next.row &&
  previous.selected === next.selected &&
  previous.disabled === next.disabled &&
  previous.disabledReason === next.disabledReason &&
  previous.onOpenContextMenu === next.onOpenContextMenu
))
