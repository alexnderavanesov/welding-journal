import { memo } from 'react'
import { LnkResultRowRequestBadges } from '@/components/lnk-result-row-request-badges'
import { LnkResultRowResultPicker } from '@/components/lnk-result-row-result-picker'
import { ResultRowJointHeading } from '@/components/result-row-joint-heading'
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
      className={`grid grid-cols-[28px_minmax(220px,1fr)_minmax(180px,0.8fr)] gap-3 px-4 py-3 text-sm transition-colors ${
        disabled
          ? 'cursor-not-allowed bg-slate-100 text-slate-400'
          : selected
            ? 'cursor-pointer bg-emerald-50/80'
            : 'cursor-pointer bg-white hover:bg-slate-50'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggleRow(row.id)}
        disabled={disabled}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900"
      />
      <span className="min-w-0">
        <ResultRowJointHeading row={row} />
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
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
        {disabled ? (
          <span className="block truncate text-xs text-amber-700">
            {rowRequestNames.length === 0
              ? 'На этот стык еще нет заявки ЛНК.'
              : !methodKey
                ? 'Выберите метод контроля, чтобы отметить стык.'
                : hasSavedFinalResult
                  ? 'Результат уже внесен. Используйте «Все результаты».'
                  : requestName
                    ? 'Для выбранных заявки и метода этот стык не подходит.'
                    : 'На выбранный метод по этому стыку нет заявки ЛНК.'}
          </span>
        ) : null}
        {selected ? (
          <LnkResultRowResultPicker
            row={row}
            rowResult={rowResult}
            saveCheckSettings={saveCheckSettings}
            onSetRowResult={onSetRowResult}
          />
        ) : null}
      </span>
      <span className="flex flex-wrap content-start gap-1.5">
        <LnkResultRowRequestBadges
          row={row}
          requestName={requestName}
          requestDate={requestDate}
          methodKey={methodKey}
          selected={selected}
          rowRequestNames={rowRequestNames}
        />
      </span>
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
    previous.saveCheckSettings !== next.saveCheckSettings
  ) return false
  if (next.selected && previous.rowResult !== next.rowResult) return false
  return true
})
