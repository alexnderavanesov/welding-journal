import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { AlertTriangle, ChevronDown, Layers3 } from 'lucide-react'

import { Input } from '@/components/ui/input'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { getSystemDocumentSplitModeLabel } from '@/lib/system-document-splitting'

export function SystemDocumentSplitPreview({
  plan,
  naming,
  disabled = false,
  onNamingChange,
}: {
  plan: SystemDocumentCreationPlan
  naming: RequestNamingState
  disabled?: boolean
  onNamingChange: (value: RequestNamingState) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const multipleGroups = plan.groups.length > 1
  const manualNames = naming.mode === 'custom' && multipleGroups
  const allNamesEmpty = plan.groups.every((group) => !group.name.trim())
  const documentCount = allNamesEmpty && !plan.error ? 0 : plan.groups.length

  useEffect(() => {
    if (manualNames) setExpanded(true)
  }, [manualNames])

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-sm text-sky-950">
            <Layers3 className="h-4 w-4 shrink-0 text-sky-600" />
            <span>
              Разделение: <strong>{getSystemDocumentSplitModeLabel(plan.mode).toLocaleLowerCase('ru-RU')}</strong>
              <span className="text-sky-700"> · будет создано документов: </span>
              <strong>{documentCount}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            disabled={plan.groups.length === 0}
            aria-expanded={expanded}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-sky-200 bg-white px-2.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {expanded ? 'Скрыть группы' : 'Показать группы'}
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {plan.missingSummary ? (
          <div className="mt-2 flex items-start gap-2 border-t border-sky-200 pt-2 text-xs leading-5 text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>{plan.missingSummary}</span>
          </div>
        ) : null}
      </div>

      {expanded ? (
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="grid grid-cols-[minmax(0,1fr)_4rem] gap-3 bg-slate-50 px-3 py-2 text-[10px] font-semibold text-slate-500">
            <span>Группа</span>
            <span>Стыков</span>
          </div>
          {plan.groups.map((group) => (
            <div
              key={group.key}
              className={`grid grid-cols-[minmax(0,1fr)_4rem] gap-3 border-t border-slate-200 px-3 py-3 ${
                group.isMissingValueFallback ? 'bg-amber-50/60' : 'bg-white'
              }`}
            >
              <div className="min-w-0">
                <div className="break-words text-sm font-semibold text-slate-800">{group.label}</div>
                <div className="mt-1.5 space-y-0.5 text-xs leading-4 text-slate-500">
                  <div className="break-words">{formatFieldPreview('Шифр', group.rows, 'subtitleCode')}</div>
                  <div className="break-words">{formatFieldPreview('Линия', group.rows, 'line')}</div>
                  {plan.mode === 'joint' ? null : (
                    <div className="break-words text-slate-400">{formatJointPreview(group.rows)}</div>
                  )}
                </div>
              </div>
              <div className="text-sm font-semibold text-slate-700">{group.rows.length}</div>
              <div className="col-span-2 min-w-0">
                <div className="mb-1 text-[10px] font-semibold text-slate-400">Будущее название</div>
                {manualNames ? (
                  <BufferedGroupNameInput
                    value={naming.customGroupNames?.[group.key] ?? ''}
                    onCommit={(value) => onNamingChange({
                      ...naming,
                      customGroupNames: {
                        ...(naming.customGroupNames ?? {}),
                        [group.key]: value,
                      },
                    })}
                    disabled={disabled}
                    placeholder="Название документа"
                    aria-label={`Название документа: ${group.label}`}
                  />
                ) : (
                  <div className="break-words text-sm text-slate-700">{group.name || 'Название не указано'}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {plan.error ? (
        <p className="text-xs font-medium leading-5 text-rose-700">{plan.error}</p>
      ) : null}
    </div>
  )
}

function BufferedGroupNameInput({
  value,
  onCommit,
  ...inputProps
}: Omit<ComponentProps<typeof Input>, 'onChange' | 'value'> & {
  value: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const onCommitRef = useRef(onCommit)

  useEffect(() => {
    onCommitRef.current = onCommit
  }, [onCommit])

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (draft === value) return
    const timeoutId = window.setTimeout(() => onCommitRef.current(draft), 150)
    return () => window.clearTimeout(timeoutId)
  }, [draft, value])

  const commit = () => {
    if (draft !== value) onCommitRef.current(draft)
  }

  return (
    <Input
      {...inputProps}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        inputProps.onKeyDown?.(event)
      }}
    />
  )
}

function formatJointPreview(rows: SystemDocumentCreationPlan['groups'][number]['rows']) {
  const values = rows.slice(0, 3).map((row) => String(row.joint ?? `ID ${row.id}`).trim()).filter(Boolean)
  const tail = rows.length > 3 ? ` и еще ${rows.length - 3}` : ''
  return `Стыки: ${values.join(', ') || '-'}${tail}`
}

function formatFieldPreview(
  label: string,
  rows: SystemDocumentCreationPlan['groups'][number]['rows'],
  field: 'subtitleCode' | 'line',
) {
  const values = Array.from(new Set(rows.map((row) => String(row[field] ?? '').trim()).filter(Boolean)))
  const visibleValues = values.slice(0, 3)
  const tail = values.length > 3 ? ` и еще ${values.length - 3}` : ''
  return `${label}: ${visibleValues.join(', ') || '-'}${tail}`
}
