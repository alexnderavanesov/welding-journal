import { useRef, type ClipboardEvent, type MouseEvent } from 'react'
import { AlertTriangle, CheckCircle2, Layers3 } from 'lucide-react'

import { BufferedDocumentNameInput } from '@/components/buffered-document-name-input'
import { DialogRowMenuButton } from '@/components/dialog-row-menu-button'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { SystemDocumentCreationGroup, SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { getSystemDocumentSplitModeLabel } from '@/lib/system-document-splitting'

type SystemDocumentNamesPanelProps = {
  plan: SystemDocumentCreationPlan
  naming: RequestNamingState
  documentNameLabel: string
  documentNameAriaLabel?: string
  documentNamePlaceholder: string
  emptyMessage: string
  disabled?: boolean
  onNamingChange: (value: RequestNamingState) => void
  onOpenGroupContextMenu?: (event: MouseEvent<HTMLElement>, group: SystemDocumentCreationGroup) => void
}

export function SystemDocumentNamesPanel({
  plan,
  naming,
  documentNameLabel,
  documentNameAriaLabel = documentNameLabel,
  documentNamePlaceholder,
  emptyMessage,
  disabled = false,
  onNamingChange,
  onOpenGroupContextMenu,
}: SystemDocumentNamesPanelProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])
  const multipleGroups = plan.groups.length > 1
  const isCustom = naming.mode === 'custom'
  const normalizedNames = plan.groups.map((group) => group.name.trim().toLocaleLowerCase('ru-RU'))
  const duplicateNames = getDuplicateNames(normalizedNames)
  const filledCount = plan.groups.filter((group) => group.name.trim()).length
  const allNamesFilled = plan.groups.length > 0 && filledCount === plan.groups.length

  const updateGroupName = (groupKey: string, value: string) => {
    if (multipleGroups) {
      onNamingChange({
        ...naming,
        customGroupNames: {
          ...(naming.customGroupNames ?? {}),
          [groupKey]: value,
        },
      })
      return
    }
    onNamingChange({ ...naming, customName: value })
  }

  const pasteNames = (event: ClipboardEvent<HTMLInputElement>, startIndex: number) => {
    const names = event.clipboardData
      .getData('text')
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean)
    if (names.length < 2 || !multipleGroups) return

    event.preventDefault()
    const nextGroupNames = { ...(naming.customGroupNames ?? {}) }
    names.slice(0, plan.groups.length - startIndex).forEach((name, offset) => {
      const group = plan.groups[startIndex + offset]
      if (group) nextGroupNames[group.key] = name
    })
    onNamingChange({ ...naming, customGroupNames: nextGroupNames })
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col px-5 py-3">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 pb-3">
        <div
          className="inline-flex shrink-0 rounded-md border border-slate-200 bg-slate-50 p-0.5"
          role="group"
          aria-label={documentNameLabel}
        >
          {(['system', 'custom'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={naming.mode === mode}
              onClick={() => onNamingChange({ ...naming, mode })}
              disabled={disabled}
              className={`h-8 rounded px-3 text-xs font-semibold transition-colors ${
                naming.mode === mode
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {mode === 'system' ? 'Системное' : 'Пользовательское'}
            </button>
          ))}
        </div>

        <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
          <Layers3 className="h-4 w-4 text-sky-600" />
          Разделение: <strong className="text-slate-800">{getSystemDocumentSplitModeLabel(plan.mode).toLocaleLowerCase('ru-RU')}</strong>
        </span>
        <span className="text-sm text-slate-600">
          Будет создано: <strong className="text-slate-800">{plan.groups.length}</strong>
        </span>
        {isCustom ? (
          <span className={`ml-auto inline-flex items-center gap-1.5 text-sm font-medium ${
            allNamesFilled ? 'text-emerald-700' : 'text-slate-600'
          }`}>
            {allNamesFilled ? <CheckCircle2 className="h-4 w-4" /> : null}
            Заполнено: {filledCount}/{plan.groups.length}
          </span>
        ) : null}
      </div>

      {plan.missingSummary ? (
        <div className="mt-2 flex shrink-0 items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>{plan.missingSummary}</span>
        </div>
      ) : null}

      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="grid shrink-0 grid-cols-[minmax(300px,0.9fr)_minmax(360px,1.2fr)_76px_32px] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold text-slate-500">
          <span>Группа и стыки</span>
          <span>{documentNameLabel}</span>
          <span>Стыков</span>
          <span />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {plan.groups.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center px-6 text-sm text-slate-500">
              {emptyMessage}
            </div>
          ) : plan.groups.map((group, index) => {
            const normalizedName = normalizedNames[index] ?? ''
            const nameError = isCustom
              ? !normalizedName
                ? 'Название не указано'
                : duplicateNames.has(normalizedName)
                  ? 'Название повторяется'
                  : ''
              : ''
            return (
              <div
                key={group.key}
                onContextMenu={(event) => {
                  if (!onOpenGroupContextMenu) return
                  if ((event.target as HTMLElement | null)?.closest('input, textarea, select, button')) return
                  onOpenGroupContextMenu(event, group)
                }}
                className={`group/dialog-row grid min-h-[86px] grid-cols-[minmax(300px,0.9fr)_minmax(360px,1.2fr)_76px_32px] gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0 ${
                  group.isMissingValueFallback ? 'bg-amber-50/60' : 'bg-white'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900" title={group.label}>{group.label}</div>
                  <div className="mt-1 truncate text-xs leading-4 text-slate-500" title={formatGroupMeta(group.rows)}>
                    {formatGroupMeta(group.rows)}
                  </div>
                  {plan.mode === 'joint' ? null : (
                    <div className="mt-0.5 truncate text-xs leading-4 text-slate-400" title={formatJointPreview(group.rows)}>
                      {formatJointPreview(group.rows)}
                    </div>
                  )}
                </div>
                <div className="min-w-0 self-center">
                  {isCustom ? (
                    <>
                      <BufferedDocumentNameInput
                        ref={(node) => { inputRefs.current[index] = node }}
                        value={multipleGroups ? naming.customGroupNames?.[group.key] ?? '' : naming.customName}
                        onCommit={(value) => updateGroupName(group.key, value)}
                        onPaste={(event) => pasteNames(event, index)}
                        onKeyDown={(event) => {
                          if ((event.key !== 'Enter' && event.key !== 'Tab') || !inputRefs.current[index + 1]) return
                          event.preventDefault()
                          window.setTimeout(() => inputRefs.current[index + 1]?.focus(), 0)
                        }}
                        disabled={disabled}
                        placeholder={documentNamePlaceholder}
                        aria-label={`${documentNameAriaLabel}: ${group.label}`}
                        className={`h-9 ${nameError ? 'border-rose-300 focus-visible:border-rose-400 focus-visible:ring-rose-100' : ''}`}
                      />
                      <div className={`mt-1 h-4 text-xs ${nameError ? 'text-rose-700' : 'text-slate-400'}`}>
                        {nameError || (multipleGroups && index === 0 ? 'Можно вставить несколько названий, по одному в строке.' : '')}
                      </div>
                    </>
                  ) : (
                    <div className="truncate text-sm font-medium text-slate-800" title={group.name || undefined}>
                      {group.name || 'Название будет рассчитано после заполнения данных'}
                    </div>
                  )}
                </div>
                <div className="self-center text-sm font-semibold text-slate-700">{group.rows.length}</div>
                {onOpenGroupContextMenu ? (
                  <div className="self-center">
                    <DialogRowMenuButton
                      label={`Действия: ${group.label}`}
                      onOpen={(event) => onOpenGroupContextMenu(event, group)}
                    />
                  </div>
                ) : <span />}
              </div>
            )
          })}
        </div>
      </div>

      <div className="h-6 shrink-0 pt-1 text-xs font-medium leading-5 text-slate-400">
        {isCustom && multipleGroups ? 'Enter переходит к следующему полю; многострочная вставка заполняет группы по порядку.' : ''}
      </div>
    </section>
  )
}

