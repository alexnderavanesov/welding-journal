import { memo, type MouseEvent } from 'react'

import { DialogRowMenuButton } from '@/components/dialog-row-menu-button'
import { RequestRowJointHeading } from '@/components/request-row-joint-heading'
import { formatDisplayDate } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getPrimaryPstoStartStatusLabel } from '@/lib/lnk-control-stage'
import {
  getPstoWorkflowRequestBlockReason,
  getPstoWorkflowResultBlockReason,
} from '@/lib/psto-status'
import {
  getCurrentPstoCycle,
  getPstoWorkflowCycleSequence,
  getPstoTvmtWorkflowLabel,
  getPstoTvmtWorkflowState,
} from '@/lib/tvmt-cycle'

export type PstoRepeatWorkflowRowMode = 'request' | 'result'

type PstoRepeatWorkflowRowProps = {
  row: WeldRow
  mode: PstoRepeatWorkflowRowMode
  selected: boolean
  disabled: boolean
  onToggle: (rowId: number) => void
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, row: WeldRow) => void
}

function PstoRepeatWorkflowRowComponent({
  row,
  mode,
  selected,
  disabled,
  onToggle,
  onOpenContextMenu,
}: PstoRepeatWorkflowRowProps) {
  const currentCycle = getCurrentPstoCycle(row)
  const sequence = getPstoWorkflowCycleSequence(
    row,
    mode === 'request' ? 'pstoRequest' : 'pstoResult',
  )
  const requestName = mode === 'result' ? String(currentCycle?.pstoRequest ?? '').trim() : ''
  const previousTvmtDate = mode === 'request'
    ? String(currentCycle?.tvmtConclusionDate ?? '').trim()
    : ''
  const workflowState = getPstoTvmtWorkflowState(row)
  const workflowBlockReason = mode === 'request'
    ? getPstoWorkflowRequestBlockReason(row)
    : getPstoWorkflowResultBlockReason(row)
  const disabledReason = `Недоступно: ${workflowBlockReason || (
    workflowState === 'waiting-psto-request'
      ? getPrimaryPstoStartStatusLabel(row) || getPstoTvmtWorkflowLabel(workflowState)
      : getPstoTvmtWorkflowLabel(workflowState)
  )}`
  const showCycle = workflowState !== 'not-required'

  return (
    <div
      onClick={() => { if (!disabled) onToggle(row.id) }}
      onContextMenu={(event) => onOpenContextMenu(event, row)}
      className={`group/dialog-row grid min-h-[82px] grid-cols-[28px_minmax(360px,0.9fr)_minmax(320px,1.1fr)_32px] items-center gap-3 px-3 py-2 text-sm transition-colors ${
        disabled
          ? 'cursor-not-allowed bg-slate-100 text-slate-400'
          : selected
            ? 'cursor-pointer bg-emerald-50/80 shadow-[inset_3px_0_0_#34d399]'
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
        <RequestRowJointHeading row={row} stackMetadata />
      </span>

      <span className="grid min-w-0 grid-cols-[78px_minmax(0,1fr)] items-center gap-2">
        {showCycle ? (
          <span className="justify-self-start whitespace-nowrap rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
            Цикл {sequence}
          </span>
        ) : <span aria-hidden="true" />}
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {mode === 'request' && !disabled && sequence >= 2 ? (
            <span className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
              ТВМТ не годен{previousTvmtDate ? ` · ${formatDisplayDate(previousTvmtDate)}` : ''}
            </span>
          ) : null}
          {disabled ? (
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
              {disabledReason}
            </span>
          ) : null}
          {requestName ? (
            <span className="min-w-0 max-w-full break-words rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800">
              {requestName}
            </span>
          ) : null}
        </span>
      </span>

      <DialogRowMenuButton
        label={`Действия: стык ${String(row.joint ?? row.line ?? row.id)}`}
        onOpen={(event) => onOpenContextMenu(event, row)}
      />
    </div>
  )
}

export const PstoRepeatWorkflowRow = memo(PstoRepeatWorkflowRowComponent, (previous, next) => (
  previous.row === next.row &&
  previous.mode === next.mode &&
  previous.selected === next.selected &&
  previous.disabled === next.disabled &&
  previous.onOpenContextMenu === next.onOpenContextMenu
))
