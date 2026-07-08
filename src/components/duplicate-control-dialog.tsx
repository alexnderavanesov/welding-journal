import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Check, ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react'

import { DialogCloseFooter } from '@/components/dialog-close-footer'
import { DialogEmptyState } from '@/components/dialog-empty-state'
import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { ResultBadge } from '@/lib/weld-table-badges'
import { getDuplicateControls } from '@/lib/duplicate-control-utils'
import { isUnofficialJoint } from '@/lib/joint-display'
import {
  DUPLICATE_CONTROL_METHODS,
  DUPLICATE_CONTROL_RESULTS,
  type DuplicateControlDraft,
  type DuplicateControlMethod,
  type DuplicateControlRecord,
  type DuplicateControlResult,
} from '@/lib/duplicate-control-types'
import type { WeldRow } from '@/lib/dispatcher-types'
import { calculateFinalStatus, formatFinalStatusDisplay } from '@/lib/weld-status'

export type DuplicateControlDialogProps = {
  draft: DuplicateControlDraft
  filteredRows: WeldRow[]
  selectedRows: WeldRow[]
  allRows: WeldRow[]
  controls: DuplicateControlRecord[]
  saveBlockReason: string | null
  isSaving: boolean
  onClose: () => void
  onSave: () => void
  onDelete: (control: DuplicateControlRecord) => void
  onEdit: (control: DuplicateControlRecord) => void
  onDraftChange: Dispatch<SetStateAction<DuplicateControlDraft>>
  onToggleRow: (rowId: number) => void
  onSetVisibleRowsSelected: (selected: boolean) => void
  onToggleMethod: (method: DuplicateControlMethod) => void
}

