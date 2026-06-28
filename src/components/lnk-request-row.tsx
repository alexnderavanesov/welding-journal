import {
  JointProjectSubtitleMeta,
  JointSpoolDiameterMeta,
  JointTitleLine,
  JointWeldDateMeta,
  MetaSeparator,
} from '@/components/joint-meta'
import { getAvailableLnkRequestMethods } from '@/lib/lnk-status'
import { getLnkRowRequestMethods } from '@/lib/report-modal-rows'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

type LnkRequestRowProps = {
  row: WeldRow
  selected: boolean
  selectedMethods: ReadonlySet<WeldFieldKey>
  onToggleRow: (rowId: number) => void
}

export function LnkRequestRow({ row, selected, selectedMethods, onToggleRow }: LnkRequestRowProps) {
  const availableMethods = getAvailableLnkRequestMethods(row)
  const existingMethods = getLnkRowRequestMethods(row, '')
  const disabled = availableMethods.length === 0

  return (
    <label
      className={`grid grid-cols-[28px_minmax(180px,1fr)_minmax(220px,1.4fr)] items-center gap-3 px-4 py-3 text-sm transition-colors ${
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
        onChange={() => onToggleRow(row.id)}
        disabled={disabled}
        className="h-4 w-4 rounded border-slate-300 text-slate-900"
      />
      <span className="min-w-0">
        <JointTitleLine row={row} truncate />
        <span className="block text-xs leading-5 text-slate-500">
          <JointProjectSubtitleMeta row={row} />
          <MetaSeparator />
          <JointSpoolDiameterMeta row={row} />
          <MetaSeparator />
          <JointWeldDateMeta row={row} />
        </span>
      </span>
      <span className="flex flex-wrap gap-1.5">
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
    </label>
  )
}
