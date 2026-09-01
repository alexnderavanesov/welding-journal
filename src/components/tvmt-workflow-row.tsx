import { memo, type MouseEvent } from 'react'

import { DialogRowMenuButton } from '@/components/dialog-row-menu-button'
import { RequestRowJointHeading } from '@/components/request-row-joint-heading'
import { WorkflowResultOptionPicker } from '@/components/workflow-result-option-picker'
import { formatDisplayDate } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getPrimaryPstoStartStatusLabel } from '@/lib/lnk-control-stage'
import {
  getCurrentPstoCycle,
  getPstoTvmtWorkflowLabel,
  getPstoTvmtWorkflowState,
  TVMT_RESULT_OPTIONS,
} from '@/lib/tvmt-cycle'

export type TvmtWorkflowRowMode = 'request' | 'result'

type TvmtWorkflowRowProps = {
  row: WeldRow
  mode: TvmtWorkflowRowMode
  selected: boolean
  disabled: boolean
  disabledReason: string
  rowResult: string
  onToggle: (rowId: number) => void
  onResultChange: (rowId: number, result: string) => void
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, row: WeldRow) => void
}

function TvmtWorkflowRowComponent({
  row,
  mode,
  selected,
  disabled,
  disabledReason,
  rowResult,
  onToggle,
  onResultChange,
  onOpenContextMenu,
}: TvmtWorkflowRowProps) {
  const currentCycle = getCurrentPstoCycle(row)
  const requestName = String(currentCycle?.tvmtRequest ?? '').trim()
  const pstoDate = String(currentCycle?.pstoDate ?? '').trim()
  const workflowState = getPstoTvmtWorkflowState(row)
  const workflowLabel = workflowState === 'waiting-psto-request'
    ? getPrimaryPstoStartStatusLabel(row) || getPstoTvmtWorkflowLabel(workflowState)
    : getPstoTvmtWorkflowLabel(workflowState)

  return (
    <div
      onClick={() => {
        if (!disabled) onToggle(row.id)
      }}
      onContextMenu={(event) => onOpenContextMenu(event, row)}
      className={`group/dialog-row grid min-h-[82px] items-center gap-3 px-3 py-2 text-sm transition-colors ${
        mode === 'result'
          ? 'grid-cols-[28px_minmax(360px,0.85fr)_minmax(300px,1.15fr)_180px_32px]'
          : 'grid-cols-[28px_minmax(360px,0.9fr)_minmax(300px,1.1fr)_32px]'
      } ${
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

      <span className="grid min-w-0 grid-cols-[52px_78px_minmax(0,1fr)] items-center gap-2">
        <span className="justify-self-start rounded border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-800">
          ТВМТ
        </span>
        {currentCycle ? (
          <span className={`justify-self-start whitespace-nowrap rounded border px-2 py-1 text-xs font-semibold ${
            currentCycle.sequence >= 2
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-cyan-200 bg-cyan-50 text-cyan-800'
          }`}>
            Цикл {currentCycle.sequence}
          </span>
        ) : <span aria-hidden="true" />}
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">
            {workflowLabel}
          </span>
          {pstoDate ? (
            <span className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500">
              ПСТО: {formatDisplayDate(pstoDate)}
            </span>
          ) : null}
          {requestName ? (
            <span className="min-w-0 max-w-full break-words rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800">
              {requestName}
            </span>
          ) : null}
          {disabled ? (
            <span className="max-w-full break-words rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
              {disabledReason}
            </span>
          ) : null}
        </span>
      </span>

      {mode === 'result' ? (
        <span className="min-w-0" onClick={(event) => event.stopPropagation()}>
          {selected ? (
            <WorkflowResultOptionPicker
              value={rowResult}
              options={TVMT_RESULT_OPTIONS}
              compact
              onChange={(result) => onResultChange(row.id, result)}
            />
          ) : (
            <span aria-hidden="true" className="block h-11" />
          )}
        </span>
      ) : null}

      <DialogRowMenuButton
        label={`Действия: стык ${String(row.joint ?? row.line ?? row.id)}`}
        onOpen={(event) => onOpenContextMenu(event, row)}
      />
    </div>
  )
}

export const TvmtWorkflowRow = memo(TvmtWorkflowRowComponent, (previous, next) => (
  previous.row === next.row &&
  previous.mode === next.mode &&
  previous.selected === next.selected &&
  previous.disabled === next.disabled &&
  previous.disabledReason === next.disabledReason &&
  previous.rowResult === next.rowResult &&
  previous.onOpenContextMenu === next.onOpenContextMenu
))