export function DuplicateControlDialog({
  draft,
  filteredRows,
  selectedRows,
  allRows,
  controls,
  saveBlockReason,
  isSaving,
  onClose,
  onSave,
  onDelete,
  onEdit,
  onDraftChange,
  onToggleRow,
  onSetVisibleRowsSelected,
  onToggleMethod,
}: DuplicateControlDialogProps) {
  const isEditing = typeof draft.id === 'number'
  const [showExistingControls, setShowExistingControls] = useState(false)
  const [showSelectedPreview, setShowSelectedPreview] = useState(false)
  const rowsById = new Map([...allRows, ...filteredRows, ...selectedRows].map((row) => [row.id, row]))
  const existingControls = useMemo(
    () => getUniqueDuplicateControls([...controls, ...allRows.flatMap((row) => getDuplicateControls(row))]),
    [allRows, controls],
  )
  const handleEditControl = (control: DuplicateControlRecord) => {
    setShowExistingControls(false)
    setShowSelectedPreview(false)
    onEdit(control)
  }

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[1240px]"
      maxHeightClassName="h-[88vh]"
      overlayClassName="z-[75] bg-slate-950/25"
      panelShadowClassName="shadow-slate-950/10"
    >
      <DialogHeader
        title={isEditing ? 'Редактирование дубль-контроля' : 'Дубль контроль'}
        subtitle="Контроль заказчика без заявки. Негодный дубль влияет на итоговый статус и цепочку как обычный негодный результат."
        onClose={onClose}
      />

      {showExistingControls ? (
        <section className="min-h-0 flex-1 overflow-hidden px-6 py-5">
          <DuplicateControlList controls={existingControls} rowsById={rowsById} onEdit={handleEditControl} onDelete={onDelete} fill />
        </section>
      ) : (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="min-h-0 space-y-4 overflow-y-auto">
          <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">1. Метод и результат</h3>
            <p className="mt-1 text-xs text-slate-500">
              Можно выбрать один или несколько методов. При редактировании меняется одна запись.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {DUPLICATE_CONTROL_METHODS.map((method) => {
                const selected = draft.methods.has(method)
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => onToggleMethod(method)}
                    disabled={isEditing && !selected}
                    className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                      selected
                        ? 'border-sky-300 bg-sky-50 text-sky-900 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200'
                    } ${isEditing && !selected ? 'cursor-not-allowed opacity-50 hover:border-slate-200' : ''}`}
                  >
                    {method}
                  </button>
                )
              })}
            </div>

            <label className="mt-4 block text-xs font-semibold text-slate-600">
              Результат
              <select
                value={draft.result}
                onChange={(event) =>
                  onDraftChange((current) => ({
                    ...current,
                    result: event.target.value as DuplicateControlResult | '',
                  }))
                }
                className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              >
                <option value="" className="font-normal">
                  Выберите результат
                </option>
                {DUPLICATE_CONTROL_RESULTS.map((result) => (
                  <option key={result} value={result} className="font-normal">
                    {result}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">2. Дата и заключение</h3>
            <div className="mt-3 space-y-3">
              <label className="block text-xs font-semibold text-slate-600">
                Дата контроля
                <input
                  value={draft.controlDate}
                  onChange={(event) => onDraftChange((current) => ({ ...current, controlDate: event.target.value }))}
                  placeholder="08.07.2026"
                  className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Заключение
                <input
                  value={draft.conclusion}
                  onChange={(event) => onDraftChange((current) => ({ ...current, conclusion: event.target.value }))}
                  placeholder="Номер заключения заказчика"
                  className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Дата заключения
                <input
                  value={draft.conclusionDate}
                  onChange={(event) => onDraftChange((current) => ({ ...current, conclusionDate: event.target.value }))}
                  placeholder="08.07.2026"
                  className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
              </label>
            </div>
          </section>

          <section className="rounded-md border border-sky-100 bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-800">
            Дубль-контроль не создает заявку ЛНК. Если результат дубля «ремонт» или «вырез», стык становится негодным по дублю,
            а диспетчер предложит следующий стык с индексом R или W соответственно.
          </section>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Стыки</h3>
              <p className="text-xs text-muted-foreground">Выберите стык для дубль-контроля. При создании можно выбрать несколько стыков.</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onSetVisibleRowsSelected(true)} disabled={isEditing || filteredRows.length === 0}>
                Выбрать найденные
              </Button>
              <Button type="button" variant="outline" onClick={() => onSetVisibleRowsSelected(false)} disabled={isEditing || draft.rowIds.size === 0}>
                Снять выбор
              </Button>
            </div>
          </div>

          <div className="mb-3 flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              value={draft.search}
              onChange={(event) => onDraftChange((current) => ({ ...current, search: event.target.value }))}
              placeholder="Проект, шифр, линия, спул или стык"
              className="h-10 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
            />
            <span className="shrink-0 text-xs text-slate-500">
              Найдено: {filteredRows.length} · Выбрано: {draft.rowIds.size}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-200">
            {filteredRows.length === 0 ? (
              <DialogEmptyState minHeightClassName="min-h-60">По фильтру ничего не найдено.</DialogEmptyState>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredRows.map((row) => {
                  const rowControls = getDuplicateControls(row)
                  const finalStatus = calculateFinalStatus(row)
                  const finalStatusDisplay = formatFinalStatusDisplay(row, finalStatus)
                  const isUnofficial = isUnofficialJoint(row)
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => !isEditing && onToggleRow(row.id)}
                      disabled={isEditing && !draft.rowIds.has(row.id)}
                      className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition ${
                        draft.rowIds.has(row.id) ? 'bg-sky-50' : 'bg-white hover:bg-slate-50'
                      } ${isEditing && !draft.rowIds.has(row.id) ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{String(row.joint ?? '-')}</span>
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                              isUnofficial
                                ? 'border-slate-300 bg-slate-100 text-slate-700'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            }`}
                          >
                            {isUnofficial ? 'неофициальный' : 'официальный'}
                          </span>
                          <ResultBadge value={finalStatusDisplay} />
                        </span>
                        <span className="block text-xs text-slate-500">
                          {String(row.projectTitle ?? '-')} · {String(row.subtitleCode ?? '-')} ·{' '}
                          {String(row.line ?? '-')} · D: {String(row.d1 ?? '-') || '-'} · WDI: {String(row.wdi ?? '-') || '-'} · дата сварки:{' '}
                          {String(row.weldDate ?? '-') || '-'}
                        </span>
                        {rowControls.length > 0 ? (
                          <span className="mt-2 flex flex-wrap gap-1">
                            {rowControls.map((control) => (
                              <span
                                key={control.id}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600"
                              >
                                <span className="font-semibold">{control.method}</span>
                                <span className="text-slate-400">дубль</span>
                                <ResultBadge value={control.result} />
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs text-slate-500">{draft.rowIds.has(row.id) ? 'выбран' : ''}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>
      )}

      <div className="border-t border-slate-200/80 px-6 py-4">
        <div className="mb-4">
          <button
            type="button"
            onClick={() => {
              setShowExistingControls((current) => !current)
              setShowSelectedPreview(false)
            }}
            className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-colors hover:border-sky-200 hover:bg-sky-50"
          >
            <span>
              <span className="block text-sm font-semibold text-slate-900">Внесенные дубли</span>
              <span className="text-xs text-slate-500">
                {existingControls.length > 0 ? `${existingControls.length} записей` : 'пока нет записей'}
              </span>
            </span>
            {showExistingControls ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronUp className="h-4 w-4 text-slate-500" />}
          </button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-slate-500">
            {saveBlockReason ? saveBlockReason : `Будет сохранено: ${selectedRows.length * draft.methods.size}`}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowSelectedPreview(true)}
              disabled={selectedRows.length === 0 || showExistingControls}
            >
              {`Предпросмотр (${selectedRows.length})`}
            </Button>
            <Button onClick={onSave} disabled={Boolean(saveBlockReason) || isSaving}>
              <Check className="mr-2 h-4 w-4" />
              {isEditing ? 'Сохранить дубль' : 'Добавить дубль'}
            </Button>
          </div>
        </div>
      </div>
      {showSelectedPreview ? (
        <DuplicateControlPreviewDialog rows={selectedRows} draft={draft} onClose={() => setShowSelectedPreview(false)} />
      ) : null}
    </LargeDialogShell>
  )
}

function getUniqueDuplicateControls(controls: DuplicateControlRecord[]) {
  const seenIds = new Set<number>()
  return controls.filter((control) => {
    if (seenIds.has(control.id)) return false
    seenIds.add(control.id)
    return true
  })
}

function DuplicateControlPreviewDialog({
  rows,
  draft,
  onClose,
}: {
  rows: WeldRow[]
  draft: DuplicateControlDraft
  onClose: () => void
}) {
  const methods = Array.from(draft.methods)
  const resultLabel = draft.result || 'результат не выбран'

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-4xl"
      maxHeightClassName="max-h-[86vh]"
      overlayClassName="z-[85] bg-slate-950/25"
    >
      <DialogHeader
        title="Предпросмотр выбранных стыков"
        subtitle={`Методы: ${methods.length > 0 ? methods.join(', ') : '-'} · Результат: ${resultLabel} · Выбрано: ${rows.length}`}
        onClose={onClose}
        closeLabel="Закрыть предпросмотр"
      />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {rows.length === 0 ? (
          <DialogEmptyState minHeightClassName="min-h-40">Нет выбранных стыков.</DialogEmptyState>
        ) : (
          <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {rows.map((row) => {
              const finalStatus = calculateFinalStatus(row)
              const finalStatusDisplay = formatFinalStatusDisplay(row, finalStatus)
              const isUnofficial = isUnofficialJoint(row)
              return (
                <div key={row.id} className="flex items-start justify-between gap-3 bg-white px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{String(row.joint ?? '-')}</span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                          isUnofficial
                            ? 'border-slate-300 bg-slate-100 text-slate-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {isUnofficial ? 'неофициальный' : 'официальный'}
                      </span>
                      <ResultBadge value={finalStatusDisplay} />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {String(row.projectTitle ?? '-')} · {String(row.subtitleCode ?? '-')} · {String(row.line ?? '-')} · D:{' '}
                      {String(row.d1 ?? '-') || '-'} · WDI: {String(row.wdi ?? '-') || '-'} · дата сварки:{' '}
                      {String(row.weldDate ?? '-') || '-'}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {methods.length > 0 ? (
                      methods.map((method) => (
                        <span
                          key={method}
                          className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-800"
                        >
                          <span className="font-semibold">{method}</span>
                          <span>дубль</span>
                          {draft.result ? <ResultBadge value={draft.result} /> : null}
                        </span>
                      ))
                    ) : (
                      <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-500">метод не выбран</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <DialogCloseFooter onClose={onClose} />
    </LargeDialogShell>
  )
}

function DuplicateControlList({
  controls,
  fill = false,
  onDelete,
  onEdit,
  rowsById,
}: {
  controls: DuplicateControlRecord[]
  fill?: boolean
  onDelete: (control: DuplicateControlRecord) => void
  onEdit: (control: DuplicateControlRecord) => void
  rowsById: Map<number, WeldRow>
}) {
  return (
    <div className={`overflow-y-auto rounded-md border border-slate-200 ${fill ? 'h-full' : 'max-h-36'}`}>
      {controls.length === 0 ? (
        <div className="px-3 py-3 text-sm text-slate-500">Пока нет дубль-контроля.</div>
      ) : (
        controls.map((control) => {
          const row = rowsById.get(control.weldJointId)
          return (
            <div key={control.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0">
              <div className="min-w-0 text-sm">
                <span className="mr-2 font-semibold text-slate-900">{String(row?.joint ?? `#${control.weldJointId}`)}</span>
                <span className="font-medium text-slate-900">{control.method}</span> <ResultBadge value={control.result} />{' '}
                <span className="text-slate-500">
                  дата: {control.controlDate || '-'} · заключение: {control.conclusion || '-'}
                </span>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onEdit(control)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Изменить
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-rose-200 text-rose-700 hover:bg-rose-50"
                  onClick={() => onDelete(control)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Удалить
                </Button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
