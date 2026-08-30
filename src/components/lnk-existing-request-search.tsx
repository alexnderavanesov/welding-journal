import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

import { Input } from '@/components/ui/input'

type LnkExistingRequestSearchProps = {
  value: string
  resultCount: number
  totalCount: number
  onCommit: (value: string) => void
}

export function LnkExistingRequestSearch({
  value,
  resultCount,
  totalCount,
  onCommit,
}: LnkExistingRequestSearchProps) {
  const [draft, setDraft] = useState(value)
  const onCommitRef = useRef(onCommit)
  const lastEmittedValueRef = useRef(value)

  useEffect(() => {
    onCommitRef.current = onCommit
  }, [onCommit])

  useEffect(() => {
    if (value === lastEmittedValueRef.current) return
    lastEmittedValueRef.current = value
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (draft === value || draft === lastEmittedValueRef.current) return
    const timeoutId = window.setTimeout(() => {
      if (draft === lastEmittedValueRef.current) return
      lastEmittedValueRef.current = draft
      onCommitRef.current(draft)
    }, 180)
    return () => window.clearTimeout(timeoutId)
  }, [draft, value])

  const clear = () => {
    lastEmittedValueRef.current = ''
    setDraft('')
    onCommitRef.current('')
  }

  return (
    <label className="block space-y-1.5 text-sm">
      <span className="flex items-center justify-between gap-2 text-[13px] font-medium leading-none text-slate-700">
        <span>Поиск заявки</span>
        <span className="text-[11px] font-normal tabular-nums text-slate-400">{resultCount}/{totalCount}</span>
      </span>
      <span className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Название, дата, проект или стык"
          className="h-9 pl-9 pr-9"
        />
        {draft ? (
          <button
            type="button"
            onClick={clear}
            title="Очистить поиск заявки"
            aria-label="Очистить поиск заявки"
            className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </span>
    </label>
  )
}
