import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { decodeRebuildPreview } from '@/lib/system-document-rebuild-transport'
import type { RebuildCursor } from '@/lib/system-document-rebuild-batch'
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'

import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getSystemDocumentRebuildDecisionError,
  getSystemDocumentRebuildSelectionSummary,
  type SystemDocumentRebuildCustomDecision,
  type SystemDocumentRebuildPreview,
} from '@/lib/system-document-rebuild'
import {
  CONFIGURABLE_SYSTEM_DOCUMENT_TEMPLATE_PROFILES,
  type SystemDocumentTemplateId,
} from '@/lib/system-document-template-types'
import {
  applySystemDocumentRebuild,
  previewSystemDocumentRebuild,
} from '@/server/system-document-rebuild'

export function SystemDocumentRebuildDialog({
  open,
  runProtectedSettingsChange,
  onClose,
  onApplied,
}: {
  open: boolean
  runProtectedSettingsChange: (action: () => void | Promise<void>) => Promise<boolean>
  onClose: () => void
  onApplied: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<SystemDocumentTemplateId>>(new Set())
  const [decisions, setDecisions] = useState<Record<number, SystemDocumentRebuildCustomDecision>>({})
  const [cursor, setCursor] = useState<RebuildCursor | undefined>()
  const [batchNumber, setBatchNumber] = useState(1)
  const [saved, setSaved] = useState('')
  const [blocked, setBlocked] = useState<Array<{ documentId: number; title: string; reason: string }>>([])
  const previewMutation = useMutation({
    mutationFn: async (nextCursor: RebuildCursor | undefined) => decodeRebuildPreview(await previewSystemDocumentRebuild({ data: { cursor: nextCursor } })),
  })
  const applyMutation = useMutation({
    mutationFn: (data: Parameters<typeof applySystemDocumentRebuild>[0]['data']) =>
      applySystemDocumentRebuild({ data }),
  })

  useEffect(() => {
    if (!open) return
    setSelectedTemplateIds(new Set())
    setDecisions({})
    setCursor(undefined)
    setBatchNumber(1)
    setSaved('')
    setBlocked([])
    applyMutation.reset()
    previewMutation.mutate(undefined)
  }, [open])

  useEffect(() => {
    const preview = previewMutation.data
    if (!preview) return
    const checkedBatch = preview.batch
    if (checkedBatch) setCursor(checkedBatch.cursor)
    if (checkedBatch) setBlocked(current => {
      const checkedThrough = checkedBatch.nextCursor?.afterId ?? checkedBatch.cursor.throughId
      const otherPackets = current.filter(item => item.documentId <= checkedBatch.cursor.afterId || item.documentId > checkedThrough)
      return [...otherPackets, ...checkedBatch.blocked]
    })
    const configurableTemplateIds = new Set<SystemDocumentTemplateId>(
      CONFIGURABLE_SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) => profile.id),
    )
    const affected = new Set<SystemDocumentTemplateId>(
      preview.documents
        .filter((document) => configurableTemplateIds.has(document.templateId))
        .filter((document) => document.willChangeAutomatically || document.requiresCustomNameDecision)
        .map((document) => document.templateId),
    )
    setSelectedTemplateIds(affected)
    setDecisions(Object.fromEntries(
      preview.documents
        .filter((document) => document.requiresCustomNameDecision)
        .map((document) => [document.documentId, { documentId: document.documentId, action: 'keep' as const, groupNames: {} }]),
    ))
  }, [previewMutation.data])

  if (!open) return null

  const preview = previewMutation.data
  const selectedDecisions = Object.values(decisions)
  const decisionError = preview
    ? getSystemDocumentRebuildDecisionError({
        documents: preview.documents,
        selectedTemplateIds,
        decisions: selectedDecisions,
      })
    : ''
  const {
    selectedDocuments,
    changedDocuments,
    affectedRowCount,
    resultingDocumentCount,
  } = getSystemDocumentRebuildSelectionSummary({
    documents: preview?.documents ?? [],
    selectedTemplateIds,
    decisions: selectedDecisions,
  })
  const canApply = Boolean(
    preview && selectedTemplateIds.size > 0 && changedDocuments.length > 0 && !decisionError &&
    !previewMutation.isPending && !previewMutation.isError && !applyMutation.isPending && !saved,
  )
  const previewError = previewMutation.error
    ? rebuildFailureMessage(previewMutation.error, 'Не удалось загрузить пакет. Повторите проверку.') : ''
  const applyError = applyMutation.error
    ? rebuildFailureMessage(applyMutation.error, 'Не удалось подтвердить сохранение пакета. Обновите предпросмотр перед повтором. Ранее сохранённые пакеты остаются.') : ''

  function refreshPreview() {
    applyMutation.reset()
    setSaved('')
    previewMutation.mutate(cursor)
  }

  function nextBatch() {
    const next = preview?.batch?.nextCursor
    if (!next || applyMutation.isPending) return
    setCursor(next)
    setBatchNumber(value => value + 1)
    setSaved('')
    applyMutation.reset()
    previewMutation.mutate(next)
  }

  async function handleApply() {
    if (!preview || !canApply) return
    try {
      await runProtectedSettingsChange(async () => {
        const result = await applyMutation.mutateAsync({
          templateIds: [...selectedTemplateIds],
          fingerprint: preview.fingerprint,
          scopeRevisions: preview.scopeRevisions,
          decisions: selectedDecisions,
          cursor: preview.batch?.cursor,
        })
        scheduleWeldDataRefresh(queryClient)
        onApplied(
          `Пересобрано документов: ${result.rebuiltDocumentCount} · затронуто стыков: ${result.affectedRowCount}`,
        )
        if (preview.batch?.nextCursor || batchNumber > 1 || blocked.length) {
          setSaved(`Пакет ${batchNumber} сохранён. Пересобрано документов: ${result.rebuiltDocumentCount}.`)
        } else onClose()
      })
    } catch {
      // The mutation renders its error inside the confirmation dialog.
    }
  }

  return (
    <LargeDialogShell maxWidthClassName="max-w-[1180px]" maxHeightClassName="h-[92vh]" overlayClassName="z-[70] bg-slate-950/30">
      <DialogHeader
        title="Пересборка системных документов"
        subtitle="Проверьте область и будущую структуру. До нажатия «Применить пересборку» данные не изменяются."
        onClose={onClose}
        closeDisabled={applyMutation.isPending}
      />

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-5">
        {previewMutation.isPending ? (
          <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Проверяю системные документы и текущие правила...
          </div>
        ) : previewError ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <p className="font-semibold">Не удалось подготовить предварительный просмотр</p>
            <p className="mt-1">{previewError}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={refreshPreview}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Повторить
            </Button>
          </div>
        ) : preview ? (
          <div className="space-y-5">
            {preview.batch ? <section className="rounded-md border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
              <p className="font-semibold">Пакет {batchNumber}: до {preview.batch.documentLimit} документов, до {preview.batch.positionLimit.toLocaleString('ru-RU')} позиций</p>
              <p className="mt-1">Все числа ниже относятся только к этому пакету. Документы не обрезаются. Каждый пакет сохраняется целиком отдельным подтверждением; при ошибке или закрытии окна ранее сохранённые пакеты остаются.</p>
              <p className="mt-1">{preview.batch.nextCursor ? 'Есть следующие документы — после проверки этого пакета перейдите к следующему.' : 'Это последний пакет текущего просмотра.'} Новые документы, появившиеся во время работы, проверяются при новом открытии окна.</p>
              {saved ? <p role="status" className="mt-2 font-semibold">{saved}</p> : null}
            </section> : null}
            {blocked.length ? <section role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-semibold">Не пересобраны из-за объёма: {blocked.length}</p>
              <RebuildItemsPage items={blocked} label="документы сверх лимита">{items => items.map(item => <p key={item.documentId}>{item.title}: {item.reason}</p>)}</RebuildItemsPage>
            </section> : null}
            <RebuildSummary
              checked={selectedDocuments.length}
              changed={changedDocuments.length}
              resulting={resultingDocumentCount}
              affectedRows={affectedRowCount}
            />

            <section className="rounded-md border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">Область пересборки</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  По умолчанию выбраны виды, где обнаружено разделение или требуется решение по пользовательскому названию.
                  {' '}ПСТО/ТВМТ включает первый и все повторные циклы. Номера циклов, даты и результаты сохраняются; НК до ТО не пересобирается.
                </p>
              </div>
              <div className="grid gap-px bg-slate-200 sm:grid-cols-2">
                {CONFIGURABLE_SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) => {
                  const documents = preview.documents.filter((document) => document.templateId === profile.id)
                  const changes = documents.filter((document) => document.willChangeAutomatically || document.requiresCustomNameDecision)
                  return (
                    <label key={profile.id} className="flex cursor-pointer items-start gap-3 bg-white px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedTemplateIds.has(profile.id)}
                        disabled={documents.length === 0 || applyMutation.isPending || Boolean(saved)}
                        onChange={() => setSelectedTemplateIds((current) => {
                          const next = new Set(current)
                          if (next.has(profile.id)) next.delete(profile.id)
                          else next.add(profile.id)
                          return next
                        })}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-800">{profile.label}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          Документов: {documents.length} · требуют внимания: {changes.length}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </section>

            <CustomNameDecisions
              documents={selectedDocuments.filter((document) => document.requiresCustomNameDecision)}
              decisions={decisions}
              disabled={applyMutation.isPending || Boolean(saved)}
              onChange={(decision) => setDecisions((current) => ({ ...current, [decision.documentId]: decision }))}
            />

            <section className="rounded-md border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">Изменения «было → станет»</h3>
                <p className="mt-1 text-xs text-slate-500">Показаны только документы, которые будут пересобраны.</p>
              </div>
              {changedDocuments.length ? (
                <div className="divide-y divide-slate-100">
                  <RebuildItemsPage items={changedDocuments} label="изменяемые документы">{visibleDocuments => visibleDocuments.map((document) => {
                    const decision = decisions[document.documentId]
                    return (
                      <div key={document.documentId} className="px-4 py-4">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-slate-700">{document.label}</span>
                          <span>{document.date || 'Без даты'}</span>
                          <span>{document.modeLabel}</span>
                        </div>
                        <div className="mt-2 grid gap-3 md:grid-cols-[minmax(0,0.8fr)_auto_minmax(0,1.2fr)] md:items-start">
                          <div className="break-words rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            {document.title}
                          </div>
                          <span className="hidden pt-2 text-slate-400 md:block">→</span>
                          <div className="space-y-1.5">
                            <RebuildItemsPage items={document.groups} label={`группы ${document.title}`}>{visibleGroups => visibleGroups.map((group) => (
                              <div key={group.key} className="rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-950">
                                <div className="font-semibold">
                                  {document.isSystemName ? group.previewName : decision?.groupNames?.[group.key] || 'Название не указано'}
                                </div>
                                <div className="mt-0.5 text-xs text-sky-700">{group.label} · стыков: {group.rowCount}</div>
                                {group.cycleSequences?.length ? <div className="mt-0.5 text-xs text-sky-700">
                                  Циклы: {group.cycleSequences.join(', ')}. {group.joints.join('; ')}{group.rowCount > 5 ? '; …' : ''}
                                </div> : null}
                              </div>
                            ))}</RebuildItemsPage>
                          </div>
                        </div>
                      </div>
                    )
                  })}</RebuildItemsPage>
                </div>
              ) : (
                <div className="px-4 py-8 text-center text-sm text-slate-500">
                  В выбранной области пока нет документов для пересборки.
                </div>
              )}
            </section>

            <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
              <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-600" />
              <p>
                Будут затронуты выбранные виды документов и указанные выше стыки. Системные имена могут быть
                пересчитаны, а для новых групп будут назначены отдельные порядковые номера. Самостоятельные старые
                документы не объединяются между собой автоматически.
              </p>
            </div>

          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4">
        {decisionError || applyError ? <div role="alert" className="mb-3 max-h-[24vh] overflow-y-auto break-words text-sm font-medium text-rose-700">
          {decisionError ? <p>{decisionError}</p> : null}
          {applyError ? <p>{applyError}</p> : null}
        </div> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" onClick={refreshPreview} disabled={previewMutation.isPending || applyMutation.isPending}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить предпросмотр
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={applyMutation.isPending}>Отмена</Button>
            {preview?.batch?.nextCursor ? <Button variant="outline" onClick={nextBatch}
              disabled={previewMutation.isPending || previewMutation.isError || applyMutation.isPending}>
              {saved || !changedDocuments.length ? 'Следующий пакет' : 'Пропустить этот пакет'}
            </Button> : null}
            <Button onClick={handleApply} disabled={!canApply}>
              {applyMutation.isPending ? 'Применяю...' : 'Применить пересборку'}
            </Button>
          </div>
        </div>
      </div>
    </LargeDialogShell>
  )
}

function rebuildFailureMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ''
  // Keep actionable validation messages, never dump a SQL query/parameters
  // into the dialog. A failed response alone does not prove transaction rollback.
  return message && !/Failed query:/i.test(message) ? message : fallback
}

function RebuildSummary({
  checked,
  changed,
  resulting,
  affectedRows,
}: {
  checked: number
  changed: number
  resulting: number
  affectedRows: number
}) {
  const items = [
    ['Проверено документов', checked],
    ['Изменится документов', changed],
    ['Станет документов', resulting],
    ['Затронуто стыков', affectedRows],
  ] as const
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className="mt-1 text-xl font-semibold text-slate-950">{value}</div>
        </div>
      ))}
    </div>
  )
}

