import { memo, type MouseEvent } from 'react'
import { DialogRowMenuButton } from '@/components/dialog-row-menu-button'
import { RequestRowJointHeading } from '@/components/request-row-joint-heading'
import { getAvailableLnkRequestMethods, getLnkRequestCandidateMethods } from '@/lib/lnk-status'
import { getLnkRowRequestMethods } from '@/lib/report-modal-rows'
import type { ControlProcessSettings } from '@/lib/control-process-settings'
import { getPrimaryLnkRequestAccess } from '@/lib/lnk-control-stage'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

type LnkRequestRowProps = {
  row: WeldRow
  controlProcessSettings: ControlProcessSettings
  selected: boolean
  selectedMethods: ReadonlySet<WeldFieldKey>
  onToggleRow: (rowId: number) => void
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, row: WeldRow) => void
}

function LnkRequestRowComponent({
  row,
  controlProcessSettings,
  selected,
  selectedMethods,
  onToggleRow,
  onOpenContextMenu,
}: LnkRequestRowProps) {
  const candidateMethods = getLnkRequestCandidateMethods(row)
  const availableMethods = getAvailableLnkRequestMethods(row, controlProcessSettings)
  const existingMethods = getLnkRowRequestMethods(row, '')
  const disabled = availableMethods.length === 0
  const methodAccess = new Map(candidateMethods.map((method) => [
    method.requestKey,
    getPrimaryLnkRequestAccess(row, method.code, controlProcessSettings),
  ]))
  const warningReason = candidateMethods
    .map((method) => methodAccess.get(method.requestKey))
    .find((access) => access?.status === 'blocked')?.reason

  return (
    <div
      onClick={() => {
        if (!disabled) onToggleRow(row.id)
      }}
      onContextMenu={(event) => onOpenContextMenu(event, row)}
      className={`group/dialog-row grid grid-cols-[28px_minmax(0,1fr)_auto_32px] items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
        disabled
          ? 'cursor-not-allowed bg-slate-100 text-slate-400'
          : selected
            ? 'cursor-pointer bg-sky-50/70 shadow-[inset_3px_0_0_#38bdf8]'
            : 'cursor-pointer bg-white hover:bg-slate-50'
      }`}
    >
      <input
        type="checkbox"
        aria-label={`Выбрать стык ${String(row.line ?? '').trim()} ${String(row.joint ?? row.id).trim()}`.trim()}
        checked={selected}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggleRow(row.id)}
        disabled={disabled}
        className="h-4 w-4 rounded border-slate-300 text-slate-900"
      />
      <span className="min-w-0">
        <RequestRowJointHeading row={row} />
        {warningReason ? (
          <span className="mt-1 block text-xs leading-4 text-amber-700">
            {warningReason}
          </span>
        ) : null}
      </span>
      <span className="flex max-w-[28rem] flex-wrap justify-end gap-1.5">
        {candidateMethods.length > 0 ? (
          candidateMethods.map((method) => {
            const access = methodAccess.get(method.requestKey)
            const methodAvailable = access?.status !== 'blocked'
            const isSelectedMethod = selected && selectedMethods.has(method.requestKey)
            return (
              <span
                key={method.requestKey}
                className={`rounded border px-2 py-1 text-xs font-medium ${
                  !methodAvailable
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : isSelectedMethod
                    ? 'border-sky-300 bg-sky-100 text-sky-900'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
                title={access?.reason || undefined}
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
      <DialogRowMenuButton
        label={`Действия: стык ${String(row.joint ?? row.line ?? row.id)}`}
        onOpen={(event) => onOpenContextMenu(event, row)}
      />
    </div>
  )
}

export const LnkRequestRow = memo(LnkRequestRowComponent, (previous, next) => {
  if (
    previous.row !== next.row ||
    previous.controlProcessSettings !== next.controlProcessSettings ||
    previous.selected !== next.selected ||
    previous.onOpenContextMenu !== next.onOpenContextMenu
  ) return false
  if (!next.selected) return true
  return areSetsEqual(previous.selectedMethods, next.selectedMethods)
})

function areSetsEqual(left: ReadonlySet<WeldFieldKey>, right: ReadonlySet<WeldFieldKey>) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}