function getDuplicateNames(normalizedNames: string[]) {
  const counts = new Map<string, number>()
  normalizedNames.forEach((name) => {
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  })
  return new Set(Array.from(counts).filter(([, count]) => count > 1).map(([name]) => name))
}

function formatGroupMeta(rows: SystemDocumentCreationPlan['groups'][number]['rows']) {
  return [
    formatValues('Проект', rows, 'projectTitle'),
    formatValues('Шифр', rows, 'subtitleCode'),
    formatValues('Линия', rows, 'line'),
  ].join(' · ')
}

function formatJointPreview(rows: SystemDocumentCreationPlan['groups'][number]['rows']) {
  const values = rows.slice(0, 4).map((row) => String(row.joint ?? `ID ${row.id}`).trim()).filter(Boolean)
  const tail = rows.length > 4 ? ` и еще ${rows.length - 4}` : ''
  return `Стыки: ${values.join(', ') || '-'}${tail}`
}

function formatValues(
  label: string,
  rows: SystemDocumentCreationPlan['groups'][number]['rows'],
  field: 'projectTitle' | 'subtitleCode' | 'line',
) {
  const values = Array.from(new Set(rows.map((row) => String(row[field] ?? '').trim()).filter(Boolean)))
  const visible = values.slice(0, 2)
  const tail = values.length > 2 ? ` +${values.length - 2}` : ''
  return `${label}: ${visible.join(', ') || '-'}${tail}`
}
