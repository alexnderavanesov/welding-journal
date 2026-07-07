import { ClipboardCheck, ExternalLink, FilePlus2, FilterX, GitBranch, ListFilter } from 'lucide-react'

import type { WeldRow } from '@/lib/dispatcher-types'
import type { ReportRowActions } from '@/lib/report-row-actions'

export function WeldTableFilterResetHeader({
  hasColumnFilters,
  onReset,
}: {
  hasColumnFilters: boolean
  onReset: () => void
}) {
  return (
    <th
      rowSpan={3}
      className="border-r border-slate-200/70 bg-slate-50 px-1.5 py-2 text-center text-xs font-semibold text-slate-500 shadow-[inset_0_1px_0_0_rgb(241,245,249),inset_0_-1px_0_0_rgb(226,232,240)]"
      title="Навигация по стыку"
    >
      <div className="flex h-full min-h-24 flex-col items-center justify-end gap-2">
        <span className="sr-only">Навигация</span>
        <button
          type="button"
          onClick={onReset}
          disabled={!hasColumnFilters}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-700 shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-100 hover:text-sky-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300 disabled:shadow-none"
          title={hasColumnFilters ? 'Сбросить все фильтры' : 'Фильтры не заданы'}
          aria-label="Сбросить все фильтры"
        >
          <FilterX className="h-3.5 w-3.5" />
        </button>
      </div>
    </th>
  )
}

export function WeldTableRowNavigation({
  row,
  onOpenChain,
  onFilterLine,
  onOpenLinkedReport,
  openLinkedReportTitle,
}: {
  row: WeldRow
  onOpenChain?: (row: WeldRow) => void
  onFilterLine?: (row: WeldRow) => void
  onOpenLinkedReport?: (row: WeldRow) => void
  openLinkedReportTitle: string
}) {
  return (
    <td className="border-b border-r border-b-slate-100 border-r-slate-200 px-1.5 py-2.5 text-center align-top">
      <div className="flex items-center justify-center gap-1">
        {onOpenChain ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onOpenChain(row)
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-sky-200 bg-sky-50 text-sky-700 shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-100 hover:text-sky-900"
            title="Показать цепочку стыка"
            aria-label={`Показать цепочку стыка ${String(row.joint ?? row.id)}`}
          >
            <GitBranch className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {onFilterLine ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onFilterLine(row)
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-sky-800"
            title="Показать всю линию стыка"
            aria-label={`Показать всю линию стыка ${String(row.joint ?? row.id)}`}
          >
            <ListFilter className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {onOpenLinkedReport ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onOpenLinkedReport(row)
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-sky-800"
            title={openLinkedReportTitle}
            aria-label={`${openLinkedReportTitle}: ${String(row.joint ?? row.id)}`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </td>
  )
}

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
