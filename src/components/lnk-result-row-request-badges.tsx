import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getLnkRequestMethodBadgeClass,
  isLnkMethodNoNeed,
} from '@/lib/lnk-status'
import { getLnkRowRequestMethods } from '@/lib/report-modal-rows'
import type { WeldFieldKey } from '@/lib/weld-fields'

type LnkResultRowRequestBadgesProps = {
  row: WeldRow
  requestName: string
  methodKey: WeldFieldKey | ''
  selected: boolean
  rowRequestNames: string[]
}

export function LnkResultRowRequestBadges({
  row,
  requestName,
  methodKey,
  selected,
  rowRequestNames,
}: LnkResultRowRequestBadgesProps) {
  if (rowRequestNames.length === 0) {
    return (
      <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
        Нет заявки
      </span>
    )
  }

  return (
    <>
      {getLnkRowRequestMethods(row, requestName).map((availableMethod) => {
        const requestNameValue = String(row[availableMethod.requestKey] ?? '').trim()
        const conclusionName = String(row[availableMethod.conclusionKey] ?? '').trim()
        const hasNoNeed = isLnkMethodNoNeed(row, availableMethod)
        const isSelectedMethod = availableMethod.requestKey === methodKey
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
                {hasNoNeed ? 'нет потребности' : requestNameValue}
              </span>
            </span>
            {conclusionName && !hasNoNeed ? (
              <span className="max-w-full overflow-visible break-all whitespace-normal [text-overflow:clip]">
                {conclusionName}
              </span>
            ) : null}
          </span>
        )
      })}
    </>
  )
}
