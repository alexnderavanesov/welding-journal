import { memo, type MouseEvent } from 'react'

import { DialogRowMenuButton } from '@/components/dialog-row-menu-button'
import { ResultRowJointHeading } from '@/components/result-row-joint-heading'
import { PstoJointStatusBadge, PstoResultStatusBadge } from '@/components/psto-status-badges'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getPstoResultBadgeClass } from '@/lib/report-badges'

type PstoResultRowProps = {
  row: WeldRow
  selected: boolean
  disabled: boolean
  onToggle: (rowId: number) => void
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, row: WeldRow) => void
}

function PstoResultRowComponent({ row, selected, disabled, onToggle, onOpenContextMenu }: PstoResultRowProps) {
  const requestName = String(row.pstoRequest ?? '').trim()
  const diagramName = String(row.heatTreatmentDiagram ?? '').trim()

  return (
    <div
      onClick={() => {
        if (!disabled) onToggle(row.id)
      }}
      onContextMenu={(event) => onOpenContextMenu(event, row)}
      className={`group/dialog-row grid min-h-[92px] grid-cols-[28px_minmax(360px,1.05fr)_minmax(320px,0.95fr)_32px] items-center gap-3 px-3 py-2 text-sm transition-colors ${
        disabled
          ? 'cursor-not-allowed bg-slate-100 text-slate-400'
          : selected
            ? 'cursor-pointer bg-emerald-50/80'
            : 'cursor-pointer bg-white hover:bg-slate-50'
      }`}
    >
      <input
        type="checkbox"
        aria-label={`Выбрать стык ${String(row.line ?? '').trim()} ${String(row.joint ?? row.id).trim()}`.trim()}
        checked={selected}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggle(row.id)}
        disabled={disabled}
        className="h-4 w-4 rounded border-slate-300 text-slate-900"
      />
      <span className="min-w-0">
        <ResultRowJointHeading row={row} />
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <PstoJointStatusBadge row={row} />
          <PstoResultStatusBadge row={row} />
        </span>
        {disabled ? (
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            {requestName ? 'Выберите эту заявку ПСТО, чтобы отметить стык.' : 'На этот стык еще нет заявки ПСТО.'}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-wrap content-center gap-1.5 py-0.5">
        {requestName ? (
          <span className={`inline-flex min-w-0 max-w-full flex-col gap-0.5 rounded border px-2 py-1 text-xs font-medium leading-4 ${getPstoResultBadgeClass(row.pstoResult)}`}>
            <span className="flex min-w-0 max-w-full items-start gap-1.5 whitespace-normal text-slate-500">
              <span className="shrink-0 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold leading-none text-slate-700">
                ПСТО
              </span>
              <span className="min-w-0 break-words whitespace-normal">{requestName}</span>
            </span>
            {diagramName ? (
              <span className="min-w-0 max-w-full break-words whitespace-normal text-slate-700">
                {diagramName}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">Нет заявки</span>
        )}
      </span>
      <DialogRowMenuButton
        label={`Действия: стык ${String(row.joint ?? row.line ?? row.id)}`}
        onOpen={(event) => onOpenContextMenu(event, row)}
      />
    </div>
  )
}

export const PstoResultRow = memo(PstoResultRowComponent, (previous, next) => (
  previous.row === next.row &&
  previous.selected === next.selected &&
  previous.disabled === next.disabled &&
  previous.onOpenContextMenu === next.onOpenContextMenu
))
