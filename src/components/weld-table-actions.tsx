import { ClipboardCheck, FilePlus2 } from 'lucide-react'

import type { ReportRowActions } from '@/lib/report-row-actions'
import type { WeldRow } from '@/lib/dispatcher-types'
import { memo } from 'react'

export const WeldTableRowActions = memo(function WeldTableRowActions({
  row,
  rowActions,
  disabled = false,
}: {
  row: WeldRow
  rowActions: ReportRowActions
  disabled?: boolean
}) {
  const canCreateRequest = !disabled && rowActions.canCreateRequest(row)
  const canAddResult = !disabled && rowActions.canAddResult(row)
  const createDisabledTitle = typeof rowActions.createDisabledTitle === 'function'
    ? rowActions.createDisabledTitle(row)
    : rowActions.createDisabledTitle
  const resultDisabledTitle = typeof rowActions.resultDisabledTitle === 'function'
    ? rowActions.resultDisabledTitle(row)
    : rowActions.resultDisabledTitle

  return (
    <div className="flex items-center justify-center gap-1">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          rowActions.onCreateRequest(row)
        }}
        disabled={!canCreateRequest}
        className="journal-icon-button"
        title={
          canCreateRequest
            ? rowActions.createTitle ?? 'Создать заявку на этот стык'
            : createDisabledTitle ?? 'Заявка по этому стыку уже создана'
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
        disabled={!canAddResult}
        className="journal-icon-button"
        title={
          canAddResult
            ? rowActions.resultTitle ?? 'Добавить результат на этот стык'
            : resultDisabledTitle ?? 'Сначала создайте заявку на этот стык'
        }
        aria-label={rowActions.resultAriaLabel ?? 'Добавить результат на этот стык'}
      >
        <ClipboardCheck className="h-3.5 w-3.5" />
      </button>
    </div>
  )
})
