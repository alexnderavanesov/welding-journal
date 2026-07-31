import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Check, ChevronRight, MousePointer2, Plus, Save, Trash2, X } from 'lucide-react'

import { LargeDialogShell } from '@/components/large-dialog-shell'
import {
  readDocumentTemplateWorkbookPreview,
  type DocumentTemplateBindingMode,
  type DocumentTemplateCellBinding,
  type DocumentTemplateCellPart,
  type DocumentTemplateConstructorConfig,
  type DocumentTemplateFieldKey,
  type DocumentTemplateWorkbookPreview,
  type StoredDocumentTemplate,
} from '@/lib/document-template-storage'
import { WELD_FIELDS } from '@/lib/weld-fields'
import { STAMP_NAME_TEMPLATE_FIELDS } from '@/lib/welder-stamp-names'

type DocumentTemplateBuilderProps = {
  template: StoredDocumentTemplate
  onClose: () => void
  onSave: (config: DocumentTemplateConstructorConfig) => Promise<boolean>
}

const MODE_OPTIONS: Array<{ value: DocumentTemplateBindingMode; label: string; description: string }> = [
  { value: 'row', label: 'Поле одного стыка', description: 'Ячейка повторяется для каждого выбранного стыка.' },
  { value: 'list', label: 'Все значения', description: 'Все значения попадут в одну ячейку.' },
  { value: 'uniqueList', label: 'Уникальные значения', description: 'Повторы будут удалены.' },
  { value: 'count', label: 'Количество стыков', description: 'Количество выбранных строк.' },
  { value: 'sum', label: 'Сумма', description: 'Сумма выбранного числового поля.' },
]

const SPECIAL_FIELDS: Array<{ key: DocumentTemplateFieldKey; label: string; group: string }> = [
  { key: '__index', label: '№ п/п', group: 'Системные поля' },
  ...STAMP_NAME_TEMPLATE_FIELDS.map((field) => ({
    key: `__welderName:${field.key}` as DocumentTemplateFieldKey,
    label: `${field.label} ФИО сварщика`,
    group: 'ФИО по официальному клейму',
  })),
]

const FIELD_OPTIONS = [
  ...SPECIAL_FIELDS,
  ...WELD_FIELDS.map((field) => ({
    key: field.key as DocumentTemplateFieldKey,
    label: field.label,
    group: field.group,
  })),
]

function getColumnLabel(column: number) {
  let value = ''
  let current = column
  while (current > 0) {
    const remainder = (current - 1) % 26
    value = String.fromCharCode(65 + remainder) + value
    current = Math.floor((current - 1) / 26)
  }
  return value
}

function getCellRow(address: string) {
  return Number(address.match(/\d+$/)?.[0] ?? 0)
}

function getCellColumn(address: string) {
  const letters = address.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A'
  return letters.split('').reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0)
}

function replaceCellRow(address: string, row: number) {
  return `${address.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A'}${row}`
}

function getBindingParts(binding: DocumentTemplateCellBinding | undefined): DocumentTemplateCellPart[] {
  if (binding?.parts?.length) return binding.parts
  return binding?.field ? [{ field: binding.field }] : []
}

