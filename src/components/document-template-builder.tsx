import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  FileText,
  MousePointer2,
  Plus,
  RotateCcw,
  Save,
  TableProperties,
  Trash2,
  X,
} from 'lucide-react'

import { LargeDialogShell } from '@/components/large-dialog-shell'
import {
  createDefaultDocumentTemplateNameConfig,
  readDocumentTemplateWorkbookPreview,
  normalizeDocumentTemplateConstructorConfig,
  type DocumentTemplateBindingMode,
  type DocumentTemplateCellBinding,
  type DocumentTemplateCellPart,
  type DocumentTemplateConstructorConfig,
  type DocumentTemplateFieldKey,
  type DocumentTemplateNameFieldKey,
  type DocumentTemplateNamePart,
  type DocumentTemplateWorkbookPreview,
  type StoredDocumentTemplate,
} from '@/lib/document-template-storage'
import { isGeneratedDocumentFieldKey } from '@/lib/generated-document-types'
import { isSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { WELD_FIELDS, isVirtualWeldField, type WeldInput } from '@/lib/weld-fields'
import { STAMP_NAME_TEMPLATE_FIELDS } from '@/lib/welder-stamp-names'

type DocumentTemplateBuilderProps = {
  template: StoredDocumentTemplate
  onClose: () => void
  onSave: (config: DocumentTemplateConstructorConfig) => Promise<boolean>
}

const SPECIAL_FIELDS: Array<{ key: DocumentTemplateFieldKey; label: string; group: string }> = [
  { key: '__index', label: '№ п/п', group: 'Системные поля' },
  { key: '__rkExposureCoordinate', label: 'Снимок/координаты РК', group: 'РК по снимкам' },
  { key: '__rkExposureDescription', label: 'Описание по снимку РК', group: 'РК по снимкам' },
  ...STAMP_NAME_TEMPLATE_FIELDS.map((field) => ({
    key: `__welderName:${field.key}` as DocumentTemplateFieldKey,
    label: `${field.label} ФИО сварщика`,
    group: 'ФИО по официальному клейму',
  })),
]

const SYSTEM_DOCUMENT_FIELDS: Array<{
  key: DocumentTemplateFieldKey
  label: string
  group: string
  kind: 'text'
}> = [
  { key: '__systemDocumentTitle', label: 'Наименование документа', group: 'Текущий системный документ', kind: 'text' },
  { key: '__systemDocumentDate', label: 'Дата документа', group: 'Текущий системный документ', kind: 'text' },
  { key: '__systemDocumentNumber', label: '№ документа', group: 'Текущий системный документ', kind: 'text' },
]

type TemplateFieldOption = {
  key: DocumentTemplateFieldKey
  label: string
  group: string
  kind: 'text' | 'number'
}

const BASE_FIELD_OPTIONS: TemplateFieldOption[] = [
  ...SPECIAL_FIELDS.map((field) => ({ ...field, kind: field.key === '__index' ? 'number' as const : 'text' as const })),
  ...WELD_FIELDS.filter(
    (field) => !isVirtualWeldField(field) || isGeneratedDocumentFieldKey(field.key),
  ).map((field) => ({
    key: field.key as DocumentTemplateFieldKey,
    label: field.label,
    group: field.group,
    kind: field.kind === 'number' ? 'number' as const : 'text' as const,
  })),
]

const NUMERIC_TEMPLATE_FIELD_KEYS = new Set(
  BASE_FIELD_OPTIONS.filter((field) => field.kind === 'number').map((field) => field.key),
)

function isNumericTemplateField(field: DocumentTemplateFieldKey | undefined) {
  return Boolean(field && NUMERIC_TEMPLATE_FIELD_KEYS.has(field))
}

function isValidTemplateMultiplier(value: string | undefined) {
  if (!value?.trim()) return true
  const normalized = value.trim().replace(/\s+/g, '').replace(',', '.')
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) && Number.isFinite(Number(normalized))
}

export type DocumentTemplateRepeatTarget = 'joint' | 'projectTitle' | 'subtitleCode' | 'line'

const REPEAT_TARGET_OPTIONS: Array<{
  value: DocumentTemplateRepeatTarget
  label: string
  description: string
}> = [
  {
    value: 'joint',
    label: 'Каждого стыка',
    description: 'Один блок (группа повторяющихся строк) Excel создается для каждого выбранного стыка.',
  },
  {
    value: 'projectTitle',
    label: 'Каждого проекта',
    description: 'Один блок (группа повторяющихся строк) Excel создается для каждого проекта.',
  },
  {
    value: 'subtitleCode',
    label: 'Каждого шифра',
    description: 'Один блок (группа повторяющихся строк) Excel создается для каждой связки «Проект + Шифр».',
  },
  {
    value: 'line',
    label: 'Каждой линии',
    description: 'Один блок (группа повторяющихся строк) Excel создается для каждой связки «Проект + Шифр + Линия».',
  },
]