function CustomNameDecisions({
  documents,
  decisions,
  onChange,
  disabled,
}: {
  documents: SystemDocumentRebuildPreview['documents']
  decisions: Record<number, SystemDocumentRebuildCustomDecision>
  onChange: (decision: SystemDocumentRebuildCustomDecision) => void
  disabled: boolean
}) {
  if (documents.length === 0) return null
  return (
    <section className="rounded-md border border-amber-200 bg-white">
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
        <h3 className="text-sm font-semibold text-amber-950">Пользовательские названия</h3>
        <p className="mt-1 text-xs leading-5 text-amber-900">
          Система не меняет такие документы без отдельного решения и ручных названий для каждой новой группы.
        </p>
      </div>
      <div className="divide-y divide-slate-100">
        <RebuildItemsPage items={documents} label="пользовательские документы">{visibleDocuments => visibleDocuments.map((document) => {
          const decision = decisions[document.documentId] ?? {
            documentId: document.documentId,
            action: 'keep' as const,
            groupNames: {},
          }
          return (
            <div key={document.documentId} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="break-words text-sm font-semibold text-slate-900">{document.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{document.label} · групп по новому правилу: {document.groups.length}</div>
                </div>
                <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
                  <DecisionButton
                    disabled={disabled}
                    active={decision.action === 'keep'}
                    label="Оставить как есть"
                    onClick={() => onChange({ ...decision, action: 'keep' })}
                  />
                  <DecisionButton
                    disabled={disabled}
                    active={decision.action === 'rebuild'}
                    label="Пересобрать вручную"
                    onClick={() => onChange({ ...decision, action: 'rebuild' })}
                  />
                </div>
              </div>
              {decision.action === 'rebuild' ? (
                <div className="mt-3 grid gap-2">
                  <RebuildItemsPage items={document.groups} label={`названия ${document.title}`}>{visibleGroups => visibleGroups.map((group) => (
                    <label key={group.key} className="grid gap-1.5 sm:grid-cols-[minmax(180px,0.7fr)_minmax(240px,1.3fr)] sm:items-center">
                      <span className="text-xs font-medium text-slate-600">{group.label} · {group.rowCount} ст.</span>
                      <Input
                        disabled={disabled}
                        value={decision.groupNames?.[group.key] ?? ''}
                        onChange={(event) => onChange({
                          ...decision,
                          groupNames: {
                            ...(decision.groupNames ?? {}),
                            [group.key]: event.target.value,
                          },
                        })}
                        placeholder="Название нового документа"
                      />
                    </label>
                  ))}</RebuildItemsPage>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Документ и его текущее название останутся без изменений.
                </div>
              )}
            </div>
          )
        })}</RebuildItemsPage>
      </div>
    </section>
  )
}

export function RebuildItemsPage<T>({ items, label, children }: {
  items: readonly T[]
  label: string
  children: (items: readonly T[]) => ReactNode
}) {
  const [page, setPage] = useState(0)
  const pageSize = 50
  const currentPage = Math.min(page, Math.max(0, Math.ceil(items.length / pageSize) - 1))
  const start = currentPage * pageSize
  return <>
    {children(items.slice(start, start + pageSize))}
    {items.length > pageSize ? <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-slate-600">
      <span>{start + 1}–{Math.min(start + pageSize, items.length)} из {items.length}. Применение относится ко всем выбранным группам.</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" aria-label={`Назад: ${label}`} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Назад</Button>
        <Button size="sm" variant="outline" aria-label={`Далее: ${label}`} disabled={start + pageSize >= items.length} onClick={() => setPage(currentPage + 1)}>Далее</Button>
      </div>
    </div> : null}
  </>
}

function DecisionButton({ active, label, onClick, disabled }: { active: boolean; label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-8 rounded px-2.5 text-xs font-semibold transition ${
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      {label}
    </button>
  )
}
