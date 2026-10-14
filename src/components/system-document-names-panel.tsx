import { useId, useRef, useState, useMemo, type ClipboardEvent, type MouseEvent } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

import { BufferedDocumentNameInput } from '@/components/buffered-document-name-input'
import { DialogRowMenuButton } from '@/components/dialog-row-menu-button'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { SystemDocumentCreationGroup, SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { DocumentCompositionPanel } from '@/components/document-composition-panel'

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
  const instanceId = useId()
  const compositionRevision = useRef({ signature: '', version: 0 })
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [page, setPage] = useState(0), [search, setSearch] = useState(''), [composition, setComposition] = useState<string | null>(null)
  const multipleGroups = plan.groups.length > 1
  const isCustom = plan.groups.some(group => !group.useSystemName)
  const nameModes = new Set(plan.groups.map(group => group.useSystemName ? 'system' : 'custom'))
  const activeNameMode = nameModes.size === 0 ? naming.mode : nameModes.size === 1 ? [...nameModes][0] : null
  const normalizedNames = plan.groups.map((group) => group.name.trim().toLocaleLowerCase('ru-RU'))
  const duplicateNames = getDuplicateNames(normalizedNames)
  const filledCount = plan.groups.filter((group) => group.name.trim()).length
  const allNamesFilled = plan.groups.length > 0 && filledCount === plan.groups.length

  const updateGroupName = (groupKey: string, value: string) => {
    const group = plan.groups.find(group => group.key === groupKey)!
    onNamingChange({ ...naming, ...(!multipleGroups ? { customName: value } : {}),
      groupModes: { ...naming.groupModes, [groupKey]: 'custom' },
      customGroupNames: { ...naming.customGroupNames, [groupKey]: value },
      customGroupMembers: { ...naming.customGroupMembers, [groupKey]: group.membership ?? group.rowIds.join(',') },
    })
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
    const groupModes = { ...naming.groupModes }, customGroupMembers = { ...naming.customGroupMembers }
    names.slice(0, plan.groups.length - startIndex).forEach((name, offset) => {
      const group = plan.groups[startIndex + offset]
      if (group) { nextGroupNames[group.key] = name; groupModes[group.key] = 'custom'; customGroupMembers[group.key] = group.membership ?? group.rowIds.join(',') }
    })
    onNamingChange({ ...naming, customGroupNames: nextGroupNames, groupModes, customGroupMembers })
  }

  const optionalBlankNames = plan.documentCount === 0 && !plan.groups.some(group => group.requiresNameReview)
  const hasError = (group: SystemDocumentCreationGroup) => (!optionalBlankNames && !group.name.trim()) || duplicateNames.has(group.name.trim().toLocaleLowerCase('ru-RU')) || group.isMissingValueFallback
  const filtered = plan.groups.map((group, index) => ({ group, index })).filter(({ group }) => (!errorsOnly || hasError(group)) && `${group.label} ${group.name}`.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU')))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 50) - 1))
  const activeGroup = plan.groups.find(group => group.key === composition)
  const compositionItems = useMemo(() => {
    if (!activeGroup) return []
    const rows = new Map(activeGroup.rows.map(row => [row.id, row]))
    return (activeGroup.positions ?? activeGroup.rows.map(row => ({ rowId: row.id, method: plan.methodCode ?? '', stage: 'Основной контроль', cycle: undefined, source: undefined }))).map(position => {
      const row = rows.get(position.rowId)!
      return { joint: String(row.joint ?? row.id), project: String(row.projectTitle ?? ''), subtitle: String(row.subtitleCode ?? ''), line: String(row.line ?? ''), method: position.method, stage: position.stage, cycle: position.cycle ?? null, source: position.source ?? 'Создание нового документа' }
    })
  }, [activeGroup, plan.methodCode])
  const errorGroups = plan.groups.filter(hasError)
  const compositionSignature = useMemo(() => JSON.stringify(compositionItems), [compositionItems])
  if (activeGroup && compositionRevision.current.signature !== compositionSignature) compositionRevision.current = { signature: compositionSignature, version: compositionRevision.current.version + 1 }

  return (
    <section className="flex min-h-0 flex-1 overflow-hidden">
    <div className={`${activeGroup ? 'hidden lg:flex' : 'flex'} min-w-0 min-h-0 flex-1 flex-col px-5 py-3`}>
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
              aria-pressed={activeNameMode === mode}
              onClick={() => onNamingChange({ ...naming, mode, groupModes: {} })}
              disabled={disabled}
              className={`h-8 rounded px-3 text-xs font-semibold transition-colors ${
                activeNameMode === mode
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {mode === 'system' ? 'Системное' : 'Пользовательское'}
            </button>
          ))}
        </div>

        {nameModes.size > 1 ? <span className="text-xs text-slate-500">Смешанные названия</span> : null}

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

      {plan.groups.length > 50 ? <BufferedDocumentNameInput value={search} onCommit={value => { setSearch(value); setPage(0) }} placeholder="Поиск по группам и названиям" aria-label="Поиск по будущим документам" className="mt-2" /> : null}
      {errorGroups.length > 0 || errorsOnly ? <label className="mt-2 text-xs text-rose-700"><input type="checkbox" checked={errorsOnly} onChange={event => { setErrorsOnly(event.target.checked); setSearch(''); setPage(0) }} /> Только проблемные группы — {errorGroups.length} во всём списке</label> : null}

      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="hidden shrink-0 grid-cols-[minmax(160px,.9fr)_minmax(200px,1.2fr)_60px_32px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold text-slate-500 md:grid">
          <span>Группа и стыки</span>
          <span>{documentNameLabel}</span>
          <span className="text-center">Стыков</span>
          <span />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {plan.groups.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center px-6 text-sm text-slate-500">
              {emptyMessage}
            </div>
          ) : filtered.slice(currentPage * 50, (currentPage + 1) * 50).map(({ group, index }) => {
            const normalizedName = normalizedNames[index] ?? ''
            const nameError = !normalizedName && !optionalBlankNames
                ? 'Название не указано'
                : duplicateNames.has(normalizedName)
                  ? 'Название повторяется'
                  : ''
            return (
              <div
                key={group.key}
                onContextMenu={(event) => {
                  if (!onOpenGroupContextMenu) return
                  if ((event.target as HTMLElement | null)?.closest('input, textarea, select, button')) return
                  onOpenGroupContextMenu(event, group)
                }}
                className={`group/dialog-row grid min-h-[86px] grid-cols-1 md:grid-cols-[minmax(160px,.9fr)_minmax(200px,1.2fr)_60px_32px] gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 ${
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
                  <button type="button" className="mt-1 text-xs font-semibold text-sky-700" onClick={() => setComposition(group.key)}>Состав — {group.positions?.length ?? group.rows.length} позиций</button>
                  {group.positions && group.positions.length !== group.rows.length ? <div className="text-xs text-slate-500">Уникальных стыков: {group.rows.length}</div> : null}
                </div>
                <div className="min-w-0 self-start">
                      <BufferedDocumentNameInput
                        ref={(node) => { inputRefs.current[index] = node }}
                        value={group.name}
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
                      <div className="mt-1 flex gap-2 text-xs text-slate-500"><span>{group.useSystemName ? 'Системное имя' : 'Пользовательское имя'}</span><button type="button" disabled={disabled} className="text-sky-700" onClick={() => onNamingChange({ ...naming, groupModes: { ...naming.groupModes, [group.key]: 'system' } })}>Системное</button></div>
                      <div className={`mt-1 h-4 text-xs ${nameError ? 'text-rose-700' : 'text-slate-400'}`}>
                        {nameError || (multipleGroups && index === 0 ? 'Можно вставить несколько названий, по одному в строке.' : '')}
                      </div>
                </div>
                <div data-group-joint-count className="flex h-9 items-center justify-center self-start text-sm font-semibold tabular-nums text-slate-700">{group.rows.length}</div>
                {onOpenGroupContextMenu ? (
                  <div className="flex h-9 items-center self-start">
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
      {filtered.length > 50 ? <div className="flex justify-between text-xs"><button type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>← Предыдущие</button><span>{filtered.length} групп · страница {currentPage + 1}</span><button type="button" disabled={(currentPage + 1) * 50 >= filtered.length} onClick={() => setPage(currentPage + 1)}>Следующие →</button></div> : null}
    </div>
    {activeGroup ? <DocumentCompositionPanel key={activeGroup.key} title={activeGroup.name || activeGroup.label} cacheKey={`creation:${instanceId}:${compositionRevision.current.version}`} onClose={() => setComposition(null)} load={async (query, page) => {
      const items = query ? compositionItems.filter(item => Object.values(item).join(' ').toLocaleLowerCase('ru-RU').includes(query.toLocaleLowerCase('ru-RU'))) : compositionItems
      return { items: items.slice(page * 50, (page + 1) * 50), total: items.length, totalPositions: compositionItems.length, page }
    }} /> : null}
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