export function DocumentTemplateBuilder({ template, onClose, onSave }: DocumentTemplateBuilderProps) {
  const [preview, setPreview] = useState<DocumentTemplateWorkbookPreview | null>(null)
  const [draft, setDraft] = useState<DocumentTemplateConstructorConfig>(
    template.constructorConfig ?? {
      version: 1,
      sheetName: template.sheetNames?.[0] ?? '',
      bindings: [],
    },
  )
  const [selectedCell, setSelectedCell] = useState(template.constructorConfig?.bindings[0]?.cell ?? '')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    setIsLoading(true)
    readDocumentTemplateWorkbookPreview(template, draft.sheetName)
      .then((nextPreview) => {
        if (!mounted) return
        setPreview(nextPreview)
        setDraft((current) => ({
          ...current,
          sheetName: nextPreview.sheetName,
        }))
        setSelectedCell((current) => current || nextPreview.cells[0]?.address || 'A1')
      })
      .catch((reason) => {
        if (mounted) setError(reason instanceof Error ? reason.message : 'Не удалось открыть Excel-шаблон.')
      })
      .finally(() => {
        if (mounted) setIsLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [template, draft.sheetName])

  const selectedBinding = draft.bindings.find((binding) => binding.cell === selectedCell)
  const bindingsByCell = useMemo(
    () => new Map(draft.bindings.map((binding) => [binding.cell, binding])),
    [draft.bindings],
  )
  const fieldGroups = useMemo(() => {
    const groups = new Map<string, typeof FIELD_OPTIONS>()
    for (const field of FIELD_OPTIONS) {
      const values = groups.get(field.group) ?? []
      values.push(field)
      groups.set(field.group, values)
    }
    return Array.from(groups.entries())
  }, [])

  const setRepeatRow = (row: number) => {
    const shouldMoveSelection = selectedBinding?.mode === 'row'
    setDraft((current) => ({
      ...current,
      repeatRow: row,
      bindings: current.bindings.map((binding) =>
        binding.mode === 'row' ? { ...binding, cell: replaceCellRow(binding.cell, row) } : binding,
      ),
    }))
    if (shouldMoveSelection) setSelectedCell((current) => replaceCellRow(current, row))
  }

  const updateSelectedBinding = (patch: Partial<DocumentTemplateCellBinding>) => {
    if (!selectedCell) return
    setDraft((current) => {
      const existing = current.bindings.find((binding) => binding.cell === selectedCell)
      const nextBinding: DocumentTemplateCellBinding = {
        cell: selectedCell,
        mode: existing?.mode ?? (current.repeatRow === getCellRow(selectedCell) ? 'row' : 'uniqueList'),
        emptyMode: existing?.emptyMode ?? 'blank',
        separator: existing?.separator ?? 'comma',
        ...existing,
        ...patch,
      }
      return {
        ...current,
        bindings: [...current.bindings.filter((binding) => binding.cell !== selectedCell), nextBinding],
      }
    })
  }

  const updateSelectedParts = (parts: DocumentTemplateCellPart[]) => {
    updateSelectedBinding({
      parts,
      field: undefined,
    })
  }

  const changeSelectedBindingMode = (mode: DocumentTemplateBindingMode) => {
    if (!selectedBinding) return
    if (mode === 'row') {
      const parts = getBindingParts(selectedBinding)
      updateSelectedBinding({
        mode,
        parts,
        field: undefined,
      })
      return
    }
    updateSelectedBinding({
      mode,
      field: selectedBinding.field ?? getBindingParts(selectedBinding)[0]?.field,
      parts: undefined,
      uniqueParts: undefined,
    })
  }

  const removeSelectedBinding = () => {
    setDraft((current) => ({
      ...current,
      bindings: current.bindings.filter((binding) => binding.cell !== selectedCell),
    }))
  }

  const validate = () => {
    if (!draft.sheetName) return 'Выберите лист шаблона.'
    if (!draft.bindings.length) return 'Назначьте хотя бы одну ячейку.'
    const rowBindings = draft.bindings.filter((binding) => binding.mode === 'row')
    if (rowBindings.length && !draft.repeatRow) return 'Выберите повторяемую строку.'
    if (rowBindings.some((binding) => getCellRow(binding.cell) !== draft.repeatRow)) {
      return 'Все поля одного стыка должны находиться в повторяемой строке.'
    }
    if (
      draft.repeatRow &&
      draft.bindings.some((binding) => binding.mode !== 'row' && getCellRow(binding.cell) >= draft.repeatRow!)
    ) {
      return 'Сводные ячейки должны находиться выше повторяемой строки.'
    }
    if (
      draft.bindings.some((binding) =>
        binding.mode === 'row'
          ? getBindingParts(binding).length === 0
          : binding.mode !== 'count' && !binding.field,
      )
    ) {
      return 'Для каждой назначенной ячейки выберите поле.'
    }
    return null
  }

  const handleSave = async () => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      if (await onSave(draft)) onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить настройки конструктора.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <LargeDialogShell maxWidthClassName="max-w-[1500px]" maxHeightClassName="max-h-[94vh]" overlayClassName="z-[90] bg-slate-950/35">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">Конструктор шаблона</h3>
          <p className="mt-1 text-sm text-slate-500">
            Выберите строку-пример, затем нажимайте на ячейки и назначайте данные без ручных маркеров.
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Закрыть">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-h-0 overflow-auto bg-slate-100/70 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
            <label className="text-xs font-semibold uppercase text-slate-500">Лист</label>
            <select
              value={draft.sheetName}
              onChange={(event) => {
                setSelectedCell('')
                setDraft({ version: 1, sheetName: event.target.value, bindings: [] })
              }}
              className="h-9 rounded-md border-slate-300 py-1 text-sm"
            >
              {(preview?.sheetNames ?? template.sheetNames ?? []).map((sheetName) => (
                <option key={sheetName} value={sheetName}>
                  {sheetName}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">
              Строка с синей меткой повторится для каждого выбранного стыка.
            </span>
          </div>

          {isLoading ? (
            <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Открываю Excel...</div>
          ) : preview ? (
            <div className="overflow-auto rounded-md border border-slate-300 bg-white shadow-sm">
              <table className="border-separate border-spacing-0 text-xs text-slate-700">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th className="sticky left-0 z-30 h-8 min-w-12 border-b border-r border-slate-300 bg-slate-200" />
                    {Array.from({ length: preview.columnCount }, (_, index) => preview.startColumn + index).map((column) => (
                      <th key={column} className="h-8 min-w-28 border-b border-r border-slate-300 bg-slate-200 px-2 font-semibold text-slate-600">
                        {getColumnLabel(column)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: preview.rowCount }, (_, index) => preview.startRow + index).map((row) => {
                    const cells = preview.cells
                      .filter((cell) => cell.row === row)
                      .sort((left, right) => left.column - right.column)
                    return (
                      <tr key={row} className={draft.repeatRow === row ? 'bg-sky-50' : undefined}>
                        <th className="sticky left-0 z-10 border-b border-r border-slate-300 bg-slate-100 p-1">
                          <button
                            type="button"
                            onClick={() => setRepeatRow(row)}
                            title="Сделать строкой-примером"
                            className={`flex h-7 w-full items-center justify-center rounded text-xs font-semibold ${
                              draft.repeatRow === row ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-200'
                            }`}
                          >
                            {row}
                          </button>
                        </th>
                        {cells.map((cell) => {
                          const binding = bindingsByCell.get(cell.address)
                          const selected = selectedCell === cell.address
                          return (
                            <td
                              key={cell.address}
                              rowSpan={cell.rowSpan}
                              colSpan={cell.columnSpan}
                              onClick={() => setSelectedCell(cell.address)}
                              className={`relative h-11 max-w-60 cursor-pointer border-b border-r border-slate-200 px-2 py-1 align-middle ${
                                selected
                                  ? 'bg-sky-100 ring-2 ring-inset ring-sky-500'
                                  : binding
                                    ? 'bg-emerald-50 hover:bg-emerald-100'
                                    : 'bg-white hover:bg-slate-50'
                              }`}
                            >
                              <div className="line-clamp-2 min-w-24 whitespace-pre-line">{cell.value}</div>
                              {binding ? (
                                <span className="absolute right-1 top-1 rounded-full bg-emerald-600 p-0.5 text-white">
                                  <Check className="h-2.5 w-2.5" />
                                </span>
                              ) : null}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {preview.truncated ? (
                <div className="sticky bottom-0 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Для быстрого конструктора показаны первые 80 строк и 40 столбцов. Исходный файл при формировании не обрезается.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="min-h-0 overflow-auto border-l border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <MousePointer2 className="h-4 w-4 text-sky-700" />
            <div className="text-sm font-semibold text-slate-900">Выбранная ячейка</div>
            <span className="ml-auto rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">{selectedCell || '—'}</span>
          </div>

          {!selectedCell ? (
            <div className="mt-4 rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              Нажмите на нужную ячейку Excel.
            </div>
          ) : selectedBinding ? (
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500">Как заполнять</span>
                <select
                  value={selectedBinding.mode}
                  onChange={(event) => changeSelectedBindingMode(event.target.value as DocumentTemplateBindingMode)}
                  className="mt-1 w-full rounded-md border-slate-300 text-sm"
                >
                  {MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  {MODE_OPTIONS.find((option) => option.value === selectedBinding.mode)?.description}
                </span>
              </label>

              {selectedBinding.mode === 'row' ? (
                <CellPartsEditor
                  parts={getBindingParts(selectedBinding)}
                  uniqueParts={Boolean(selectedBinding.uniqueParts)}
                  fieldGroups={fieldGroups}
                  onChange={updateSelectedParts}
                  onUniquePartsChange={(uniqueParts) => updateSelectedBinding({ uniqueParts })}
                />
              ) : selectedBinding.mode !== 'count' ? (
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-slate-500">Поле системы</span>
                  <select
                    value={selectedBinding.field ?? ''}
                    onChange={(event) => updateSelectedBinding({ field: event.target.value as DocumentTemplateFieldKey })}
                    className="mt-1 w-full rounded-md border-slate-300 text-sm"
                  >
                    <option value="">Выберите поле</option>
                    {fieldGroups.map(([group, fields]) => (
                      <optgroup key={group} label={group}>
                        {fields.map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              ) : null}

              {selectedBinding.mode === 'list' || selectedBinding.mode === 'uniqueList' ? (
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">Разделитель</div>
                  <div className="mt-2 grid grid-cols-3 gap-1">
                    {[
                      ['comma', 'Запятая'],
                      ['newline', 'Новая строка'],
                      ['custom', 'Свой'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => updateSelectedBinding({ separator: value as DocumentTemplateCellBinding['separator'] })}
                        className={`rounded-md border px-2 py-2 text-xs ${
                          selectedBinding.separator === value
                            ? 'border-sky-300 bg-sky-50 text-sky-800'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {selectedBinding.separator === 'custom' ? (
                    <input
                      value={selectedBinding.customSeparator ?? ''}
                      onChange={(event) => updateSelectedBinding({ customSeparator: event.target.value })}
                      placeholder="Например: ; "
                      className="mt-2 w-full rounded-md border-slate-300 text-sm"
                    />
                  ) : null}
                </div>
              ) : null}

              {selectedBinding.mode !== 'count' && selectedBinding.mode !== 'sum' ? (
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">Если значение пустое</div>
                  <select
                    value={selectedBinding.emptyMode ?? 'blank'}
                    onChange={(event) =>
                      updateSelectedBinding({ emptyMode: event.target.value as DocumentTemplateCellBinding['emptyMode'] })
                    }
                    className="mt-1 w-full rounded-md border-slate-300 text-sm"
                  >
                    <option value="blank">Оставить пусто</option>
                    <option value="np">Написать «н/п»</option>
                    <option value="custom">Свой текст</option>
                  </select>
                  {selectedBinding.emptyMode === 'custom' ? (
                    <input
                      value={selectedBinding.emptyText ?? ''}
                      onChange={(event) => updateSelectedBinding({ emptyText: event.target.value })}
                      placeholder="Текст для пустого значения"
                      className="mt-2 w-full rounded-md border-slate-300 text-sm"
                    />
                  ) : null}
                </div>
              ) : null}

              {selectedBinding.mode === 'row' && draft.repeatRow !== getCellRow(selectedCell) ? (
                <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Эта ячейка находится не в строке-примере. Выберите строку {getCellRow(selectedCell)} слева или смените режим.
                </div>
              ) : null}

              <button
                type="button"
                onClick={removeSelectedBinding}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4" />
                Убрать назначение
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600">
                Ячейка пока остается как в исходном Excel.
              </div>
              <button
                type="button"
                onClick={() => updateSelectedBinding({})}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100"
              >
                Назначить данные
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="mt-6 border-t border-slate-200 pt-4">
            <div className="text-xs text-slate-500">
              Назначено ячеек: <span className="font-semibold text-slate-800">{draft.bindings.length}</span>
              {draft.repeatRow ? <> · строка-пример: <span className="font-semibold text-slate-800">{draft.repeatRow}</span></> : null}
            </div>
          </div>
        </aside>
      </div>

      <div className="flex items-center gap-3 border-t border-slate-200 px-5 py-3">
        {error ? (
          <div className="mr-auto flex min-w-0 items-center gap-2 text-sm text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        ) : (
          <div className="mr-auto text-xs text-slate-500">Изменяется только правило заполнения. Исходный Excel остается без изменений.</div>
        )}
        <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Отмена
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-md border border-sky-700 bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {isSaving ? 'Сохраняю...' : 'Сохранить конструктор'}
        </button>
      </div>
    </LargeDialogShell>
  )
}

function CellPartsEditor({
  parts,
  uniqueParts,
  fieldGroups,
  onChange,
  onUniquePartsChange,
}: {
  parts: DocumentTemplateCellPart[]
  uniqueParts: boolean
  fieldGroups: Array<[string, typeof FIELD_OPTIONS]>
  onChange: (parts: DocumentTemplateCellPart[]) => void
  onUniquePartsChange: (checked: boolean) => void
}) {
  const updatePart = (index: number, patch: Partial<DocumentTemplateCellPart>) => {
    onChange(parts.map((part, partIndex) => (partIndex === index ? { ...part, ...patch } : part)))
  }

  const movePart = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= parts.length) return
    const nextParts = [...parts]
    const [part] = nextParts.splice(index, 1)
    nextParts.splice(targetIndex, 0, part)
    onChange(nextParts)
  }

  const preview = parts
    .map((part) => {
      const label = FIELD_OPTIONS.find((field) => field.key === part.field)?.label ?? 'Поле'
      return `${part.prefix ?? ''}[${label}]${part.suffix ?? ''}${part.lineBreakAfter ? '\n' : ''}`
    })
    .join('')
    .replace(/\n+$/, '')

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-semibold uppercase text-slate-500">Содержимое ячейки</div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Части собираются сверху вниз. Текст до и после поля выводится только когда само поле заполнено.
        </p>
      </div>

      <div className="space-y-2">
        {parts.map((part, index) => (
          <div key={`${part.field}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
            <div className="mb-2 flex items-center gap-1">
              <span className="text-xs font-semibold text-slate-700">Часть {index + 1}</span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => movePart(index, -1)}
                  disabled={index === 0}
                  className="rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30"
                  aria-label={`Поднять часть ${index + 1}`}
                  title="Поднять"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => movePart(index, 1)}
                  disabled={index === parts.length - 1}
                  className="rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30"
                  aria-label={`Опустить часть ${index + 1}`}
                  title="Опустить"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onChange(parts.filter((_, partIndex) => partIndex !== index))}
                  className="rounded p-1 text-rose-600 hover:bg-rose-50"
                  aria-label={`Удалить часть ${index + 1}`}
                  title="Удалить часть"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <select
              value={part.field}
              onChange={(event) => updatePart(index, { field: event.target.value as DocumentTemplateFieldKey })}
              className="w-full rounded-md border-slate-300 text-sm"
            >
              {fieldGroups.map(([group, fields]) => (
                <optgroup key={group} label={group}>
                  {fields.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <label>
                <span className="text-[11px] font-medium text-slate-500">Текст перед</span>
                <input
                  value={part.prefix ?? ''}
                  onChange={(event) => updatePart(index, { prefix: event.target.value })}
                  placeholder="Например: ст. "
                  className="mt-1 w-full rounded-md border-slate-300 px-2 py-1.5 text-xs"
                />
              </label>
              <label>
                <span className="text-[11px] font-medium text-slate-500">Текст после</span>
                <input
                  value={part.suffix ?? ''}
                  onChange={(event) => updatePart(index, { suffix: event.target.value })}
                  placeholder="Например: , "
                  className="mt-1 w-full rounded-md border-slate-300 px-2 py-1.5 text-xs"
                />
              </label>
            </div>

            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={Boolean(part.lineBreakAfter)}
                onChange={(event) => updatePart(index, { lineBreakAfter: event.target.checked })}
                className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              Перенести следующую часть на новую строку
            </label>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onChange([...parts, { field: '__index' }])}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100"
      >
        <Plus className="h-4 w-4" />
        Добавить поле в ячейку
      </button>

      <label className="flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs leading-5 text-slate-600">
        <input
          type="checkbox"
          checked={uniqueParts}
          onChange={(event) => onUniquePartsChange(event.target.checked)}
          className="mt-0.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
        />
        <span>
          <span className="block font-semibold text-slate-700">Не повторять одинаковые значения</span>
          Если одно клеймо или ФИО встречается в нескольких слоях, оно будет записано один раз.
        </span>
      </label>

      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="text-[11px] font-semibold uppercase text-slate-400">Схема ячейки</div>
        <div className="mt-1 whitespace-pre-line text-xs leading-5 text-slate-700">{preview || 'Добавьте хотя бы одно поле.'}</div>
      </div>
    </div>
  )
}
