import {
  JointProjectSubtitleMeta,
  JointSpoolDiameterMeta,
  JointTitleLine,
  JointWeldDateMeta,
  MetaSeparator,
} from '@/components/joint-meta'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getEffectiveLnkResultDraftValueForRow } from '@/lib/lnk-result-draft'
import { getLnkRepairForbiddenReason, isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import {
  formatLnkResultSummaryItems,
  getLnkMethodByRequestKey,
  getLnkRequestMethodBadgeClass,
  isLnkMethodNoNeed,
} from '@/lib/lnk-status'
import {
  canSelectLnkResultRow,
  getLnkRowRequestMethods,
  getLnkRowRequestNames,
} from '@/lib/report-modal-rows'
import { getInactiveLnkRequestBadgeClass, getLnkResultBadgeClass } from '@/lib/report-badges'
import { LNK_RESULT_OPTIONS } from '@/lib/report-config'
import type { LnkResultDraftState } from '@/lib/report-draft-state'

type LnkResultRowProps = {
  row: WeldRow
  draft: LnkResultDraftState
  onToggleRow: (rowId: number) => void
  onSetRowResult: (rowId: number, result: string) => void
}

export function LnkResultRow({ row, draft, onToggleRow, onSetRowResult }: LnkResultRowProps) {
  const method = getLnkMethodByRequestKey(draft.methodKey)
  const disabled = !canSelectLnkResultRow(row, draft.requestName, draft.methodKey)
  const selected = draft.rowIds.has(row.id) && !disabled
  const rowRequestNames = getLnkRowRequestNames(row)
  const rowResult = getEffectiveLnkResultDraftValueForRow(row, draft)
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
        <JointTitleLine row={row} truncate />
        <span className="block text-xs leading-5 text-slate-500">
          <JointProjectSubtitleMeta row={row} />
        </span>
        <span className="block text-xs leading-5 text-slate-500">
          <JointSpoolDiameterMeta row={row} />
          <MetaSeparator />
          <JointWeldDateMeta row={row} />
        </span>
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
              : !draft.methodKey
                ? 'Выберите метод контроля, чтобы отметить стык.'
                : hasSavedFinalResult
                  ? 'Результат уже внесен. Используйте «Редактировать результаты».'
                  : draft.requestName
                    ? 'Для выбранных заявки и метода этот стык не подходит.'
                    : 'На выбранный метод по этому стыку нет заявки ЛНК.'}
          </span>
        ) : null}
        {selected ? (
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-slate-500">Результат:</span>
            {LNK_RESULT_OPTIONS.map((option) => {
              const active = rowResult === option
              const disabledByRepairRule = option === 'ремонт' && isLnkRepairForbidden(row)
              return (
                <button
                  key={option}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (disabledByRepairRule) return
                    onSetRowResult(row.id, option)
                  }}
                  disabled={disabledByRepairRule}
                  title={disabledByRepairRule ? getLnkRepairForbiddenReason(row) : undefined}
                  className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                    disabledByRepairRule
                      ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                      : active
                        ? getLnkResultBadgeClass(option)
                        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {option}
                </button>
              )
            })}
          </span>
        ) : null}
      </span>
      <span className="flex flex-wrap content-start gap-1.5">
        {rowRequestNames.length === 0 ? (
          <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
            Нет заявки
          </span>
        ) : (
          getLnkRowRequestMethods(row, draft.requestName).map((availableMethod) => {
            const requestName = String(row[availableMethod.requestKey] ?? '').trim()
            const conclusionName = String(row[availableMethod.conclusionKey] ?? '').trim()
            const hasNoNeed = isLnkMethodNoNeed(row, availableMethod)
            const isSelectedMethod = availableMethod.requestKey === draft.methodKey
            const isSelectedRowMethod = selected && isSelectedMethod
            return (
              <span
                key={availableMethod.requestKey}
                className={`inline-flex max-w-full flex-col gap-0.5 rounded border px-2 py-1 text-xs font-medium ${
                  isSelectedRowMethod
                    ? 'border-sky-200 bg-sky-50 text-sky-900'
                    : getLnkRequestMethodBadgeClass(row, availableMethod)
                }`}
              >
                <span
                  className={`flex max-w-full items-center gap-1.5 whitespace-normal break-words ${
                    isSelectedRowMethod ? 'text-sky-700' : 'text-slate-500'
                  }`}
                >
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-bold leading-none ${
                      isSelectedRowMethod
                        ? 'bg-sky-100 text-sky-900'
                        : 'border border-slate-200 bg-slate-100 text-slate-700'
                    }`}
                  >
                    {availableMethod.code}
                  </span>
                  <span className="min-w-0 overflow-visible break-all whitespace-normal [text-overflow:clip]">
                    {hasNoNeed ? 'нет потребности' : requestName}
                  </span>
                </span>
                {conclusionName && !hasNoNeed ? (
                  <span className="max-w-full overflow-visible break-all whitespace-normal [text-overflow:clip]">
                    {conclusionName}
                  </span>
                ) : null}
              </span>
            )
          })
        )}
      </span>
    </div>
  )
}
