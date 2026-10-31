import { ChevronDown, ListFilter } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import type { ResultRequestSource } from '@/lib/result-request-sources'

import { DialogHeader } from '@/components/dialog-header'
import { Button } from '@/components/ui/button'

type ResultDialogHeaderProps = {
  title: string
  requestName: string
  requestCount?: number
  selectedCount: number
  managerDisabled: boolean
  managerDisabledReason?: string
  onOpenManager: () => void
  onClose: () => void
  stageControl?: ReactNode
  sources?: { groups: ResultRequestSource[]; activeKey: string | null; onSelect: (key: string | null) => void }
}

export function ResultDialogHeader({
  title,
  requestName,
  requestCount = 1,
  selectedCount,
  managerDisabled,
  managerDisabledReason,
  onOpenManager,
  onClose,
  stageControl,
  sources,
}: ResultDialogHeaderProps) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  return (
    <>
    <DialogHeader
      title={title}
      subtitle={<>{sources?.groups.length ? <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)} className="inline-flex items-center gap-1 rounded text-sky-700 hover:underline focus-visible:outline focus-visible:outline-2"><span>Заявки: {sources.groups.length}</span><ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} /></button> : requestCount > 1 ? `Заявки: ${requestCount}` : `Заявка: ${requestName || '-'}`} · Выбрано: {selectedCount}{sources?.activeKey ? ' · Показана одна заявка' : ''}</>}
      onClose={onClose}
      actions={
        <div className="flex items-center gap-2">
          {stageControl}
          <span className="inline-flex" title={managerDisabled ? managerDisabledReason : undefined}>
            <Button
              variant="outline"
              onClick={onOpenManager}
              disabled={managerDisabled}
              className="border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:pointer-events-none disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <ListFilter className="mr-2 h-4 w-4" />
              Все результаты
            </Button>
          </span>
        </div>
      }
    />
    {expanded && sources?.groups.length ? <div id={panelId} className="shrink-0 border-b border-sky-100 bg-sky-50/40 px-5 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between gap-3 text-slate-500"><span>Состав выбранных стыков по заявкам</span><button type="button" className="shrink-0 rounded text-sky-700 hover:underline" onClick={() => sources.onSelect(null)}>Показать все выбранные</button></div>
      <div className="max-h-32 overflow-y-auto">{sources.groups.map(group => <button type="button" key={group.key} aria-pressed={sources.activeKey === group.key} onClick={() => sources.onSelect(group.key)} className={`flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left hover:bg-sky-100 ${sources.activeKey === group.key ? 'bg-sky-100 text-sky-900' : 'text-slate-600'}`}><span className="min-w-0 break-words">{group.label}</span><span className="shrink-0 tabular-nums text-sky-700">{group.rowIds.size} ст.</span></button>)}</div>
    </div> : null}
    </>
  )
}
