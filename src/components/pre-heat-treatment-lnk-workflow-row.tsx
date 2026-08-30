import { memo, type MouseEvent } from 'react'

import { DialogRowMenuButton } from '@/components/dialog-row-menu-button'
import { LNK_RESULT_ROW_GRID_CLASS } from '@/components/lnk-dialog-layout'
import { LnkResultRowResultPicker } from '@/components/lnk-result-row-result-picker'
import { RequestRowJointHeading } from '@/components/request-row-joint-heading'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getPreHeatTreatmentControl,
  PRE_HEAT_TREATMENT_LNK_METHODS,
  type PreHeatTreatmentLnkMethodCode,
} from '@/lib/lnk-control-stage'
import type { SaveCheckSettings } from '@/lib/save-check-settings'

export type PreHeatTreatmentLnkWorkflowRowMode = 'request' | 'result'

type PreHeatTreatmentLnkWorkflowRowProps = {
  row: WeldRow
  mode: PreHeatTreatmentLnkWorkflowRowMode
  selectedMethods: ReadonlySet<PreHeatTreatmentLnkMethodCode>
  resultMethod: PreHeatTreatmentLnkMethodCode | ''
  selected: boolean
  disabledReason: string
  rowResult: string
  saveCheckSettings: SaveCheckSettings
  onToggle: (rowId: number) => void
  onResultChange: (rowId: number, result: string) => void
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, row: WeldRow) => void
}

function PreHeatTreatmentLnkWorkflowRowComponent({
  row,
  mode,
  selectedMethods,
  resultMethod,
  selected,
  disabledReason,
  rowResult,
  saveCheckSettings,
  onToggle,
  onResultChange,
  onOpenContextMenu,
}: PreHeatTreatmentLnkWorkflowRowProps) {
  const disabled = Boolean(disabledReason)
  const visibleMethods = mode === 'result'
    ? PRE_HEAT_TREATMENT_LNK_METHODS.filter((method) => method.code === resultMethod)
    : PRE_HEAT_TREATMENT_LNK_METHODS.filter((method) => selectedMethods.has(method.code))

  if (mode === 'request') {
    return (
      <div
        onClick={() => {
          if (!disabled) onToggle(row.id)
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
          checked={selected && !disabled}
          onClick={(event) => event.stopPropagation()}
          onChange={() => onToggle(row.id)}
          disabled={disabled}
          className="h-4 w-4 rounded border-slate-300 text-slate-900"
        />
        <span className="min-w-0">
          <RequestRowJointHeading row={row} />
        </span>
        <span className="flex max-w-[28rem] flex-wrap justify-end gap-1.5">
          {disabled ? (
            <span className="max-w-[28rem] rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
              {disabledReason}
            </span>
          ) : visibleMethods.length > 0 ? visibleMethods.map((method) => {
            const control = getPreHeatTreatmentControl(row, method.code)
            const requestName = String(control?.requestName ?? '').trim()
            return (
              <span
                key={method.code}
                className={`inline-flex max-w-full items-center gap-1 rounded border px-2 py-1 text-xs font-medium ${
                  selected
                    ? 'border-sky-300 bg-sky-100 text-sky-900'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
                title={requestName || undefined}
              >
                <strong>{method.code}</strong>
                {requestName ? <span className="max-w-52 truncate text-sky-700">{requestName}</span> : null}
              </span>
            )
          }) : (
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
              Выберите вид контроля
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

  return (
    <div
      onClick={() => {
        if (!disabled) onToggle(row.id)
      }}
      onContextMenu={(event) => onOpenContextMenu(event, row)}
      className={`group/dialog-row grid min-h-[92px] ${LNK_RESULT_ROW_GRID_CLASS} items-center gap-3 px-3 py-2 text-sm transition-colors ${
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
        checked={selected && !disabled}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggle(row.id)}
        disabled={disabled}
        className="h-4 w-4 rounded border-slate-300 text-slate-900"
      />
      <span className="min-w-0">
        <RequestRowJointHeading row={row} stackMetadata />
      </span>
      <span className="flex min-w-0 flex-wrap content-center gap-1.5">
        {visibleMethods.length > 0 ? visibleMethods.map((method) => {
          const control = getPreHeatTreatmentControl(row, method.code)
          const result = String(control?.result ?? '').trim()
          const hasRequest = Boolean(String(control?.requestName ?? '').trim())
          return (
            <span
              key={method.code}
              className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium ${
                result === 'годен'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : result === 'ремонт' || result === 'вырез'
                    ? 'border-rose-200 bg-rose-50 text-rose-800'
                    : hasRequest
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-sky-200 bg-sky-50 text-sky-800'
              }`}
            >
              <strong>{method.code}</strong>
              <span>{result || (hasRequest ? 'ожидает НК' : 'до ТО')}</span>
            </span>
          )
        }) : (
          <span className="text-xs text-slate-500">Выберите вид контроля.</span>
        )}
      </span>
      <span className="min-w-0" onClick={(event) => event.stopPropagation()}>
        {selected ? (
          <LnkResultRowResultPicker
            row={row}
            rowResult={rowResult}
            saveCheckSettings={saveCheckSettings}
            compact
            onSetRowResult={onResultChange}
          />
        ) : disabled ? (
          <span className="block text-xs leading-4 text-amber-700">{disabledReason}</span>
        ) : (
          <span className="block text-xs leading-4 text-slate-500">
            Можно внести результат.
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

export const PreHeatTreatmentLnkWorkflowRow = memo(
  PreHeatTreatmentLnkWorkflowRowComponent,
  (previous, next) => (
    previous.row === next.row &&
    previous.mode === next.mode &&
    previous.selectedMethods === next.selectedMethods &&
    previous.resultMethod === next.resultMethod &&
    previous.selected === next.selected &&
    previous.disabledReason === next.disabledReason &&
    previous.rowResult === next.rowResult &&
    previous.saveCheckSettings === next.saveCheckSettings &&
    previous.onToggle === next.onToggle &&
    previous.onResultChange === next.onResultChange &&
    previous.onOpenContextMenu === next.onOpenContextMenu
  ),
)
