import {
  JointFullMeta,
  JointTitleLine,
} from '@/components/joint-meta'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkResultBadgeClass } from '@/lib/report-badges'

type ResultChangeView = {
  from: string
  to: string
} | null

type LnkResultManagerSummaryProps = {
  row: WeldRow
  methodCode: string
  currentResult: string
  pendingResult: string | null
  activeChangeHint: ResultChangeView
  conclusionName: string
  conclusionDate: string
}

export function LnkResultManagerSummary({
  row,
  methodCode,
  currentResult,
  pendingResult,
  activeChangeHint,
  conclusionName,
  conclusionDate,
}: LnkResultManagerSummaryProps) {
  return (
    <>
      <JointTitleLine row={row} />
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>
          <JointFullMeta row={row} />
        </span>
        {pendingResult === null ? <>
          <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getLnkResultBadgeClass(currentResult)}`}>Сейчас {methodCode}: {currentResult || '-'}</span>
          <LnkPendingResultBadge result={null} currentResult={currentResult} />
        </> : activeChangeHint ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium text-slate-500">
              {pendingResult && pendingResult !== currentResult ? 'Будет:' : 'Проверка:'}
            </span>
            <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getLnkResultBadgeClass(activeChangeHint?.from || currentResult)}`}>
              {activeChangeHint?.from || currentResult || '-'}
            </span>
            <span className="px-0.5 text-sm font-bold leading-none text-slate-700">→</span>
            <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getLnkResultBadgeClass(activeChangeHint.to)}`}>
              {activeChangeHint.to}
            </span>
          </span>
        ) : (
          <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${currentResult ? getLnkResultBadgeClass(currentResult) : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
            Сейчас {methodCode}: {currentResult || '-'}
          </span>
        )}
      </div>
      {conclusionName || conclusionDate ? (
        <div className="mt-1 text-xs leading-5 text-slate-500">
          <span className="font-medium text-slate-700">Заключение:</span>{' '}
          <span className="break-words">{conclusionName || '-'}</span>
          <span className="mx-1 text-slate-300">·</span>
          <span className="font-medium text-slate-700">Дата:</span> {conclusionDate || '-'}
        </div>
      ) : null}
    </>
  )
}

export function LnkPendingResultBadge({ result, currentResult }: { result: string | null | undefined; currentResult: string }) {
  if (result === undefined || result === '' || result === currentResult) return null
  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${result === null
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : 'border-sky-200 bg-sky-50 text-sky-800'}`}>
    {result === null ? 'Будет удалён' : `Будет: ${result}`}
  </span>
}
