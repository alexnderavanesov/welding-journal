import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
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
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<SystemDocumentTemplateId>>(new Set())
  const [decisions, setDecisions] = useState<Record<number, SystemDocumentRebuildCustomDecision>>({})
  const previewMutation = useMutation({
    mutationFn: () => previewSystemDocumentRebuild({ data: {} }),
  })
  const applyMutation = useMutation({
    mutationFn: (data: Parameters<typeof applySystemDocumentRebuild>[0]['data']) =>
      applySystemDocumentRebuild({ data }),
  })

  useEffect(() => {
    if (!open) return
    setSelectedTemplateIds(new Set())
    setDecisions({})
    applyMutation.reset()
    previewMutation.mutate()
  }, [open])

  useEffect(() => {
    const preview = previewMutation.data
    if (!preview) return
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
    preview && selectedTemplateIds.size > 0 && changedDocuments.length > 0 && !decisionError && !applyMutation.isPending,
  )
  const previewError = (previewMutation.error as Error | null)?.message || ''

  function refreshPreview() {
    applyMutation.reset()
    previewMutation.mutate()
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
        })
        onApplied(
          `Пересобрано документов: ${result.rebuiltDocumentCount} · затронуто стыков: ${result.affectedRowCount}`,
        )
        onClose()
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
                        disabled={documents.length === 0}
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
              onChange={(decision) => setDecisions((current) => ({ ...current, [decision.documentId]: decision }))}
            />

            <section className="rounded-md border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">Изменения «было → станет»</h3>
                <p className="mt-1 text-xs text-slate-500">Показаны только документы, которые будут пересобраны.</p>
              </div>
              {changedDocuments.length ? (
                <div className="divide-y divide-slate-100">
                  {changedDocuments.slice(0, 100).map((document) => {
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
                            {document.groups.map((group) => (
                              <div key={group.key} className="rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-950">
                                <div className="font-semibold">
                                  {document.isSystemName ? group.previewName : decision?.groupNames?.[group.key] || 'Название не указано'}
                                </div>
                                <div className="mt-0.5 text-xs text-sky-700">{group.label} · стыков: {group.rowCount}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  })}
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

            {decisionError ? <p className="text-sm font-medium text-rose-700">{decisionError}</p> : null}
            {applyMutation.error ? <p className="text-sm font-medium text-rose-700">{(applyMutation.error as Error).message}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4">
        <Button variant="outline" onClick={refreshPreview} disabled={previewMutation.isPending || applyMutation.isPending}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Обновить предпросмотр
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={applyMutation.isPending}>Отмена</Button>
          <Button onClick={handleApply} disabled={!canApply}>
            {applyMutation.isPending ? 'Применяю...' : 'Применить пересборку'}
          </Button>
        </div>
      </div>
    </LargeDialogShell>
  )
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
}: {
  documents: SystemDocumentRebuildPreview['documents']
  decisions: Record<number, SystemDocumentRebuildCustomDecision>
  onChange: (decision: SystemDocumentRebuildCustomDecision) => void
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
        {documents.map((document) => {
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
                    active={decision.action === 'keep'}
                    label="Оставить как есть"
                    onClick={() => onChange({ ...decision, action: 'keep' })}
                  />
                  <DecisionButton
                    active={decision.action === 'rebuild'}
                    label="Пересобрать вручную"
                    onClick={() => onChange({ ...decision, action: 'rebuild' })}
                  />
                </div>
              </div>
              {decision.action === 'rebuild' ? (
                <div className="mt-3 grid gap-2">
                  {document.groups.map((group) => (
                    <label key={group.key} className="grid gap-1.5 sm:grid-cols-[minmax(180px,0.7fr)_minmax(240px,1.3fr)] sm:items-center">
                      <span className="text-xs font-medium text-slate-600">{group.label} · {group.rowCount} ст.</span>
                      <Input
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
                  ))}
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Документ и его текущее название останутся без изменений.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function DecisionButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-8 rounded px-2.5 text-xs font-semibold transition ${
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      {label}
    </button>
  )
}