const NAME_FIELD_OPTIONS: Array<{ key: DocumentTemplateNameFieldKey; label: string; group: string }> = [
  { key: '__periodFrom', label: 'Дата начала периода', group: 'Документ' },
  { key: '__periodTo', label: 'Дата окончания периода', group: 'Документ' },
  { key: '__formationDate', label: 'Дата формирования', group: 'Документ' },
  { key: '__documentNumber', label: 'Порядковый номер документа', group: 'Документ' },
  ...WELD_FIELDS.filter((field) => !isVirtualWeldField(field)).map((field) => ({
    key: field.key as keyof WeldInput,
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

function replaceCellRow(address: string, row: number) {
  return `${address.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A'}${row}`
}

function getBindingParts(binding: DocumentTemplateCellBinding | undefined): DocumentTemplateCellPart[] {
  if (binding?.parts?.length) return binding.parts
  return binding?.field ? [{ field: binding.field }] : []
}

function getInitialDraft(template: StoredDocumentTemplate): DocumentTemplateConstructorConfig {
  const normalized = template.constructorConfig
    ? normalizeDocumentTemplateConstructorConfig(template.constructorConfig)
    : {
        version: 1 as const,
        sheetName: template.sheetNames?.[0] ?? '',
        repeatMode: 'rows' as const,
        bindings: [],
      }

  return {
    ...normalized,
    nameConfig: isSystemDocumentTemplateId(template.id)
      ? undefined
      : normalized.nameConfig ?? createDefaultDocumentTemplateNameConfig(template.id),
  }
}

function getRepeatRowEnd(config: DocumentTemplateConstructorConfig) {
  return config.repeatRow ? Math.max(config.repeatRow, config.repeatRowEnd || config.repeatRow) : undefined
}

function isRowInRepeatBlock(config: DocumentTemplateConstructorConfig, row: number) {
  const repeatRowEnd = getRepeatRowEnd(config)
  return Boolean(config.repeatRow && repeatRowEnd && row >= config.repeatRow && row <= repeatRowEnd)
}

function getPreviewCellRowRange(
  preview: DocumentTemplateWorkbookPreview | null,
  address: string,
) {
  const row = getCellRow(address)
  const cell = preview?.cells.find((candidate) => candidate.address === address)
  return {
    start: cell?.row ?? row,
    end: (cell?.row ?? row) + Math.max(cell?.rowSpan ?? 1, 1) - 1,
  }
}

function isCellInRepeatBlock(
  config: DocumentTemplateConstructorConfig,
  preview: DocumentTemplateWorkbookPreview | null,
  address: string,
) {
  const repeatRowEnd = getRepeatRowEnd(config)
  if (!config.repeatRow || !repeatRowEnd) return false
  const range = getPreviewCellRowRange(preview, address)
  return range.start >= config.repeatRow && range.end <= repeatRowEnd
}

export function shouldShowDocumentTemplateRepeatControls(
  config: DocumentTemplateConstructorConfig,
  preview: DocumentTemplateWorkbookPreview | null,
  selectedCell: string,
) {
  return Boolean(selectedCell && isCellInRepeatBlock(config, preview, selectedCell))
}

export function includeTemplateCellInRepeatBlock(
  config: DocumentTemplateConstructorConfig,
  preview: DocumentTemplateWorkbookPreview | null,
  address: string,
): DocumentTemplateConstructorConfig {
  const range = getPreviewCellRowRange(preview, address)
  const currentEnd = getRepeatRowEnd(config)
  return {
    ...config,
    repeatRow: config.repeatRow ? Math.min(config.repeatRow, range.start) : range.start,
    repeatRowEnd: currentEnd ? Math.max(currentEnd, range.end) : range.end,
  }
}

export function getDocumentTemplateRepeatTarget(
  config: DocumentTemplateConstructorConfig,
): DocumentTemplateRepeatTarget {
  if (config.repeatMode !== 'groups') return 'joint'
  if (
    config.repeatGroupBy === 'projectTitle' ||
    config.repeatGroupBy === 'subtitleCode' ||
    config.repeatGroupBy === 'line'
  ) {
    return config.repeatGroupBy
  }
  return 'joint'
}

export function applyDocumentTemplateRepeatTarget(
  config: DocumentTemplateConstructorConfig,
  preview: DocumentTemplateWorkbookPreview | null,
  target: DocumentTemplateRepeatTarget,
): DocumentTemplateConstructorConfig {
  const repeatMode = target === 'joint' ? 'rows' : 'groups'
  return {
    ...config,
    repeatMode,
    repeatGroupBy: repeatMode === 'groups' ? target : undefined,
    bindings: config.bindings.map((binding) => {
      const insideRepeatBlock = isCellInRepeatBlock(config, preview, binding.cell)
      if (!insideRepeatBlock) {
        return binding.mode === 'summary' ? { ...binding, scope: undefined } : binding
      }
      if (repeatMode === 'rows') {
        return {
          ...binding,
          mode: 'row',
          uniqueParts: binding.uniqueParts ?? binding.uniqueValues,
          uniqueValues: undefined,
          scope: undefined,
        }
      }
      return {
        ...binding,
        scope: binding.mode === 'summary' ? 'group' : undefined,
      }
    }),
  }
}

export function validateDocumentTemplateBuilderConfig(
  draft: DocumentTemplateConstructorConfig,
  preview: DocumentTemplateWorkbookPreview | null,
  options: { requireNameConfig?: boolean } = {},
) {
  if (!draft.sheetName) return 'Выберите лист шаблона.'
  if (!draft.bindings.length) return 'Назначьте хотя бы одну ячейку.'
  const rowBindings = draft.bindings.filter((binding) => binding.mode === 'row')
  const groupBindings = draft.bindings.filter(
    (binding) => binding.mode === 'summary' && binding.scope === 'group',
  )
  const repeatBindings = [...rowBindings, ...groupBindings]
  const repeatRowEnd = getRepeatRowEnd(draft)
  if (repeatBindings.length && !draft.repeatRow) return 'Выберите повторяемый блок строк.'
  const outsideRowBindings = repeatBindings.filter(
    (binding) => !isCellInRepeatBlock(draft, preview, binding.cell),
  )
  if (outsideRowBindings.length) {
    const addresses = outsideRowBindings.map((binding) => binding.cell).join(', ')
    return `Ячейки ${addresses} находятся вне повторяемого блока строк ${draft.repeatRow}–${repeatRowEnd}.`
  }
  if (
    draft.repeatRow &&
    draft.bindings.some((binding) => {
      if (binding.mode === 'row' || binding.scope === 'group') return false
      return getPreviewCellRowRange(preview, binding.cell).end >= draft.repeatRow!
    })
  ) {
    return 'Сводные ячейки должны находиться выше повторяемого блока строк.'
  }
  if (draft.repeatRow && repeatRowEnd && repeatRowEnd < draft.repeatRow) {
    return 'Конец повторяемого блока не может находиться выше его начала.'
  }
  if (draft.bindings.some((binding) => getBindingParts(binding).length === 0)) {
    return 'Для каждой назначенной ячейки выберите поле.'
  }
  for (const binding of draft.bindings) {
    const parts = getBindingParts(binding)
    for (const [partIndex, part] of parts.entries()) {
      if ((part.numericOperation || part.multiplier?.trim()) && !isNumericTemplateField(part.field)) {
        return `В ячейке ${binding.cell}, часть ${partIndex + 1}: числовая формула доступна только для числового поля.`
      }
      if (part.numericOperation && !part.compareField) {
        return `В ячейке ${binding.cell}, часть ${partIndex + 1}: выберите второе числовое поле.`
      }
      if (part.compareField && !isNumericTemplateField(part.compareField)) {
        return `В ячейке ${binding.cell}, часть ${partIndex + 1}: второе поле формулы должно быть числовым.`
      }
      if (!isValidTemplateMultiplier(part.multiplier)) {
        return `В ячейке ${binding.cell}, часть ${partIndex + 1}: укажите корректный коэффициент умножения.`
      }
    }
  }
  if (draft.repeatMode === 'groups' && !draft.repeatGroupBy) {
    return 'Выберите поле группировки повторяемого блока.'
  }
  if (draft.repeatMode !== 'groups' && groupBindings.length) {
    return 'Данные текущей группы доступны только при повторении блока по группам.'
  }
  if (options.requireNameConfig !== false) {
    const nameParts = draft.nameConfig?.parts ?? []
    if (!nameParts.some((part) => part.type === 'field' ? Boolean(part.field) : Boolean(part.text?.trim()))) {
      return 'Добавьте хотя бы одно поле или текст для названия документа.'
    }
    if (nameParts.some((part) => part.type === 'field' && !part.field)) {
      return 'Для каждой части названия типа «Поле» выберите поле системы.'
    }
  }
  return null
}

export function DocumentTemplateBuilder({ template, onClose, onSave }: DocumentTemplateBuilderProps) {
  const isSystemTemplate = isSystemDocumentTemplateId(template.id)
  const [preview, setPreview] = useState<DocumentTemplateWorkbookPreview | null>(null)
  const [draft, setDraft] = useState<DocumentTemplateConstructorConfig>(() => getInitialDraft(template))
  const [selectedCell, setSelectedCell] = useState(template.constructorConfig?.bindings[0]?.cell ?? '')
  const [activeTab, setActiveTab] = useState<'content' | 'name'>('content')
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

  useEffect(() => {
    setError(null)
  }, [draft])

  const selectedBinding = draft.bindings.find((binding) => binding.cell === selectedCell)
  const bindingsByCell = useMemo(
    () => new Map(draft.bindings.map((binding) => [binding.cell, binding])),
    [draft.bindings],
  )
  const fieldGroups = useMemo(() => {
    const fieldOptions = isSystemTemplate
      ? [...SYSTEM_DOCUMENT_FIELDS, ...BASE_FIELD_OPTIONS]
      : BASE_FIELD_OPTIONS
    const groups = new Map<string, TemplateFieldOption[]>()
    for (const field of fieldOptions) {
      const values = groups.get(field.group) ?? []
      values.push(field)
      groups.set(field.group, values)
    }
    return Array.from(groups.entries())
  }, [isSystemTemplate])
  const repeatTarget = getDocumentTemplateRepeatTarget(draft)
  const selectedCellInsideRepeatBlock = selectedCell
    ? isCellInRepeatBlock(draft, preview, selectedCell)
    : false
  const showRepeatControls = shouldShowDocumentTemplateRepeatControls(
    draft,
    preview,
    selectedCell,
  )
  const selectedModeOptions = useMemo(() => {
    if (!draft.repeatRow) {
      if (selectedBinding?.mode === 'summary') {
        return [{
          value: 'summary' as const,
          label: 'Сводка документа',
          description: 'В одну ячейку собираются значения из всех стыков документа.',
        }]
      }
      return [{
        value: 'row' as const,
        label: 'Данные стыка',
        description: 'Строки-пример будут автоматически выбраны по размеру этой ячейки.',
      }]
    }
    if (selectedCellInsideRepeatBlock) {
      if (draft.repeatMode === 'groups') {
        return [
          {
            value: 'row' as const,
            label: 'Одно значение группы',
            description: 'Например, название линии: система возьмет его из первого стыка текущей группы.',
          },
          {
            value: 'summary' as const,
            label: 'Список значений группы',
            description: 'Например, все стыки или Чек-листы только текущей линии.',
          },
        ]
      }
      return [{
        value: 'row' as const,
        label: 'Данные стыка',
        description: 'Ячейка заполняется отдельно для каждого выбранного стыка.',
      }]
    }
    return [{
      value: 'summary' as const,
      label: 'Сводка документа',
      description: 'В одну ячейку собираются значения из всех стыков документа.',
    }]
  }, [draft.repeatMode, draft.repeatRow, selectedBinding?.mode, selectedCellInsideRepeatBlock])

  const setRepeatRow = (row: number) => {
    const currentStart = draft.repeatRow
    const currentEnd = getRepeatRowEnd(draft)
    if (currentStart && currentEnd && currentStart === currentEnd && row > currentStart) {
      setDraft((current) => {
        const next = { ...current, repeatRowEnd: row }
        return applyDocumentTemplateRepeatTarget(
          next,
          preview,
          getDocumentTemplateRepeatTarget(current),
        )
      })
      return
    }
    const shouldMoveSelection =
      Boolean(selectedBinding && (selectedBinding.mode === 'row' || selectedBinding.scope === 'group')) &&
      currentStart === currentEnd
    setDraft((current) => {
      const next = {
        ...current,
        repeatRow: row,
        repeatRowEnd: row,
        bindings: current.bindings.map((binding) => {
        if (currentStart !== currentEnd || (binding.mode !== 'row' && binding.scope !== 'group')) {
          return binding
        }
        return {
          ...binding,
          cell: replaceCellRow(binding.cell, row),
        }
      }),
      }
      return applyDocumentTemplateRepeatTarget(
        next,
        preview,
        getDocumentTemplateRepeatTarget(current),
      )
    })
    if (shouldMoveSelection) setSelectedCell((current) => replaceCellRow(current, row))
  }

  const setRepeatBlockBoundary = (boundary: 'start' | 'end', value: number) => {
    if (!Number.isFinite(value) || value < 1) return
    const row = Math.floor(value)
    setDraft((current) => {
      const next = boundary === 'start'
        ? {
          ...current,
          repeatRow: row,
          repeatRowEnd: Math.max(row, getRepeatRowEnd(current) || row),
        }
        : {
        ...current,
        repeatRow: current.repeatRow ?? row,
        repeatRowEnd: Math.max(current.repeatRow ?? row, row),
      }
      return applyDocumentTemplateRepeatTarget(
        next,
        preview,
        getDocumentTemplateRepeatTarget(current),
      )
    })
  }

  const updateSelectedBinding = (patch: Partial<DocumentTemplateCellBinding>) => {
    if (!selectedCell) return
    setDraft((current) => {
      const existing = current.bindings.find((binding) => binding.cell === selectedCell)
      const startsRepeatBlock = !current.repeatRow
      const insideRepeatBlock =
        startsRepeatBlock || isCellInRepeatBlock(current, preview, selectedCell)
      const defaultMode: DocumentTemplateBindingMode = insideRepeatBlock ? 'row' : 'summary'
      const nextBinding: DocumentTemplateCellBinding = {
        cell: selectedCell,
        mode: existing?.mode ?? defaultMode,
        emptyMode: existing?.emptyMode ?? 'blank',
        separator: existing?.separator ?? 'comma',
        ...existing,
        ...patch,
      }
      if (
        current.repeatMode === 'groups' &&
        insideRepeatBlock &&
        nextBinding.mode === 'summary'
      ) {
        nextBinding.scope = 'group'
      } else if (nextBinding.mode === 'summary') {
        nextBinding.scope = undefined
      }
      const nextDraft = {
        ...current,
        bindings: [...current.bindings.filter((binding) => binding.cell !== selectedCell), nextBinding],
      }
      return nextBinding.mode === 'row' || nextBinding.scope === 'group'
        ? includeTemplateCellInRepeatBlock(nextDraft, preview, selectedCell)
        : nextDraft
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
    if (mode === 'row' || mode === 'summary') {
      const parts = getBindingParts(selectedBinding)
      const useCurrentGroup =
        mode === 'summary' &&
        draft.repeatMode === 'groups' &&
        isCellInRepeatBlock(draft, preview, selectedCell)
      updateSelectedBinding({
        mode,
        parts,
        field: undefined,
        uniqueParts: mode === 'row' ? selectedBinding.uniqueParts : undefined,
        uniqueValues: mode === 'summary' ? selectedBinding.uniqueValues ?? true : undefined,
        scope: useCurrentGroup ? 'group' : undefined,
      })
      return
    }
  }

  const removeSelectedBinding = () => {
    setDraft((current) => ({
      ...current,
      bindings: current.bindings.filter((binding) => binding.cell !== selectedCell),
    }))
  }

  const updateNameParts = (parts: DocumentTemplateNamePart[]) => {
    setDraft((current) => ({
      ...current,
      nameConfig: { parts },
    }))
  }

  const validate = () => {
    return validateDocumentTemplateBuilderConfig(draft, preview, {
      requireNameConfig: !isSystemTemplate,
    })
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
            {isSystemTemplate
              ? 'Настройте заполнение Excel. Наименование файла система возьмет из заявки или заключения.'
              : 'Настройте заполнение Excel и автоматическое название сформированного документа.'}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Закрыть">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex gap-1 border-b border-slate-200 bg-white px-5 pt-2" role="tablist" aria-label="Разделы конструктора">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'content'}
          onClick={() => setActiveTab('content')}
          className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold ${
            activeTab === 'content'
              ? 'border-sky-600 text-sky-800'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
          }`}
        >
          <TableProperties className="h-4 w-4" />
          Заполнение
        </button>
        {!isSystemTemplate ? (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'name'}
            onClick={() => setActiveTab('name')}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold ${
              activeTab === 'name'
                ? 'border-sky-600 text-sky-800'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            <FileText className="h-4 w-4" />
            Название
          </button>
        ) : null}
      </div>

      {activeTab === 'content' ? (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-h-0 overflow-auto bg-slate-100/70 p-4">
          <div className="mb-3 flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
            <label className="text-xs font-semibold uppercase text-slate-500">Лист</label>
            <select
              value={draft.sheetName}
              onChange={(event) => {
                setSelectedCell('')
                setDraft((current) => ({
                  ...current,
                  sheetName: event.target.value,
                  repeatRow: undefined,
                  repeatRowEnd: undefined,
                  repeatMode: 'rows',
                  repeatGroupBy: undefined,
                  bindings: [],
                }))
              }}
              className="h-9 rounded-md border-slate-300 py-1 text-sm"
            >
              {(preview?.sheetNames ?? template.sheetNames ?? []).map((sheetName) => (
                <option key={sheetName} value={sheetName}>
                  {sheetName}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">Выберите ячейку и укажите, какие данные в нее выводить.</span>
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
                      <tr key={row} className={isRowInRepeatBlock(draft, row) ? 'bg-sky-50' : undefined}>
                        <th className="sticky left-0 z-10 border-b border-r border-slate-300 bg-slate-100 p-1">
                          <button
                            type="button"
                            onClick={() => setRepeatRow(row)}
                            title="Выбрать строку или расширить повторяемый блок"
                            className={`flex h-7 w-full items-center justify-center rounded text-xs font-semibold ${
                              isRowInRepeatBlock(draft, row) ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-200'
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

          {showRepeatControls ? (
            <div className="mt-4 rounded-md border border-sky-200 bg-sky-50/70 p-3">
              <div className="text-xs font-semibold uppercase text-sky-800">Формирование строк</div>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Эта ячейка входит в копируемый блок. Укажите, для чего создавать его копию.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-600">
                  Строка с
                  <input
                    type="number"
                    min={1}
                    value={draft.repeatRow ?? ''}
                    onChange={(event) => setRepeatBlockBoundary('start', Number(event.target.value))}
                    className="mt-1 h-9 w-full rounded-md border-sky-200 bg-white px-2 text-sm text-slate-800"
                    aria-label="Начальная строка повторяемого блока"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  Строка по
                  <input
                    type="number"
                    min={draft.repeatRow ?? 1}
                    value={getRepeatRowEnd(draft) ?? ''}
                    onChange={(event) => setRepeatBlockBoundary('end', Number(event.target.value))}
                    className="mt-1 h-9 w-full rounded-md border-sky-200 bg-white px-2 text-sm text-slate-800"
                    aria-label="Конечная строка повторяемого блока"
                  />
                </label>
              </div>
              <label className="mt-3 block">
                <span className="text-xs font-semibold text-slate-600">Создавать блок для</span>
                <select
                  value={repeatTarget}
                  onChange={(event) =>
                    setDraft((current) =>
                      applyDocumentTemplateRepeatTarget(
                        current,
                        preview,
                        event.target.value as DocumentTemplateRepeatTarget,
                      ),
                    )
                  }
                  className="mt-1 w-full rounded-md border-sky-200 bg-white text-sm text-slate-800"
                >
                  {REPEAT_TARGET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  {REPEAT_TARGET_OPTIONS.find((option) => option.value === repeatTarget)?.description}
                </span>
              </label>
            </div>
          ) : null}

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
                  {selectedModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  {selectedModeOptions.find((option) => option.value === selectedBinding.mode)?.description}
                </span>
              </label>

              {selectedBinding.mode === 'row' || selectedBinding.mode === 'summary' ? (
                <CellPartsEditor
                  parts={getBindingParts(selectedBinding)}
                  deduplicateValues={
                    selectedBinding.mode === 'row'
                      ? Boolean(selectedBinding.uniqueParts)
                      : selectedBinding.uniqueValues !== false
                  }
                  mode={selectedBinding.mode}
                  fieldGroups={fieldGroups}
                  onChange={updateSelectedParts}
                  onDeduplicateChange={(checked) =>
                    updateSelectedBinding(
                      selectedBinding.mode === 'row'
                        ? { uniqueParts: checked }
                        : { uniqueValues: checked },
                    )
                  }
                />
              ) : null}

              <details className="rounded-md border border-slate-200 bg-slate-50">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-700">
                  Дополнительные настройки
                </summary>
                <div className="space-y-4 border-t border-slate-200 bg-white p-3">
                  {selectedBinding.mode === 'summary' ? (
                    <div>
                      <div className="text-xs font-semibold uppercase text-slate-500">Разделитель значений</div>
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

                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">Если значение заполнено</div>
                    <select
                      value={selectedBinding.filledMode ?? 'value'}
                      onChange={(event) =>
                        updateSelectedBinding({ filledMode: event.target.value as DocumentTemplateCellBinding['filledMode'] })
                      }
                      className="mt-1 w-full rounded-md border-slate-300 text-sm"
                    >
                      <option value="value">Оставить рассчитанное значение</option>
                      <option value="custom">Написать свой текст</option>
                    </select>
                    {selectedBinding.filledMode === 'custom' ? (
                      <input
                        value={selectedBinding.filledText ?? ''}
                        onChange={(event) => updateSelectedBinding({ filledText: event.target.value })}
                        placeholder="Текст для заполненного значения"
                        className="mt-2 w-full rounded-md border-slate-300 text-sm"
                      />
                    ) : null}
                  </div>
                </div>
              </details>

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
              {draft.repeatRow ? (
                <> · повторяемый блок: <span className="font-semibold text-slate-800">
                  {draft.repeatRow}{getRepeatRowEnd(draft) !== draft.repeatRow ? `–${getRepeatRowEnd(draft)}` : ''}
                </span>
                {draft.repeatMode === 'groups' ? (
                  <> · блок для: <span className="font-semibold text-slate-800">
                    {REPEAT_TARGET_OPTIONS.find((option) => option.value === repeatTarget)?.label ?? 'не выбрано'}
                  </span></>
                ) : null}
                </>
              ) : null}
            </div>
          </div>
        </aside>
        </div>
      ) : (
        <DocumentTemplateNameEditor
          parts={draft.nameConfig?.parts ?? []}
          onChange={updateNameParts}
          onReset={() => updateNameParts(createDefaultDocumentTemplateNameConfig(template.id).parts)}
        />
      )}

      <div className="flex items-center gap-3 border-t border-slate-200 px-5 py-3">
        {error ? (
          <div className="mr-auto flex min-w-0 items-center gap-2 text-sm text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        ) : (
          <div className="mr-auto text-xs text-slate-500">
            Изменяются правила заполнения и автоназвания. Исходный Excel остается без изменений.
          </div>
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

function DocumentTemplateNameEditor({
  parts,
  onChange,
  onReset,
}: {
  parts: DocumentTemplateNamePart[]
  onChange: (parts: DocumentTemplateNamePart[]) => void
  onReset: () => void
}) {
  const fieldGroups = useMemo(() => {
    const groups = new Map<string, typeof NAME_FIELD_OPTIONS>()
    for (const field of NAME_FIELD_OPTIONS) {
      const values = groups.get(field.group) ?? []
      values.push(field)
      groups.set(field.group, values)
    }
    return Array.from(groups.entries())
  }, [])

  const preview = parts
    .map((part) => {
      if (part.type === 'text') return part.text ?? ''
      return `[${NAME_FIELD_OPTIONS.find((field) => field.key === part.field)?.label ?? 'Выберите поле'}]`
    })
    .join('')
    .trim()

  const updatePart = (index: number, nextPart: DocumentTemplateNamePart) => {
    onChange(parts.map((part, partIndex) => (partIndex === index ? nextPart : part)))
  }

  const movePart = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= parts.length) return
    const nextParts = [...parts]
    const [part] = nextParts.splice(index, 1)
    nextParts.splice(targetIndex, 0, part)
    onChange(nextParts)
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-50 px-5 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h4 className="text-base font-semibold text-slate-950">Автоматическое название документа</h4>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Соберите название из полей и постоянного текста. Для поля система возьмет уникальные значения из всех
              стыков, вошедших в документ. Расширение <span className="font-semibold text-slate-800">.xlsx</span> добавится автоматически.
            </p>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            <RotateCcw className="h-4 w-4" />
            Стандартное название
          </button>
        </div>

        <div className="mt-5 rounded-md border border-sky-200 bg-sky-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase text-sky-700">Пример формулы</div>
          <div className="mt-1 break-words text-base font-semibold text-slate-900">
            {preview || 'Добавьте поле или текст'}
            <span className="text-slate-400">.xlsx</span>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="grid grid-cols-[44px_130px_minmax(0,1fr)_96px] items-center gap-3 border-b border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
            <span>№</span>
            <span>Тип</span>
            <span>Содержимое</span>
            <span className="text-right">Порядок</span>
          </div>

          {parts.length ? (
            parts.map((part, index) => (
              <div
                key={index}
                className="grid grid-cols-[44px_130px_minmax(0,1fr)_96px] items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded bg-slate-100 text-xs font-semibold text-slate-600">
                  {index + 1}
                </span>
                <select
                  value={part.type}
                  onChange={(event) =>
                    updatePart(
                      index,
                      event.target.value === 'field'
                        ? { type: 'field', field: 'projectTitle' }
                        : { type: 'text', text: ' - ' },
                    )
                  }
                  className="w-full rounded-md border-slate-300 py-1.5 text-sm"
                >
                  <option value="field">Поле</option>
                  <option value="text">Текст</option>
                </select>

                {part.type === 'field' ? (
                  <select
                    value={part.field ?? ''}
                    onChange={(event) =>
                      updatePart(index, {
                        type: 'field',
                        field: event.target.value as DocumentTemplateNameFieldKey,
                      })
                    }
                    className="w-full rounded-md border-slate-300 py-1.5 text-sm"
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
                ) : (
                  <input
                    value={part.text ?? ''}
                    onChange={(event) => updatePart(index, { type: 'text', text: event.target.value })}
                    placeholder="Например: ЖСР - "
                    className="w-full rounded-md border-slate-300 py-1.5 text-sm"
                  />
                )}

                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => movePart(index, -1)}
                    disabled={index === 0}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-25"
                    title="Поднять"
                    aria-label={`Поднять часть названия ${index + 1}`}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => movePart(index, 1)}
                    disabled={index === parts.length - 1}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-25"
                    title="Опустить"
                    aria-label={`Опустить часть названия ${index + 1}`}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(parts.filter((_, partIndex) => partIndex !== index))}
                    className="rounded p-1.5 text-rose-600 hover:bg-rose-50"
                    title="Удалить"
                    aria-label={`Удалить часть названия ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              В названии пока нет частей. Добавьте поле или постоянный текст.
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange([...parts, { type: 'field', field: 'projectTitle' }])}
            className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-50"
          >
            <Plus className="h-4 w-4" />
            Добавить поле
          </button>
          <button
            type="button"
            onClick={() => onChange([...parts, { type: 'text', text: ' - ' }])}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            <Plus className="h-4 w-4" />
            Добавить текст
          </button>
        </div>

        <p className="mt-4 text-xs leading-5 text-slate-500">
          Повторяющиеся значения одного поля выводятся один раз. Если значений больше трех, название сокращается:
          первые три значения и количество оставшихся.
        </p>
      </div>
    </div>
  )
}

function CellPartsEditor({
  parts,
  deduplicateValues,
  mode,
  fieldGroups,
  onChange,
  onDeduplicateChange,
}: {
  parts: DocumentTemplateCellPart[]
  deduplicateValues: boolean
  mode: 'row' | 'summary'
  fieldGroups: Array<[string, TemplateFieldOption[]]>
  onChange: (parts: DocumentTemplateCellPart[]) => void
  onDeduplicateChange: (checked: boolean) => void
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

  const fieldOptions = fieldGroups.flatMap(([, fields]) => fields)
  const numericFieldGroups = fieldGroups
    .map(([group, fields]) => [group, fields.filter((field) => field.kind === 'number')] as const)
    .filter(([, fields]) => fields.length)
  const preview = parts
    .map((part) => {
      const label = fieldOptions.find((field) => field.key === part.field)?.label ?? 'Поле'
      const compareLabel = fieldOptions.find((field) => field.key === part.compareField)?.label ?? 'второе поле'
      const operation = part.numericOperation
        ? `${part.numericOperation}([${label}], [${compareLabel}])`
        : `[${label}]`
      const formula = part.multiplier?.trim()
        ? `${operation} × ${part.multiplier.trim()}`
        : operation
      return `${part.prefix ?? ''}${formula}${part.suffix ?? ''}${part.lineBreakAfter ? '\n' : ''}`
    })
    .join('')
    .replace(/\n+$/, '')

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-semibold uppercase text-slate-500">Содержимое ячейки</div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {mode === 'summary'
            ? 'Для каждой части система соберет уникальные значения поля по всем выбранным стыкам. Текст до и после выводится только при наличии значений.'
            : 'Части собираются сверху вниз. Текст до и после поля выводится только когда само поле заполнено.'}
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
              onChange={(event) => {
                const field = event.target.value as DocumentTemplateFieldKey
                updatePart(
                  index,
                  isNumericTemplateField(field)
                    ? { field }
                    : {
                        field,
                        numericOperation: undefined,
                        compareField: undefined,
                        multiplier: undefined,
                      },
                )
              }}
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

            {isNumericTemplateField(part.field) ? (
              <details className="mt-2 rounded border border-sky-200 bg-sky-50/60">
                <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium text-sky-800">
                  Числовая формула
                </summary>
                <div className="space-y-3 border-t border-sky-200 bg-white p-2">
                  <label className="block">
                    <span className="text-[11px] font-medium text-slate-500">Минимум или максимум</span>
                    <select
                      value={part.numericOperation ?? 'none'}
                      onChange={(event) => {
                        const numericOperation =
                          event.target.value === 'min' || event.target.value === 'max'
                            ? event.target.value
                            : undefined
                        updatePart(index, {
                          numericOperation,
                          compareField: numericOperation
                            ? part.compareField ?? numericFieldGroups[0]?.[1][0]?.key
                            : undefined,
                        })
                      }}
                      className="mt-1 w-full rounded-md border-slate-300 px-2 py-1.5 text-xs"
                    >
                      <option value="none">Не сравнивать</option>
                      <option value="min">Минимальное из двух полей</option>
                      <option value="max">Максимальное из двух полей</option>
                    </select>
                  </label>

                  {part.numericOperation ? (
                    <label className="block">
                      <span className="text-[11px] font-medium text-slate-500">Второе числовое поле</span>
                      <select
                        value={part.compareField ?? ''}
                        onChange={(event) =>
                          updatePart(index, { compareField: event.target.value as DocumentTemplateFieldKey })
                        }
                        className="mt-1 w-full rounded-md border-slate-300 px-2 py-1.5 text-xs"
                      >
                        {numericFieldGroups.map(([group, fields]) => (
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

                  <label className="block">
                    <span className="text-[11px] font-medium text-slate-500">Умножить результат на</span>
                    <input
                      value={part.multiplier ?? ''}
                      onChange={(event) => updatePart(index, { multiplier: event.target.value })}
                      inputMode="decimal"
                      placeholder="Например: 3,14"
                      className={`mt-1 w-full rounded-md px-2 py-1.5 text-xs ${
                        isValidTemplateMultiplier(part.multiplier)
                          ? 'border-slate-300'
                          : 'border-rose-300 bg-rose-50'
                      }`}
                    />
                    <span className="mt-1 block text-[11px] leading-4 text-slate-500">
                      Можно умножить одно поле или результат min/max. Допустимы запятая и точка.
                    </span>
                  </label>
                </div>
              </details>
            ) : null}

            <details className="mt-2 rounded border border-slate-200 bg-white">
              <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium text-slate-600">
                Подписи и перенос
              </summary>
              <div className="border-t border-slate-200 p-2">
                <div className="grid grid-cols-2 gap-2">
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
            </details>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onChange([...parts, { field: mode === 'summary' ? 'projectTitle' : '__index' }])}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100"
      >
        <Plus className="h-4 w-4" />
        Добавить поле в ячейку
      </button>

      <DeduplicateValuesToggle
        checked={deduplicateValues}
        onChange={onDeduplicateChange}
        description={
          mode === 'row'
            ? 'Если одно клеймо или ФИО встречается в нескольких частях этой строки, оно будет записано один раз.'
            : 'Повторяющиеся значения каждого выбранного поля будут записаны в сводку только один раз.'
        }
      />

      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="text-[11px] font-semibold uppercase text-slate-400">Схема ячейки</div>
        <div className="mt-1 whitespace-pre-line text-xs leading-5 text-slate-700">{preview || 'Добавьте хотя бы одно поле.'}</div>
      </div>
    </div>
  )
}

function DeduplicateValuesToggle({
  checked,
  description,
  onChange,
}: {
  checked: boolean
  description: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs leading-5 text-slate-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
      />
      <span>
        <span className="block font-semibold text-slate-700">Убрать повторяющиеся значения</span>
        {description}
      </span>
    </label>
  )
}
