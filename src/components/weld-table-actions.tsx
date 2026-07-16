import { ClipboardCheck, ExternalLink, FilePlus2, FilterX, GitBranch, ListFilter } from 'lucide-react'
import type { CSSProperties } from 'react'

import type { WeldRow } from '@/lib/dispatcher-types'
import type { ReportRowActions } from '@/lib/report-row-actions'

type StickyCoverStyle = CSSProperties & {
  '--weld-sticky-cover-left'?: string
}

export function WeldTableFilterResetHeader({
  hasColumnFilters,
  sticky,
  stickyLeft,
  onReset,
}: {
  hasColumnFilters: boolean
  sticky: boolean
  stickyLeft: number
  onReset: () => void
}) {
  return (
    <th
      rowSpan={2}
      className={`border-b-2 border-r border-t-2 border-b-[#d3e3ee] border-r-[#e7f0f6] border-t-[#d3e3ee] bg-[#f6fbfe] px-1.5 py-2 text-center text-xs font-semibold text-slate-600 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.86)] ${
        sticky ? getStickyCoverClassName('z-40') : ''
      }`}
      style={sticky ? getStickyCoverStyle(stickyLeft) : undefined}
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
  sticky,
  stickyLeft,
  stickyBackgroundClassName = 'bg-white',
  onOpenChain,
  onFilterLine,
  onOpenLinkedReport,
  openLinkedReportTitle,
}: {
  row: WeldRow
  sticky?: boolean
  stickyLeft?: number
  stickyBackgroundClassName?: string
  onOpenChain?: (row: WeldRow) => void
  onFilterLine?: (row: WeldRow) => void
  onOpenLinkedReport?: (row: WeldRow) => void
  openLinkedReportTitle: string
}) {
  return (
    <td
      className={`border-b border-r border-b-slate-100 border-r-slate-200 px-1.5 py-2.5 text-center align-top ${
        sticky ? `${getStickyCoverClassName('z-[1]')} ${stickyBackgroundClassName}` : ''
      }`}
      style={sticky ? getStickyCoverStyle(stickyLeft ?? 0) : undefined}
    >
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

function getStickyCoverClassName(zIndexClassName: string) {
  return `sticky ${zIndexClassName} before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-[var(--weld-sticky-cover-left)] before:bg-inherit before:content-['']`
}

function getStickyCoverStyle(left: number): StickyCoverStyle {
  return {
    left,
    '--weld-sticky-cover-left': `${Math.max(left, 0)}px`,
  }
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
