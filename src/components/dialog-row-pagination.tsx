import { ChevronLeft, ChevronRight } from 'lucide-react'

const DIALOG_ROW_PAGE_SIZE_OPTIONS = [25, 50, 100] as const

type DialogRowPaginationProps = {
  totalCount: number
  firstItemNumber: number
  lastItemNumber: number
  page: number
  pageCount: number
  pageSize: number
  onPreviousPage: () => void
  onNextPage: () => void
  onPageSizeChange: (pageSize: number) => void
  itemLabel?: string
}

export function DialogRowPagination({
  totalCount,
  firstItemNumber,
  lastItemNumber,
  page,
  pageCount,
  pageSize,
  onPreviousPage,
  onNextPage,
  onPageSizeChange,
  itemLabel = 'стыков',
}: DialogRowPaginationProps) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/90 px-3 py-2 text-xs text-slate-600">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-800">
          {firstItemNumber}-{lastItemNumber}
        </span>
        <span>из {totalCount} {itemLabel}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-slate-500">На странице</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 min-w-20 rounded-md border border-slate-200 bg-white pl-3 pr-8 text-xs font-medium text-slate-700 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
          >
            {DIALOG_ROW_PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <div className="flex h-8 items-center overflow-hidden rounded-md border border-slate-200 bg-white">
          <button
            type="button"
            aria-label={`Предыдущая страница ${itemLabel}`}
            title="Предыдущая страница"
            disabled={page <= 1}
            onClick={onPreviousPage}
            className="flex h-8 w-8 items-center justify-center border-r border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-24 px-3 text-center font-medium text-slate-700">
            {page} из {pageCount}
          </span>
          <button
            type="button"
            aria-label={`Следующая страница ${itemLabel}`}
            title="Следующая страница"
            disabled={page >= pageCount}
            onClick={onNextPage}
            className="flex h-8 w-8 items-center justify-center border-l border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
