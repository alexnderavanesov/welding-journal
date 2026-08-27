import { memo, type MouseEvent } from 'react'
import { DialogRowMenuButton } from '@/components/dialog-row-menu-button'
import { LnkResultRowRequestBadges } from '@/components/lnk-result-row-request-badges'
import { LnkResultRowResultPicker } from '@/components/lnk-result-row-result-picker'
import { RequestRowJointHeading } from '@/components/request-row-joint-heading'
import type { WeldRow } from '@/lib/dispatcher-types'
import { isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import {
  formatLnkResultSummaryItems,
  getLnkMethodByRequestKey,
} from '@/lib/lnk-status'
import {
  canSelectLnkResultRow,
  getLnkRowRequestNames,
} from '@/lib/report-modal-rows'
import { getInactiveLnkRequestBadgeClass, getLnkResultBadgeClass } from '@/lib/report-badges'
import { LNK_RESULT_OPTIONS } from '@/lib/report-config'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldFieldKey } from '@/lib/weld-fields'

type LnkResultRowProps = {
  row: WeldRow
  requestName: string
  requestDate: string
  methodKey: WeldFieldKey | ''
  selected: boolean
  rowResult: string
  saveCheckSettings: SaveCheckSettings
  onToggleRow: (rowId: number) => void
  onSetRowResult: (rowId: number, result: string) => void
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, row: WeldRow) => void
}

function LnkResultRowComponent({
  row,
  requestName,
  requestDate,
  methodKey,
  selected: selectedById,
  rowResult: draftRowResult,
  saveCheckSettings,
  onToggleRow,
  onSetRowResult,
  onOpenContextMenu,
}: LnkResultRowProps) {
  const method = getLnkMethodByRequestKey(methodKey)
  const disabled = !canSelectLnkResultRow(row, requestName, methodKey, requestDate)
  const selected = selectedById && !disabled
  const rowRequestNames = getLnkRowRequestNames(row)
  const rowResult = saveCheckSettings.lnkResultRepairRules && draftRowResult === 'ремонт' && isLnkRepairForbidden(row)
    ? ''
    : draftRowResult
  const hasSavedFinalResult = Boolean(
    method && LNK_RESULT_OPTIONS.includes(String(row[method.resultKey] ?? '').trim().toLowerCase() as never),
  )

  return (
    <div
      onClick={() => {
        if (!disabled) onToggleRow(row.id)
      }}
      onContextMenu={(event) => onOpenContextMenu(event, row)}
      className={`group/dialog-row grid min-h-[92px] grid-cols-[28px_minmax(360px,1.05fr)_minmax(320px,0.95fr)_220px_32px] items-center gap-3 px-3 py-2 text-sm transition-colors ${
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
        onChange={() => onToggleRow(row.id)}
        disabled={disabled}
        className="h-4 w-4 rounded border-slate-300 text-slate-900"
      />
      <span className="min-w-0">
        <RequestRowJointHeading row={row} stackMetadata />
        <span className="mt-1 flex min-h-5 flex-wrap items-center gap-1 text-xs text-slate-600">
          {formatLnkResultSummaryItems(row).map((item) => (
            <span
              key={item.method}
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium ${
                item.inactive ? getInactiveLnkRequestBadgeClass() : getLnkResultBadgeClass(item.result)
              }`}
            >
              <span className="font-bold">{item.method}</span>
              <span>{item.result}</span>
            </span>
          ))}
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap content-center gap-1.5 py-0.5">
        <LnkResultRowRequestBadges
          row={row}
          requestName={requestName}
          requestDate={requestDate}
          methodKey={methodKey}
          selected={selected}
          rowRequestNames={rowRequestNames}
        />
      </span>
      <span className="min-w-0">
        {selected ? (
          <LnkResultRowResultPicker
            row={row}
            rowResult={rowResult}
            saveCheckSettings={saveCheckSettings}
            compact
            onSetRowResult={onSetRowResult}
          />
        ) : disabled ? (
          <span className="block text-xs leading-4 text-amber-700">
            {rowRequestNames.length === 0
              ? 'Нет заявки ЛНК.'
              : !methodKey
                ? 'Выберите метод контроля.'
                : hasSavedFinalResult
                  ? 'Результат уже внесен.'
                  : requestName
                    ? 'Не подходит для заявки.'
                    : 'Нет заявки на этот метод.'}
          </span>
        ) : (
          <span aria-hidden="true" className="block h-11" />
        )}
      </span>
      <DialogRowMenuButton
        label={`Действия: стык ${String(row.joint ?? row.line ?? row.id)}`}
        onOpen={(event) => onOpenContextMenu(event, row)}
      />
    </div>
  )
}

export const LnkResultRow = memo(LnkResultRowComponent, (previous, next) => {
  if (
    previous.row !== next.row ||
    previous.requestName !== next.requestName ||
    previous.requestDate !== next.requestDate ||
    previous.methodKey !== next.methodKey ||
    previous.selected !== next.selected ||
    previous.saveCheckSettings !== next.saveCheckSettings ||
    previous.onOpenContextMenu !== next.onOpenContextMenu
  ) return false
  if (next.selected && previous.rowResult !== next.rowResult) return false
  return true
})
