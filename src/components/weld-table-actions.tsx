import { ClipboardCheck, FilePlus2 } from 'lucide-react'

import type { ReportRowActions } from '@/lib/report-row-actions'
import type { WeldRow } from '@/lib/dispatcher-types'

export function WeldTableRowActions({
  row,
  rowActions,
}: {
  row: WeldRow
  rowActions: ReportRowActions
}) {
  return (
    <td className="border-b border-r border-b-slate-100 border-r-slate-200 px-1.5 py-2.5 text-center align-top">
      <div className="flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            rowActions.onCreateRequest(row)
          }}
          disabled={!rowActions.canCreateRequest(row)}
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 disabled:shadow-none"
          title={
            rowActions.canCreateRequest(row)
              ? rowActions.createTitle ?? 'Создать заявку на этот стык'
              : rowActions.createDisabledTitle ?? 'Заявка по этому стыку уже создана'
          }
          aria-label={rowActions.createAriaLabel ?? 'Создать заявку на этот стык'}
        >
          <FilePlus2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            rowActions.onAddResult(row)
          }}
          disabled={!rowActions.canAddResult(row)}
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 disabled:shadow-none"
          title={
            rowActions.canAddResult(row)
              ? rowActions.resultTitle ?? 'Добавить результат на этот стык'
              : rowActions.resultDisabledTitle ?? 'Сначала создайте заявку на этот стык'
          }
          aria-label={rowActions.resultAriaLabel ?? 'Добавить результат на этот стык'}
        >
          <ClipboardCheck className="h-3.5 w-3.5" />
        </button>
      </div>
    </td>
  )
}
