import { CopyCheck } from 'lucide-react'

import { ResultBadge } from '@/lib/weld-table-badges'
import { getDuplicateControls } from '@/lib/duplicate-control-utils'
import type { WeldRow } from '@/lib/dispatcher-types'

type DuplicateControlTableCellProps = {
  row: WeldRow
  onOpen: (row: WeldRow) => void
}

export function DuplicateControlTableCell({ row, onOpen }: DuplicateControlTableCellProps) {
  const controls = getDuplicateControls(row)
  const visibleControls = controls.slice(0, 3)
  const hiddenCount = Math.max(0, controls.length - visibleControls.length)

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onOpen(row)
      }}
      className="flex h-full min-h-12 w-full flex-col items-center justify-center gap-1 px-2 py-2 text-center transition hover:bg-sky-50/70"
      title={controls.length > 0 ? 'Открыть и редактировать дубль-контроль' : 'Добавить дубль-контроль'}
    >
      {controls.length === 0 ? (
        <>
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500">
            <CopyCheck className="h-3.5 w-3.5" />
            нет дубля
          </span>
          <span className="text-[11px] text-sky-700">добавить</span>
        </>
      ) : (
        <>
          <span className="flex max-w-full flex-wrap justify-center gap-1">
            {visibleControls.map((control) => (
              <span
                key={control.id}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600"
              >
                <span className="font-semibold text-slate-700">{control.method}</span>
                <span className="text-slate-400">дубль</span>
                <ResultBadge value={control.result} />
              </span>
            ))}
            {hiddenCount > 0 ? (
              <span className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-500">+{hiddenCount}</span>
            ) : null}
          </span>
          <span className="text-[11px] text-sky-700">посмотреть / изменить</span>
        </>
      )}
    </button>
  )
}
