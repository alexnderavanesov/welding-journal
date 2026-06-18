import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ClipboardCheck, FileSpreadsheet, Flame, NotebookTabs, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { WeldForm } from '@/components/weld-form'
import { WeldTable } from '@/components/weld-table'
import seedWelds from '@/data/seed-welds.json'
import {
  clearLnkGeneratedWeldData,
  createWeldJoint,
  deleteWeldJoint,
  importWeldJoints,
  listWeldJoints,
  updateWeldJoint,
  type WeldFilters,
} from '@/server/welds'
import {
  buildExportXlsxBytes,
  isMeaningfulRecord,
  normalizeWeldInput,
  parseEditableCsv,
  parseEditableWorkbook,
  parseCsv,
  parseWorkbook,
  withAutoVikForWeldDate,
} from '@/lib/weld-import-export'
import { getWeldTableWidth } from '@/lib/weld-column-widths'
import {
  FIELD_BY_KEY,
  RESULT_STATUS_OPTIONS,
  PSTO_RESULT_STATUS_OPTIONS,
  VISIBLE_FIELD_SECTIONS,
  VISIBLE_FIELDS,
  calculateFinalStatus,
  type WeldField,
  type WeldFieldKey,
  type WeldInput,
} from '@/lib/weld-fields'

export const Route = createFileRoute('/')({
  component: Home,
})

const emptyFilters: WeldFilters = {}
const seedRows = seedWelds as Array<WeldInput & { id: number }>
const localStorageKey = 'welding-tracker-local-welds'
const clearedLnkRequestsStorageKey = 'welding-tracker-cleared-lnk-requests-v1'
const clearedLnkResultsAndConclusionsStorageKey = 'welding-tracker-cleared-lnk-results-conclusions-v1'
const collapsedSectionsStoragePrefix = 'welding-tracker-collapsed-sections'
const highlightDurationMs = 30000
const heatTreatmentEditableFieldKeys = new Set<WeldFieldKey>([
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
])
const heatTreatmentImportMatchFieldKeys = new Set<WeldFieldKey>(['line', 'joint'])
const PSTO_EMPTY_RESULT_VALUE = '__empty__'
const LNK_METHODS = [
  { code: 'ВИК', enabledKey: 'hasVik', requestKey: 'vikRequest', resultKey: 'vikResult', conclusionDateKey: 'vikConclusionDate', conclusionKey: 'vikConclusion' },
  { code: 'РК', enabledKey: 'hasRk', requestKey: 'rkRequest', resultKey: 'rkResult', conclusionDateKey: 'rkConclusionDate', conclusionKey: 'rkConclusion' },
  { code: 'ПВК', enabledKey: 'hasPvk', requestKey: 'pvkRequest', resultKey: 'pvkResult', conclusionDateKey: 'pvkConclusionDate', conclusionKey: 'pvkConclusion' },
  { code: 'УЗК', enabledKey: 'hasUzk', requestKey: 'uzkRequest', resultKey: 'uzkResult', conclusionDateKey: 'uzkConclusionDate', conclusionKey: 'uzkConclusion' },
  { code: 'ТВМТ', enabledKey: 'hasTvmt', requestKey: 'tvmtRequest', resultKey: 'tvmtResult', conclusionDateKey: 'tvmtConclusionDate', conclusionKey: 'tvmtConclusion' },
  { code: 'РФА', enabledKey: 'hasRfa', requestKey: 'rfaRequest', resultKey: 'rfaResult', conclusionDateKey: 'rfaConclusionDate', conclusionKey: 'rfaConclusion' },
  { code: 'СТЛС', enabledKey: 'hasStls', requestKey: 'stlsRequest', resultKey: 'stlsResult', conclusionDateKey: 'stlsConclusionDate', conclusionKey: 'stlsConclusion' },
  { code: 'МКК', enabledKey: 'hasMkk', requestKey: 'mkkRequest', resultKey: 'mkkResult', conclusionDateKey: 'mkkConclusionDate', conclusionKey: 'mkkConclusion' },
] as const satisfies ReadonlyArray<{
  code: string
  enabledKey: WeldFieldKey
  requestKey: WeldFieldKey
  resultKey: WeldFieldKey
  conclusionDateKey: WeldFieldKey
  conclusionKey: WeldFieldKey
}>
const LNK_RESULT_OPTIONS = ['годен', 'ремонт', 'вырез'] as const
const LNK_EMPTY_RESULT_VALUE = '__empty__'
const LNK_CUSTOM_RESULT_VALUE = '__custom__'
const LNK_WAITING_NK_FIELDS = [
  { key: 'projectTitle', label: 'Проект/Титул', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'subtitleCode', label: 'Шифр/Подтитул', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'line', label: 'Линия', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'spool', label: 'Спул', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'joint', label: 'Стык', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'wdi', label: 'WDI', kind: 'number', group: 'ЛНК', visible: true },
  { key: 'weldDate', label: 'Дата сварки', kind: 'date', group: 'ЛНК', visible: true },
  { key: 'requestName', label: 'Наименование заявки', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'controlMethod', label: 'Вид НК', kind: 'text', group: 'ЛНК', visible: true },
] as unknown as WeldField[]
const LNK_CONCLUSIONS_FIELDS = [
  ...LNK_WAITING_NK_FIELDS,
  { key: 'controlDate', label: 'Дата контроля', kind: 'date', group: 'ЛНК', visible: true },
  { key: 'result', label: 'Результат', kind: 'text', group: 'ЛНК', visible: true },
  { key: 'conclusionName', label: 'Наименование заключения', kind: 'text', group: 'ЛНК', visible: true },
] as unknown as WeldField[]
const lnkReportFieldKeys = new Set<WeldFieldKey>([
  'lnkCreatedAt',
  'vikBoq',
  'vikKs3',
  'rkBoq',
  'rkKs3',
  'pvkBoq',
  'pvkKs3',
  'uzkBoq',
  'uzkKs3',
  'tvmtBoq',
  'tvmtKs3',
  'rfaBoq',
  'rfaKs3',
  'stlsBoq',
  'stlsKs3',
  'mkkBoq',
  'mkkKs3',
])
const lnkConclusionFieldKeys = new Set<WeldFieldKey>([
  'vikConclusionDate',
  'vikConclusion',
  'rkConclusionDate',
  'rkConclusion',
  'pvkConclusionDate',
  'pvkConclusion',
  'uzkConclusionDate',
  'uzkConclusion',
  'tvmtConclusionDate',
  'tvmtConclusion',
  'rfaConclusionDate',
  'rfaConclusion',
  'stlsConclusionDate',
  'stlsConclusion',
  'mkkConclusionDate',
  'mkkConclusion',
  'lnkDefectDescription',
  'lnkNote',
])
const lnkEditableReportFieldKeys = new Set<WeldFieldKey>([
  ...[...lnkReportFieldKeys].filter((fieldKey) => fieldKey !== 'lnkCreatedAt'),
])
const lnkRequestFieldKeys = LNK_METHODS.map((method) => method.requestKey)
const lnkGeneratedFieldKeys = new Set<WeldFieldKey>([
  ...LNK_METHODS.flatMap((method) => [method.resultKey, method.conclusionDateKey, method.conclusionKey]),
  'lnkDefectDescription',
  'lnkNote',
  'lnkCreatedAt',
])
const lnkEditableFieldKeys = new Set<WeldFieldKey>([
  ...lnkEditableReportFieldKeys,
])
const lnkImportMatchFieldKeys = new Set<WeldFieldKey>(['line', 'joint'])
const pstoSectionFieldKeys = new Set<WeldFieldKey>([
  'pstoRequired',
  'pstoRequest',
  'pstoDate',
  'pstoResult',
  'heatTreatmentDiagram',
  'pstoNote',
])
const alwaysVisibleFieldKeys = new Set<WeldFieldKey>([
  'projectTitle',
  'subtitleCode',
  'line',
  'spool',
  'joint',
  'wdi',
  'weldDate',
  'finalStatus',
])
const requestAndResultFieldKeys = new Set<WeldFieldKey>([
  ...LNK_METHODS.flatMap((method) => [method.requestKey, method.resultKey]),
  'pstoRequest',
  'pstoResult',
])
const weldingJournalBlockedFieldKeys = new Set<WeldFieldKey>([
  ...requestAndResultFieldKeys,
  'createdAt',
  'finalStatus',
])
const weldingJournalHiddenFieldKeys = new Set<WeldFieldKey>([
  'pstoDate',
  'heatTreatmentDiagram',
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
  'pstoCreatedAt',
  ...lnkReportFieldKeys,
  ...lnkConclusionFieldKeys,
])
const heatTreatmentHiddenFieldKeys = new Set<WeldFieldKey>([
  'hasVik',
  'hasRk',
  'hasPvk',
  'hasUzk',
  'hasTvmt',
  'hasRfa',
  'hasStls',
  'hasMkk',
  'vikRequest',
  'rkRequest',
  'pvkRequest',
  'uzkRequest',
  'tvmtRequest',
  'rfaRequest',
  'stlsRequest',
  'mkkRequest',
  'vikResult',
  'rkResult',
  'pvkResult',
  'uzkResult',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'mkkResult',
  'finalStatus',
  'boq',
  'ks3',
  'createdAt',
  ...lnkReportFieldKeys,
  ...lnkConclusionFieldKeys,
])
const lnkHiddenFieldKeys = new Set<WeldFieldKey>([
  'pstoRequired',
  'pstoRequest',
  'pstoDate',
  'pstoResult',
  'heatTreatmentDiagram',
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
  'pstoCreatedAt',
  'boq',
  'ks3',
  'createdAt',
])
type EditingState = {
  record: WeldInput & { id?: number }
  focusField?: WeldFieldKey
}
type HeatTreatmentFieldEditingState = {
  record: WeldInput & { id: number }
  fieldKey: WeldFieldKey
  label: string
  kind: 'text' | 'date'
  value: string
  report?: 'heatTreatment' | 'lnk'
  mode?: 'text' | 'request' | 'result'
}
type LnkRequestDraftState = {
  methods: Set<WeldFieldKey>
}
type LnkResultDraftState = {
  requestName: string
  methodKey: WeldFieldKey | ''
  rowIds: Set<number>
  rowResults: Record<number, string>
  controlDate: string
  result: string
  conclusionNaming: RequestNamingState
  search: string
}
type PstoResultDraftState = {
  requestName: string
  rowIds: Set<number>
  pstoDate: string
  result: string
  diagramNaming: RequestNamingState
  search: string
}
type RequestNamingState = {
  mode: 'system' | 'custom'
  customName: string
}
type ActiveReport = 'weldingJournal' | 'heatTreatment' | 'lnk'
type WeldRow = WeldInput & { id: number }
const defaultRequestNamingState: RequestNamingState = { mode: 'system', customName: '' }

function Home() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const importHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestHighlightRef = useRef<{
    rows: Array<{ id?: number }>
    fieldKeys: WeldFieldKey[]
    createdAt: number
  } | null>(null)
  const previousReportRef = useRef<ActiveReport>('weldingJournal')
  const [activeReport, setActiveReport] = useState<ActiveReport>('weldingJournal')
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [heatTreatmentFilters, setHeatTreatmentFilters] = useState<Record<string, string>>({})
  const [lnkFilters, setLnkFilters] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [heatTreatmentFieldEditing, setHeatTreatmentFieldEditing] = useState<HeatTreatmentFieldEditingState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [highlightedRowIds, setHighlightedRowIds] = useState<Set<number>>(new Set())
  const [highlightedCellKeys, setHighlightedCellKeys] = useState<Set<string>>(new Set())
  const [selectedHeatTreatmentIds, setSelectedHeatTreatmentIds] = useState<Set<number>>(new Set())
  const [selectedLnkIds, setSelectedLnkIds] = useState<Set<number>>(new Set())
  const [lnkRequestDraft, setLnkRequestDraft] = useState<LnkRequestDraftState>(() => ({ methods: new Set() }))
  const [pstoRequestNaming, setPstoRequestNaming] = useState<RequestNamingState>(defaultRequestNamingState)
  const [pstoRequestSearch, setPstoRequestSearch] = useState('')
  const [isPstoRequestModalOpen, setIsPstoRequestModalOpen] = useState(false)
  const [isPstoResultModalOpen, setIsPstoResultModalOpen] = useState(false)
  const [pstoResultDraft, setPstoResultDraft] = useState<PstoResultDraftState>(() => createDefaultPstoResultDraft())
  const [lnkRequestNaming, setLnkRequestNaming] = useState<RequestNamingState>(defaultRequestNamingState)
  const [isLnkRequestModalOpen, setIsLnkRequestModalOpen] = useState(false)
  const [isLnkRequestManagerOpen, setIsLnkRequestManagerOpen] = useState(false)
  const [managedLnkRequestName, setManagedLnkRequestName] = useState('')
  const [managedLnkRequestNameDraft, setManagedLnkRequestNameDraft] = useState('')
  const [isLnkResultModalOpen, setIsLnkResultModalOpen] = useState(false)
  const [isLnkResultPreviewOpen, setIsLnkResultPreviewOpen] = useState(false)
  const [shouldPinPreviewedLnkResultRows, setShouldPinPreviewedLnkResultRows] = useState(false)
  const [lnkResultDraft, setLnkResultDraft] = useState<LnkResultDraftState>(() => createDefaultLnkResultDraft())
  const [lnkResultRequestSearch, setLnkResultRequestSearch] = useState('')
  const [isLnkResultManagerOpen, setIsLnkResultManagerOpen] = useState(false)
  const [managedLnkResultRequestName, setManagedLnkResultRequestName] = useState('')
  const [managedLnkResultMethodKey, setManagedLnkResultMethodKey] = useState<WeldFieldKey | ''>('')
  const [managedLnkResultRequestSearch, setManagedLnkResultRequestSearch] = useState('')
  const [managedLnkConclusionDrafts, setManagedLnkConclusionDrafts] = useState<Record<string, string>>({})
  const [managedLnkResultOrderIds, setManagedLnkResultOrderIds] = useState<number[] | null>(null)
  const [managedLnkResultPreview, setManagedLnkResultPreview] = useState<{ changeKey: string; rowId: number; methodKey: WeldFieldKey; result: string } | null>(null)
  const [managedLnkResultChangeHint, setManagedLnkResultChangeHint] = useState<{ changeKey: string; rowId: number; methodKey: WeldFieldKey; from: string; to: string } | null>(null)
  const [managedLnkPendingResultChanges, setManagedLnkPendingResultChanges] = useState<Record<string, string>>({})
  const [lnkRequestSearch, setLnkRequestSearch] = useState('')
  const [preservedLnkOrderIds, setPreservedLnkOrderIds] = useState<number[] | null>(null)
  const [isLnkShowMenuOpen, setIsLnkShowMenuOpen] = useState(false)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || editing) return
      setColumnFilters({})
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editing])

  useEffect(() => {
    function handleHorizontalScroll() {
      if (window.scrollX > 8) {
        setNavCollapsed(true)
      }
    }

    window.addEventListener('scroll', handleHorizontalScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleHorizontalScroll)
  }, [])

  useEffect(() => {
    return () => {
      if (importHighlightTimerRef.current) {
        clearTimeout(importHighlightTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let frameId: number | null = null
    if (previousReportRef.current !== activeReport) {
      previousReportRef.current = activeReport
      frameId = window.requestAnimationFrame(() => {
        window.scrollTo({ left: 0, top: 0, behavior: 'auto' })
      })
      replayLatestHighlight()
    }

    if (activeReport !== 'heatTreatment') {
      setSelectedHeatTreatmentIds(new Set())
      setHeatTreatmentFieldEditing(null)
      setPstoRequestNaming(defaultRequestNamingState)
      setPstoRequestSearch('')
      setIsPstoRequestModalOpen(false)
      setIsPstoResultModalOpen(false)
      setPstoResultDraft(createDefaultPstoResultDraft())
    }
    if (activeReport !== 'lnk') {
      setSelectedLnkIds(new Set())
      setLnkRequestDraft({ methods: new Set() })
      setLnkRequestNaming(defaultRequestNamingState)
      setIsLnkRequestModalOpen(false)
      setIsLnkResultModalOpen(false)
      setIsLnkResultPreviewOpen(false)
      setShouldPinPreviewedLnkResultRows(false)
      setLnkResultDraft(createDefaultLnkResultDraft())
      setLnkRequestSearch('')
      setPreservedLnkOrderIds(null)
    }

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [activeReport])

  const weldsQuery = useQuery({
    queryKey: ['weld-joints', emptyFilters],
    queryFn: async () => {
      try {
        const rows = await listWeldJoints({ data: emptyFilters })
        return Array.isArray(rows) ? rows : filterLocalWelds(emptyFilters)
      } catch {
        return filterLocalWelds(emptyFilters)
      }
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (value: WeldInput & { id?: number }) => {
      try {
        const saved = value.id ? await updateWeldJoint({ data: value }) : await createWeldJoint({ data: value })
        return saved ?? saveLocalWeld(value)
      } catch {
        return saveLocalWeld(value)
      }
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [variables], variables.id && editing?.focusField ? [editing.focusField] : [])
      setEditing(null)
      setMessage('Запись сохранена')
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      try {
        const result = await deleteWeldJoint({ data: { id } })
        if (result) return result
        deleteLocalWeld(id)
        return { ok: true }
      } catch {
        deleteLocalWeld(id)
        return { ok: true }
      }
    },
    onSuccess: async () => {
      setMessage('Запись удалена')
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const importMutation = useMutation({
    mutationFn: async (records: WeldInput[]) => {
      try {
        const result = await importWeldJoints({ data: { records } })
        if (result) return result
        const rows = importLocalWelds(records)
        return { inserted: rows.length, rows }
      } catch {
        const rows = importLocalWelds(records)
        return { inserted: rows.length, rows }
      }
    },
    onSuccess: async (result) => {
      highlightChangedRows(result.rows)
      setMessage(`Добавлено записей: ${result.inserted}`)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const heatTreatmentImportMutation = useMutation({
    mutationFn: async (records: WeldInput[]) => {
      const { updatedRows, changedFieldKeys, matched, skipped } = buildHeatTreatmentImportUpdates(
        records,
        heatTreatmentRows,
        rows,
        new Set(pstoRequestOptions),
      )
      if (updatedRows.length === 0) {
        return { updated: 0, rows: [], changedFieldKeys, matched, skipped }
      }

      try {
        const savedRows = await Promise.all(updatedRows.map((record) => updateWeldJoint({ data: record })))
        if (savedRows.every(Boolean)) {
          return {
            updated: savedRows.length,
            rows: savedRows as unknown as WeldRow[],
            changedFieldKeys,
            matched,
            skipped,
          }
        }
        updateLocalWelds(updatedRows)
        return { updated: updatedRows.length, rows: updatedRows, changedFieldKeys, matched, skipped }
      } catch {
        updateLocalWelds(updatedRows)
        return { updated: updatedRows.length, rows: updatedRows, changedFieldKeys, matched, skipped }
      }
    },
    onSuccess: async (result, variables) => {
      highlightChangedRows(result.rows, result.changedFieldKeys)
      setMessage(`Обновлено ПСТО: ${result.updated} из ${variables.length}; пропущено: ${result.skipped}`)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkImportMutation = useMutation({
    mutationFn: async (records: WeldInput[]) => {
      const { updatedRows, changedFieldKeys, matched, skipped } = buildEditableImportUpdates({
        importedRecords: records,
        targetRows: lnkRows,
        rows,
        editableFieldKeys: lnkEditableFieldKeys,
        normalizeValue: (fieldKey, value, currentRow) => {
          if (isLnkRequestField(fieldKey)) {
            if (!isLnkRequestAllowedForRow(currentRow, fieldKey)) return { skip: true, value: null }
            return normalizeExistingRequestImportValue(value, new Set(lnkRequestOptions))
          }
          return { skip: false, value: normalizeEditableImportValue(fieldKey, value) }
        },
        transformRow: (row) => {
          const nextRow = { ...row }
          for (const method of LNK_METHODS) {
            if (hasText(nextRow[method.resultKey]) && !hasText(nextRow[method.requestKey])) {
              nextRow[method.resultKey] = null
            }
          }
          const cleanedRow = clearDisabledLnkRequests(nextRow)
          const touchedRow = withTouchedLnkTimestamp(cleanedRow)
          return { ...touchedRow, finalStatus: calculateFinalStatus(touchedRow) }
        },
      })
      if (updatedRows.length === 0) {
        return { updated: 0, rows: [], changedFieldKeys, matched, skipped }
      }

      try {
        const savedRows = await Promise.all(updatedRows.map((record) => updateWeldJoint({ data: record })))
        if (savedRows.every(Boolean)) {
          return { updated: savedRows.length, rows: savedRows as unknown as WeldRow[], changedFieldKeys, matched, skipped }
        }
        updateLocalWelds(updatedRows)
        return { updated: updatedRows.length, rows: updatedRows, changedFieldKeys, matched, skipped }
      } catch {
        updateLocalWelds(updatedRows)
        return { updated: updatedRows.length, rows: updatedRows, changedFieldKeys, matched, skipped }
      }
    },
    onSuccess: async (result, variables) => {
      highlightChangedRows(result.rows, result.updated > 0 ? [...result.changedFieldKeys, 'lnkCreatedAt'] : result.changedFieldKeys)
      setMessage(`Обновлено ЛНК: ${result.updated} из ${variables.length}; пропущено: ${result.skipped}`)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const pstoRequestMutation = useMutation({
    mutationFn: async ({
      records,
      requestName,
    }: {
      records: Array<WeldInput & { id: number }>
      requestName: string
      mode?: 'create' | 'edit'
    }) => {
      const pstoUpdatedAt = new Date().toISOString()
      const updatedRecords = records.map((record) => ({ ...record, pstoRequest: requestName, pstoCreatedAt: pstoUpdatedAt }))
      try {
        const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
        if (savedRows.every(Boolean)) return savedRows
        updateLocalWelds(updatedRecords)
        return updatedRecords
      } catch {
        updateLocalWelds(updatedRecords)
        return updatedRecords
      }
    },
    onSuccess: async (_result, variables) => {
      highlightChangedRows(_result, ['pstoRequest', 'pstoCreatedAt'])
      setMessage(
        variables.mode === 'edit'
          ? 'Заявка ПСТО обновлена'
          : `Заявка ${variables.requestName} создана для стыков: ${variables.records.length}`,
      )
      setSelectedHeatTreatmentIds(new Set())
      setPstoRequestNaming(defaultRequestNamingState)
      setPstoRequestSearch('')
      setIsPstoRequestModalOpen(false)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const pstoResultMutation = useMutation({
    mutationFn: async ({
      records,
      pstoDate,
      result,
      diagramName,
      rows,
    }: {
      records: Array<WeldInput & { id: number }>
      pstoDate: string
      result: string
      diagramName: string
      rows: Array<WeldInput & { id: number }>
    }) => {
      const shouldClearResult = result === PSTO_EMPTY_RESULT_VALUE
      if (!shouldClearResult && result !== 'проведено') throw new Error('Выберите результат ПСТО')
      if (!shouldClearResult && !pstoDate) throw new Error('Укажите дату ПСТО')
      if (!shouldClearResult && !diagramName.trim()) throw new Error('Укажите наименование диаграммы термообработки')
      if (records.some((record) => !hasText(record.pstoRequest))) throw new Error('Сначала укажите заявку ПСТО')

      const pstoUpdatedAt = new Date().toISOString()
      const proposedRowsById = new Map<number, WeldInput & { id: number }>()
      for (const record of records) {
        proposedRowsById.set(record.id, {
          ...record,
          pstoDate: shouldClearResult ? null : pstoDate,
          pstoResult: shouldClearResult ? null : 'проведено',
          heatTreatmentDiagram: shouldClearResult ? null : diagramName.trim(),
          pstoCreatedAt: pstoUpdatedAt,
        })
      }
      const recalculatedRows = withAutoHeatTreatmentDiagrams(rows.map((row) => proposedRowsById.get(row.id) ?? row))
      const updatedRecords = recalculatedRows.filter((row) => proposedRowsById.has(row.id))
      try {
        const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
        if (savedRows.every(Boolean)) return savedRows as unknown as WeldRow[]
        updateLocalWelds(updatedRecords)
        return updatedRecords
      } catch {
        updateLocalWelds(updatedRecords)
        return updatedRecords
      }
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, ['pstoDate', 'pstoResult', 'heatTreatmentDiagram', 'pstoCreatedAt'])
      setMessage(
        variables.result === PSTO_EMPTY_RESULT_VALUE
          ? `Результат ПСТО аннулирован для стыков: ${savedRows.length}`
          : `Результат ПСТО внесен для стыков: ${savedRows.length}`,
      )
      setIsPstoResultModalOpen(false)
      setPstoResultDraft(createDefaultPstoResultDraft())
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const heatTreatmentFieldMutation = useMutation({
    mutationFn: async ({
      record,
      fieldKey,
      value,
      rows,
    }: {
      record: WeldInput & { id: number }
      fieldKey: WeldFieldKey
      value: string | null
      rows: Array<WeldInput & { id: number }>
    }) => {
      const updatedRecord = withAutoHeatTreatmentDiagram({ ...record, [fieldKey]: value }, rows)
      try {
        const saved = await updateWeldJoint({ data: updatedRecord })
        if (saved) return saved as unknown as WeldRow
        updateLocalWelds([updatedRecord])
        return updatedRecord
      } catch {
        updateLocalWelds([updatedRecord])
        return updatedRecord
      }
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], [variables.fieldKey])
      setMessage(`${variables.fieldKey === 'pstoDate' ? 'Дата ПСТО' : 'Поле ПСТО'} обновлено`)
      setHeatTreatmentFieldEditing(null)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkRequestMutation = useMutation({
    mutationFn: async ({
      records,
      methodKeys,
      requestName,
    }: {
      records: Array<WeldInput & { id: number }>
      methodKeys: WeldFieldKey[]
      requestName: string
    }) => {
      const updatedRecords = records.flatMap((record) => {
        const nextRecord = { ...record }
        let changed = false
        for (const requestKey of methodKeys) {
          const method = getLnkMethodByRequestKey(requestKey)
          if (!method) continue
          if (!isEnabledControlValue(record[method.enabledKey])) continue
          const existingRequestName = String(record[method.requestKey] ?? '').trim()
          if (existingRequestName) continue
          nextRecord[method.requestKey] = requestName
          if (!hasText(nextRecord[method.resultKey])) {
            nextRecord[method.resultKey] = 'ожидает НК'
          }
          changed = true
        }
        return changed ? [withTouchedLnkTimestamp(nextRecord)] : []
      })

      if (updatedRecords.length === 0) {
        throw new Error('Нет доступных стыков или видов контроля для новой заявки ЛНК')
      }

      try {
        const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
        if (savedRows.every(Boolean)) return savedRows as unknown as WeldRow[]
        updateLocalWelds(updatedRecords)
        return updatedRecords
      } catch {
        updateLocalWelds(updatedRecords)
        return updatedRecords
      }
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, [...variables.methodKeys, 'lnkCreatedAt'])
      setMessage(`Заявка ${variables.requestName} создана для стыков: ${savedRows.length}`)
      setSelectedLnkIds(new Set())
      setLnkRequestDraft({ methods: new Set() })
      setLnkRequestNaming(defaultRequestNamingState)
      setIsLnkRequestModalOpen(false)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkRequestCorrectionMutation = useMutation({
    mutationFn: async ({
      record,
      methodKey,
      requestName,
    }: {
      record: WeldInput & { id: number }
      methodKey: WeldFieldKey
      requestName: string | null
    }) => {
      const method = getLnkMethodByRequestKey(methodKey)
      if (!method) throw new Error('Выберите вид контроля')
      if (requestName && !isEnabledControlValue(record[method.enabledKey])) {
        throw new Error('Нельзя указать заявку ЛНК без наличия этого вида контроля')
      }

      const proposedRecord = { ...record } as WeldInput & { id: number }
      if (requestName) {
        proposedRecord[method.requestKey] = requestName
        if (!hasText(proposedRecord[method.resultKey])) {
          proposedRecord[method.resultKey] = 'ожидает НК'
        }
      } else {
        proposedRecord[method.requestKey] = null
        proposedRecord[method.resultKey] = null
        proposedRecord[method.conclusionDateKey] = null
        proposedRecord[method.conclusionKey] = null
      }

      const touchedRecord = withTouchedLnkTimestamp(proposedRecord)
      const updatedRecord = { ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }
      try {
        const saved = await updateWeldJoint({ data: updatedRecord })
        if (saved) return saved as unknown as WeldRow
        updateLocalWelds([updatedRecord])
        return updatedRecord
      } catch {
        updateLocalWelds([updatedRecord])
        return updatedRecord
      }
    },
    onSuccess: async (saved, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      const changedFieldKeys = method
        ? [method.requestKey, method.resultKey, method.conclusionDateKey, method.conclusionKey, 'lnkCreatedAt', 'finalStatus']
        : ['lnkCreatedAt', 'finalStatus']
      highlightChangedRows(saved ? [saved] : [], changedFieldKeys)
      if (!variables.requestName && method) {
        const removedRequestName = String(variables.record[method.requestKey] ?? '').trim()
        const hasRemainingRequestPositions = lnkRows.some((row) =>
          LNK_METHODS.some((candidateMethod) => {
            const isRemovedPosition = row.id === variables.record.id && candidateMethod.requestKey === method.requestKey
            return !isRemovedPosition && String(row[candidateMethod.requestKey] ?? '').trim() === removedRequestName
          }),
        )
        if (removedRequestName && !hasRemainingRequestPositions) {
          setManagedLnkRequestName('')
          setManagedLnkRequestNameDraft('')
          setMessage(`Заявка ${removedRequestName} удалена, так как в ней не осталось позиций`)
        } else {
          setMessage('Позиция заявки ЛНК удалена')
        }
      } else {
        setMessage(variables.requestName ? 'Заявка ЛНК заменена' : 'Заявка ЛНК удалена')
      }
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkRequestManagerMutation = useMutation({
    mutationFn: async ({
      requestName,
      nextRequestName,
      action,
    }: {
      requestName: string
      nextRequestName?: string
      action: 'rename' | 'delete'
    }) => {
      const currentName = requestName.trim()
      const renamedName = nextRequestName?.trim() ?? ''
      if (!currentName) throw new Error('Выберите заявку ЛНК')
      if (action === 'rename') {
        if (!renamedName) throw new Error('Введите новое наименование заявки')
        if (renamedName === currentName) throw new Error('Новое наименование совпадает с текущим')
        if (lnkRequestOptions.includes(renamedName)) throw new Error('Заявка с таким наименованием уже существует')
      }

      const updatedRecords = lnkRows.flatMap((record) => {
        const nextRecord = { ...record } as WeldInput & { id: number }
        let changed = false
        for (const method of LNK_METHODS) {
          if (String(record[method.requestKey] ?? '').trim() !== currentName) continue
          if (action === 'rename') {
            nextRecord[method.requestKey] = renamedName
          } else {
            nextRecord[method.requestKey] = null
            nextRecord[method.resultKey] = null
            nextRecord[method.conclusionDateKey] = null
            nextRecord[method.conclusionKey] = null
          }
          changed = true
        }
        if (!changed) return []
        const touchedRecord = withTouchedLnkTimestamp(nextRecord)
        return [{ ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }]
      })

      if (updatedRecords.length === 0) throw new Error('Заявка ЛНК не найдена')

      try {
        const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
        if (savedRows.every(Boolean)) return savedRows as unknown as WeldRow[]
        updateLocalWelds(updatedRecords)
        return updatedRecords
      } catch {
        updateLocalWelds(updatedRecords)
        return updatedRecords
      }
    },
    onSuccess: async (savedRows, variables) => {
      const requestFields = [...lnkRequestFieldKeys, 'lnkCreatedAt', 'finalStatus'] as WeldFieldKey[]
      const generatedFields =
        variables.action === 'delete'
          ? [...LNK_METHODS.flatMap((method) => [method.resultKey, method.conclusionDateKey, method.conclusionKey]), ...requestFields]
          : requestFields
      highlightChangedRows(savedRows, generatedFields)
      setMessage(
        variables.action === 'rename'
          ? `Заявка ${variables.requestName} переименована в ${variables.nextRequestName}`
          : `Заявка ${variables.requestName} удалена`,
      )
      if (variables.action === 'rename' && variables.nextRequestName) {
        setManagedLnkRequestName(variables.nextRequestName)
        setManagedLnkRequestNameDraft(variables.nextRequestName)
      } else {
        setManagedLnkRequestName('')
        setManagedLnkRequestNameDraft('')
        setIsLnkRequestManagerOpen(false)
      }
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkResultMutation = useMutation({
    mutationFn: async ({
      records,
      methodKey,
      controlDate,
      resultById,
      conclusionName,
    }: {
      records: Array<WeldInput & { id: number }>
      methodKey: WeldFieldKey
      controlDate: string
      resultById: Record<number, string>
      conclusionName: string
    }) => {
      const method = getLnkMethodByRequestKey(methodKey)
      if (!method) throw new Error('Выберите метод контроля')
      const results = records.map((record) => resultById[record.id] ?? '')
      const hasNonEmptyResult = results.some((result) => result !== LNK_EMPTY_RESULT_VALUE)
      if (results.some((result) => !isValidLnkResultDraftValue(result))) throw new Error('Укажите результат для каждого выбранного стыка')
      if (hasNonEmptyResult && !controlDate) throw new Error('Укажите дату контроля')
      if (hasNonEmptyResult && !conclusionName.trim()) throw new Error('Укажите наименование заключения')

      const lnkUpdatedAt = new Date().toISOString()
      const updatedRecords = records.map((record) => {
        const result = resultById[record.id] ?? ''
        const shouldClearResult = result === LNK_EMPTY_RESULT_VALUE
        const proposedRecord = {
          ...record,
          [method.resultKey]: shouldClearResult ? null : result,
          [method.conclusionDateKey]: shouldClearResult ? null : controlDate,
          [method.conclusionKey]: shouldClearResult ? null : conclusionName.trim(),
          lnkCreatedAt: lnkUpdatedAt,
        }
        return { ...proposedRecord, finalStatus: calculateFinalStatus(proposedRecord) }
      })

      try {
        const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
        if (savedRows.every(Boolean)) return savedRows as unknown as WeldRow[]
        updateLocalWelds(updatedRecords)
        return updatedRecords
      } catch {
        updateLocalWelds(updatedRecords)
        return updatedRecords
      }
    },
    onSuccess: async (savedRows, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      const changedFieldKeys = method
        ? [method.resultKey, method.conclusionDateKey, method.conclusionKey, 'lnkCreatedAt', 'finalStatus']
        : ['lnkCreatedAt', 'finalStatus']
      highlightChangedRows(savedRows, changedFieldKeys)
      const changedResults = Object.values(variables.resultById)
      setMessage(
        changedResults.every((result) => result === LNK_EMPTY_RESULT_VALUE)
          ? `Результат ЛНК очищен для стыков: ${savedRows.length}`
          : `Результат ЛНК внесен для стыков: ${savedRows.length}`,
      )
      setIsLnkResultModalOpen(false)
      setLnkResultDraft(createDefaultLnkResultDraft())
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkResultCorrectionMutation = useMutation({
    mutationFn: async ({
      record,
      methodKey,
      result,
    }: {
      record: WeldInput & { id: number }
      methodKey: WeldFieldKey
      result: string | null
    }) => {
      const method = getLnkMethodByRequestKey(methodKey)
      if (!method) throw new Error('Выберите метод контроля')
      if (result && !LNK_RESULT_OPTIONS.includes(result as never)) throw new Error('Укажите корректный результат')
      const proposedRecord = {
        ...record,
        [method.resultKey]: result,
        [method.conclusionDateKey]: result ? record[method.conclusionDateKey] : null,
        [method.conclusionKey]: result ? record[method.conclusionKey] : null,
      } as WeldInput & { id: number }
      const touchedRecord = withTouchedLnkTimestamp(proposedRecord)
      const updatedRecord = { ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }

      try {
        const saved = await updateWeldJoint({ data: updatedRecord })
        if (saved) return saved as unknown as WeldRow
        updateLocalWelds([updatedRecord])
        return updatedRecord
      } catch {
        updateLocalWelds([updatedRecord])
        return updatedRecord
      }
    },
    onSuccess: async (saved, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      const changedFieldKeys = method
        ? [method.resultKey, method.conclusionDateKey, method.conclusionKey, 'lnkCreatedAt', 'finalStatus']
        : ['lnkCreatedAt', 'finalStatus']
      highlightChangedRows(saved ? [saved] : [], changedFieldKeys)
      setMessage(variables.result ? 'Результат ЛНК изменен' : 'Результат ЛНК удален')
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkResultReplacementMutation = useMutation({
    mutationFn: async ({
      updates,
    }: {
      updates: Array<{ record: WeldInput & { id: number }; methodKey: WeldFieldKey; result: string }>
    }) => {
      const updatedById = new Map<number, WeldInput & { id: number }>()
      for (const { record, methodKey, result } of updates) {
        const method = getLnkMethodByRequestKey(methodKey)
        if (!method) throw new Error('Выберите метод контроля')
        if (!LNK_RESULT_OPTIONS.includes(result as never)) throw new Error('Укажите корректный результат')
        const currentRecord = updatedById.get(record.id) ?? record
        updatedById.set(record.id, {
          ...currentRecord,
          [method.resultKey]: result,
        } as WeldInput & { id: number })
      }
      const updatedRecords = [...updatedById.values()].map((record) => {
        const touchedRecord = withTouchedLnkTimestamp(record)
        return { ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }
      })

      try {
        const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
        if (savedRows.every(Boolean)) return savedRows as unknown as WeldRow[]
        updateLocalWelds(updatedRecords)
        return updatedRecords
      } catch {
        updateLocalWelds(updatedRecords)
        return updatedRecords
      }
    },
    onSuccess: async (savedRows, variables) => {
      const changedFieldKeys = [
        ...new Set(
          variables.updates
            .map(({ methodKey }) => getLnkMethodByRequestKey(methodKey)?.resultKey)
            .filter(Boolean) as WeldFieldKey[],
        ),
        'lnkCreatedAt',
        'finalStatus',
      ]
      highlightChangedRows(savedRows, changedFieldKeys)
      const savedKeys = new Set(variables.updates.map(({ record, methodKey }) => getManagedLnkResultChangeKey(record.id, methodKey)))
      setManagedLnkPendingResultChanges((current) =>
        Object.fromEntries(Object.entries(current).filter(([changeKey]) => !savedKeys.has(changeKey))),
      )
      setManagedLnkResultChangeHint(null)
      setManagedLnkResultPreview(null)
      setMessage(`Результат ЛНК изменен для стыков: ${savedRows.length}`)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkConclusionCorrectionMutation = useMutation({
    mutationFn: async ({
      records,
      methodKey,
      conclusionName,
    }: {
      records: Array<WeldInput & { id: number }>
      methodKey: WeldFieldKey
      conclusionName: string
    }) => {
      const method = getLnkMethodByRequestKey(methodKey)
      const nextConclusionName = conclusionName.trim()
      if (!method) throw new Error('Выберите метод контроля')
      if (!nextConclusionName) throw new Error('Укажите наименование заключения')

      const updatedRecords = records
        .filter((record) => hasText(record[method.resultKey]))
        .map((record) => {
          const proposedRecord = {
            ...record,
            [method.conclusionKey]: nextConclusionName,
          } as WeldInput & { id: number }
          const touchedRecord = withTouchedLnkTimestamp(proposedRecord)
          return { ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }
        })

      if (updatedRecords.length === 0) throw new Error('Нет результатов для переименования заключения')

      try {
        const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
        if (savedRows.every(Boolean)) return savedRows as unknown as WeldRow[]
        updateLocalWelds(updatedRecords)
        return updatedRecords
      } catch {
        updateLocalWelds(updatedRecords)
        return updatedRecords
      }
    },
    onSuccess: async (savedRows, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      const changedFieldKeys = method ? [method.conclusionKey, 'lnkCreatedAt', 'finalStatus'] : ['lnkCreatedAt', 'finalStatus']
      highlightChangedRows(savedRows, changedFieldKeys)
      setMessage(`Заключение переименовано для позиций: ${savedRows.length}`)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkFieldMutation = useMutation({
    mutationFn: async ({
      record,
      fieldKey,
      value,
    }: {
      record: WeldInput & { id: number }
      fieldKey: WeldFieldKey
      value: string | null
    }) => {
      const method = getLnkMethodByResultKey(fieldKey)
      if (method && value && !hasText(record[method.requestKey])) {
        throw new Error('Сначала создайте заявку ЛНК для этого вида контроля')
      }
      const requestMethod = getLnkMethodByRequestKey(fieldKey)
      if (requestMethod && value && !isEnabledControlValue(record[requestMethod.enabledKey])) {
        throw new Error('Нельзя указать заявку ЛНК без наличия этого вида контроля')
      }
      if (isLnkRequestField(fieldKey) && value && !lnkRequestOptions.includes(value)) {
        throw new Error('Можно выбрать только существующую заявку ЛНК или очистить поле')
      }

      const proposedRecord = clearDisabledLnkRequests(withTouchedLnkTimestamp(applyLnkFieldUpdate(record, fieldKey, value)))
      const updatedRecord = { ...proposedRecord, finalStatus: calculateFinalStatus(proposedRecord) }
      try {
        const saved = await updateWeldJoint({ data: updatedRecord })
        if (saved) return saved as unknown as WeldRow
        updateLocalWelds([updatedRecord])
        return updatedRecord
      } catch {
        updateLocalWelds([updatedRecord])
        return updatedRecord
      }
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], [variables.fieldKey, 'lnkCreatedAt', 'finalStatus'])
      setMessage('Поле ЛНК обновлено')
      setHeatTreatmentFieldEditing(null)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const clearLnkGeneratedDataMutation = useMutation({
    mutationFn: async (targetRows: WeldRow[]) => {
      const updatedRows = targetRows.flatMap((row) => {
        const cleanedRow = clearLnkGeneratedData(row)
        return hasLnkGeneratedDataChanged(row, cleanedRow) ? [{ ...cleanedRow, finalStatus: calculateFinalStatus(cleanedRow) }] : []
      })
      if (updatedRows.length === 0) return []

      try {
        const savedRows = await clearLnkGeneratedWeldData()
        if (Array.isArray(savedRows)) return savedRows as unknown as WeldRow[]
        throw new Error('LNK cleanup server result is unavailable')
      } catch {
        return clearLocalLnkGeneratedData()
      }
    },
    onSuccess: async (savedRows) => {
      highlightChangedRows(savedRows, [...lnkGeneratedFieldKeys, 'finalStatus'])
      setSelectedLnkIds(new Set())
      setLnkResultDraft(createDefaultLnkResultDraft())
      setMessage(savedRows.length > 0 ? `Очищены результаты и заключения ЛНК: ${savedRows.length} строк` : 'В ЛНК нечего очищать')
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const rows = useMemo(
    () =>
      (weldsQuery.data ?? []).map((row): WeldRow => {
        const normalizedRow = clearDisabledLnkRequests(withAutoVikForWeldDate(normalizeRowPstoRequest(row as WeldRow)))
        const withTimestamps = withPstoCreatedAt([normalizedRow])[0]
        const withPendingLnk = withPendingLnkResults(withTimestamps)
        const withCancellationState = toControlCancellationReportRow(withPendingLnk)
        return { ...withCancellationState, finalStatus: calculateFinalStatus(withCancellationState) }
      }),
    [weldsQuery.data],
  )

  const heatTreatmentRows = useMemo(
    () => rows.filter(hasHeatTreatmentReportState).map(toHeatTreatmentReportRow).sort(compareHeatTreatmentReportRows),
    [rows],
  )
  const availablePstoRequestRows = useMemo(() => heatTreatmentRows.filter(canCreatePstoRequest), [heatTreatmentRows])
  const filteredPstoRequestRows = useMemo(
    () => filterPstoRequestRows(heatTreatmentRows, pstoRequestSearch),
    [heatTreatmentRows, pstoRequestSearch],
  )
  const filteredAvailablePstoRequestRows = useMemo(
    () => filteredPstoRequestRows.filter(canCreatePstoRequest),
    [filteredPstoRequestRows],
  )
  const lnkRows = useMemo(() => {
    const sortedRows = rows.filter(hasAnyLnkReportControl).map(toLnkReportRow).sort(compareLnkReportRows)
    return preservedLnkOrderIds ? sortRowsByPreservedOrder(sortedRows, preservedLnkOrderIds) : sortedRows
  }, [preservedLnkOrderIds, rows])
  const availableLnkRequestRows = useMemo(() => lnkRows.filter(canCreateLnkRequest), [lnkRows])
  const filteredLnkRequestRows = useMemo(
    () => filterLnkRequestRows(lnkRows, lnkRequestSearch),
    [lnkRequestSearch, lnkRows],
  )
  const filteredAvailableLnkRequestRows = useMemo(
    () => filteredLnkRequestRows.filter(canCreateLnkRequest),
    [filteredLnkRequestRows],
  )
  const visibleRows = activeReport === 'heatTreatment' ? heatTreatmentRows : activeReport === 'lnk' ? lnkRows : rows
  const selectedHeatTreatmentRows = useMemo(
    () => availablePstoRequestRows.filter((row) => selectedHeatTreatmentIds.has(row.id)),
    [availablePstoRequestRows, selectedHeatTreatmentIds],
  )
  const selectedLnkRows = useMemo(
    () => availableLnkRequestRows.filter((row) => selectedLnkIds.has(row.id)),
    [availableLnkRequestRows, selectedLnkIds],
  )
  const selectedLnkMethodKeys = useMemo(() => [...lnkRequestDraft.methods], [lnkRequestDraft.methods])
  const selectedLnkRequestTargetCount = useMemo(
    () => countLnkRequestTargets(selectedLnkRows, selectedLnkMethodKeys),
    [selectedLnkMethodKeys, selectedLnkRows],
  )
  const nextPstoRequestName = useMemo(() => formatPstoRequestName(heatTreatmentRows), [heatTreatmentRows])
  const nextLnkRequestName = useMemo(() => formatLnkRequestName(rows), [rows])
  const pstoRequestOptions = useMemo(() => collectRequestNames(rows, ['pstoRequest']), [rows])
  const pstoResultRequestOptions = useMemo(() => sortPstoRequestNamesNewestFirst(collectRequestNames(heatTreatmentRows, ['pstoRequest'])), [heatTreatmentRows])
  const lnkRequestOptions = useMemo(() => collectRequestNames(rows, lnkRequestFieldKeys), [rows])
  const lnkRequestManagerOptions = useMemo(() => sortLnkRequestNamesNewestFirst(lnkRequestOptions), [lnkRequestOptions])
  const lnkResultRequestOptions = useMemo(() => collectLnkResultRequestNames(lnkRows), [lnkRows])
  const managedLnkRequestRows = useMemo(() => filterLnkRowsByRequestName(lnkRows, managedLnkRequestName), [lnkRows, managedLnkRequestName])
  const managedLnkRequestMethods = useMemo(
    () => getLnkRequestMethodsForRows(managedLnkRequestRows, managedLnkRequestName),
    [managedLnkRequestName, managedLnkRequestRows],
  )
  const nextLnkConclusionName = useMemo(
    () => formatLnkConclusionName(rows, lnkResultDraft.controlDate, lnkResultDraft.methodKey),
    [lnkResultDraft.controlDate, lnkResultDraft.methodKey, rows],
  )
  const nextPstoDiagramName = useMemo(
    () => formatPstoDiagramName(rows, pstoResultDraft.pstoDate),
    [pstoResultDraft.pstoDate, rows],
  )
  const selectedPstoResultRequestRows = useMemo(
    () => filterPstoRowsByRequestName(heatTreatmentRows, pstoResultDraft.requestName),
    [heatTreatmentRows, pstoResultDraft.requestName],
  )
  const pstoResultSelectedRows = useMemo(
    () => heatTreatmentRows.filter((row) => pstoResultDraft.rowIds.has(row.id)),
    [heatTreatmentRows, pstoResultDraft.rowIds],
  )
  const pstoResultAvailableRequestOptions = useMemo(() => {
    const selectedRequestOptions = sortPstoRequestNamesNewestFirst(collectRequestNames(pstoResultSelectedRows, ['pstoRequest']))
    return selectedRequestOptions.length > 0 ? selectedRequestOptions : pstoResultRequestOptions
  }, [pstoResultRequestOptions, pstoResultSelectedRows])
  const pstoResultSearchRows = pstoResultDraft.requestName ? selectedPstoResultRequestRows : heatTreatmentRows
  const filteredPstoResultRows = useMemo(
    () => filterPstoResultRows(pstoResultSearchRows, pstoResultDraft.search),
    [pstoResultDraft.search, pstoResultSearchRows],
  )
  const selectedPstoResultRows = useMemo(
    () =>
      filteredPstoResultRows.filter(
        (row) => pstoResultDraft.rowIds.has(row.id) && canSelectPstoResultRow(row, pstoResultDraft.requestName),
      ),
    [filteredPstoResultRows, pstoResultDraft.requestName, pstoResultDraft.rowIds],
  )
  const selectedLnkResultRequestRows = useMemo(
    () => filterLnkRowsByRequestName(lnkRows, lnkResultDraft.requestName),
    [lnkResultDraft.requestName, lnkRows],
  )
  const lnkResultSelectedRows = useMemo(
    () => lnkRows.filter((row) => lnkResultDraft.rowIds.has(row.id)),
    [lnkResultDraft.rowIds, lnkRows],
  )
  const lnkResultMethodRequestOptions = useMemo(() => {
    const method = getLnkMethodByRequestKey(lnkResultDraft.methodKey)
    if (!method) return lnkResultRequestOptions
    return sortLnkRequestNamesNewestFirst([
      ...new Set(
        lnkRows.flatMap((row) => {
          const requestName = String(row[method.requestKey] ?? '').trim()
          if (!requestName || isFinalLnkResultValue(row[method.resultKey])) return []
          return [requestName]
        }),
      ),
    ])
  }, [lnkResultDraft.methodKey, lnkResultRequestOptions, lnkRows])
  const lnkResultAvailableRequestOptions = useMemo(() => {
    return lnkResultMethodRequestOptions
  }, [lnkResultMethodRequestOptions])
  const filteredLnkResultRequestOptions = useMemo(() => {
    const query = normalizeSearchText(lnkResultRequestSearch)
    const compactQuery = compactSearchText(query)
    const options = !query
      ? lnkResultAvailableRequestOptions
      : lnkResultAvailableRequestOptions.filter((requestName) => {
          const haystack = normalizeSearchText(requestName)
          return haystack.includes(query) || compactSearchText(haystack).includes(compactQuery)
        })
    return withCurrentOption(options, lnkResultDraft.requestName)
  }, [lnkResultAvailableRequestOptions, lnkResultDraft.requestName, lnkResultRequestSearch])
  const filteredManagedLnkResultRequestOptions = useMemo(() => {
    const query = normalizeSearchText(managedLnkResultRequestSearch)
    const compactQuery = compactSearchText(query)
    const options = !query
      ? lnkResultRequestOptions
      : lnkResultRequestOptions.filter((requestName) => {
          const haystack = normalizeSearchText(requestName)
          return haystack.includes(query) || compactSearchText(haystack).includes(compactQuery)
        })
    return withCurrentOption(options, managedLnkResultRequestName)
  }, [lnkResultRequestOptions, managedLnkResultRequestName, managedLnkResultRequestSearch])
  const managedLnkResultRows = useMemo(
    () => {
      if (managedLnkResultOrderIds) {
        const selectedIds = new Set(managedLnkResultOrderIds)
        return sortRowsByPreservedOrder(
          lnkRows.filter((row) => selectedIds.has(row.id)),
          managedLnkResultOrderIds,
        )
      }
      const requestRows = filterLnkRowsByRequestName(lnkRows, managedLnkResultRequestName)
      return requestRows
    },
    [lnkRows, managedLnkResultOrderIds, managedLnkResultRequestName],
  )
  const managedLnkResultMethods = useMemo(
    () => getLnkResultMethodsForRows(managedLnkResultRows, managedLnkResultRequestName),
    [managedLnkResultRequestName, managedLnkResultRows],
  )
  const managedLnkResultMethodRows = useMemo(
    () =>
      managedLnkResultRows.filter((row) => {
        const method = getLnkMethodByRequestKey(managedLnkResultMethodKey)
        return Boolean(
          method &&
            isLnkResultRowApplicable(row, managedLnkResultRequestName, managedLnkResultMethodKey) &&
            isFinalLnkResultValue(row[method.resultKey]),
        )
      }),
    [managedLnkResultMethodKey, managedLnkResultRequestName, managedLnkResultRows],
  )
  const managedLnkResultEntries = useMemo(
    () =>
      (managedLnkResultMethodKey
        ? managedLnkResultMethodRows.flatMap((row) => {
            const method = getLnkMethodByRequestKey(managedLnkResultMethodKey)
            return method ? [{ row, method, changeKey: getManagedLnkResultChangeKey(row.id, method.requestKey) }] : []
          })
        : managedLnkResultRows.flatMap((row) =>
            LNK_METHODS.flatMap((method) =>
              isLnkResultRowApplicable(row, managedLnkResultRequestName, method.requestKey) &&
              isFinalLnkResultValue(row[method.resultKey])
                ? [{ row, method, changeKey: getManagedLnkResultChangeKey(row.id, method.requestKey) }]
                : [],
            ),
          )),
    [managedLnkResultMethodKey, managedLnkResultMethodRows, managedLnkResultRequestName, managedLnkResultRows],
  )
  const managedLnkPendingResultRows = useMemo(() => {
    return managedLnkResultEntries.filter(({ row, method, changeKey }) => {
      const nextResult = managedLnkPendingResultChanges[changeKey]
      const currentResult = String(row[method.resultKey] ?? '').trim()
      return Boolean(nextResult && nextResult !== currentResult)
    })
  }, [managedLnkPendingResultChanges, managedLnkResultEntries])
  useEffect(() => {
    if (!isLnkResultManagerOpen) return
    setManagedLnkConclusionDrafts(
      Object.fromEntries(
        managedLnkResultEntries.map(({ row, method, changeKey }) => [changeKey, String(row[method.conclusionKey] ?? '').trim()]),
      ),
    )
  }, [isLnkResultManagerOpen, managedLnkResultEntries])
  useEffect(() => {
    if (!isLnkResultManagerOpen) return
    if (managedLnkResultMethodKey && !managedLnkResultMethods.some((method) => method.requestKey === managedLnkResultMethodKey)) {
      setManagedLnkResultMethodKey('')
    }
  }, [isLnkResultManagerOpen, managedLnkResultMethodKey, managedLnkResultMethods, managedLnkResultRequestName])
  const lnkResultSearchRows = useMemo(() => {
    const baseRows = lnkResultDraft.requestName ? selectedLnkResultRequestRows : lnkRows
    const method = getLnkMethodByRequestKey(lnkResultDraft.methodKey)
    if (!method) return baseRows
    return baseRows.filter(
      (row) => isLnkResultRowApplicable(row, lnkResultDraft.requestName, lnkResultDraft.methodKey) && !isFinalLnkResultValue(row[method.resultKey]),
    )
  }, [lnkResultDraft.methodKey, lnkResultDraft.requestName, lnkRows, selectedLnkResultRequestRows])
  const lnkResultMethodRows =
    lnkResultDraft.rowIds.size > 0
      ? lnkResultSelectedRows
      : lnkResultDraft.requestName
        ? selectedLnkResultRequestRows
        : lnkRows
  const selectedLnkResultMethods = useMemo(
    () => getLnkInputMethodsForRows(lnkResultMethodRows, ''),
    [lnkResultMethodRows],
  )
  const filteredLnkResultRows = useMemo(
    () => filterLnkResultRows(lnkResultSearchRows, lnkResultDraft.search, lnkResultDraft.methodKey),
    [lnkResultDraft.methodKey, lnkResultDraft.search, lnkResultSearchRows],
  )
  const lnkResultContextReady = Boolean(lnkResultDraft.methodKey)
  const visibleLnkResultRows = useMemo(() => {
    if (!shouldPinPreviewedLnkResultRows || lnkResultDraft.rowIds.size === 0) return filteredLnkResultRows

    return [...filteredLnkResultRows].sort((left, right) => {
      const leftSelected = lnkResultDraft.rowIds.has(left.id)
      const rightSelected = lnkResultDraft.rowIds.has(right.id)
      if (leftSelected === rightSelected) return 0
      return leftSelected ? -1 : 1
    })
  }, [filteredLnkResultRows, lnkResultDraft.rowIds, shouldPinPreviewedLnkResultRows])
  const selectableVisibleLnkResultRows = useMemo(
    () => visibleLnkResultRows.filter((row) => canSelectLnkResultRow(row, lnkResultDraft.requestName, lnkResultDraft.methodKey)),
    [lnkResultDraft.methodKey, lnkResultDraft.requestName, visibleLnkResultRows],
  )
  const canBulkToggleLnkResultRows = Boolean(
    lnkResultDraft.methodKey &&
      selectableVisibleLnkResultRows.length > 0 &&
      (lnkResultDraft.requestName || lnkResultDraft.search.trim() || visibleLnkResultRows.length <= 20),
  )
  const selectedLnkResultRows = useMemo(
    () =>
      lnkRows.filter(
        (row) => lnkResultDraft.rowIds.has(row.id) && canSelectLnkResultRow(row, '', lnkResultDraft.methodKey),
      ),
    [lnkResultDraft.methodKey, lnkResultDraft.rowIds, lnkRows],
  )
  const lnkResultSaveBlockReason = useMemo(() => {
    if (lnkResultMutation.isPending) return 'Результат сохраняется, дождитесь завершения.'
    if (!lnkResultDraft.methodKey) return 'Выберите метод контроля.'
    if (selectedLnkResultRows.length === 0) return 'Отметьте один или несколько стыков галочкой.'
    if (!areLnkResultDraftRowsReady(selectedLnkResultRows, lnkResultDraft)) return 'Укажите результат для каждого выбранного стыка.'
    if (hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft) && !lnkResultDraft.controlDate) {
      return 'Укажите дату контроля.'
    }
    if (
      hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft) &&
      !getRequestNameFromNaming(lnkResultDraft.conclusionNaming, nextLnkConclusionName)
    ) {
      return 'Укажите наименование заключения.'
    }
    return ''
  }, [
    lnkResultDraft,
    lnkResultMutation.isPending,
    nextLnkConclusionName,
    selectedLnkResultRows,
  ])
  const isLnkResultSaveDisabled = Boolean(lnkResultSaveBlockReason)
  const activeColumnFilters =
    activeReport === 'heatTreatment' ? heatTreatmentFilters : activeReport === 'lnk' ? lnkFilters : columnFilters
  const activeFiltersSetter =
    activeReport === 'heatTreatment' ? setHeatTreatmentFilters : activeReport === 'lnk' ? setLnkFilters : setColumnFilters
  const acceptedWdiTotal = useMemo(() => sumAcceptedWdi(rows), [rows])
  const registerMinWidth = getWeldTableWidth(VISIBLE_FIELDS)
  const stickyLeft = navCollapsed ? 80 : 288
  const activeTitle =
    activeReport === 'heatTreatment' ? 'Термообработка' : activeReport === 'lnk' ? 'ЛНК' : 'Сварочный журнал'

  useEffect(() => {
    setSelectedHeatTreatmentIds((current) => {
      const selectableIds = new Set(availablePstoRequestRows.map((row) => row.id))
      const next = new Set([...current].filter((id) => selectableIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [availablePstoRequestRows])

  useEffect(() => {
    setPstoResultDraft((current) => {
      if (!isPstoResultModalOpen) return current
      const selectedRows = heatTreatmentRows.filter((row) => current.rowIds.has(row.id))
      const requestOptions = sortPstoRequestNamesNewestFirst(collectRequestNames(selectedRows, ['pstoRequest']))
      const allowedRequestOptions = requestOptions.length > 0 ? requestOptions : pstoResultRequestOptions
      const requestName = !current.requestName || allowedRequestOptions.includes(current.requestName) ? current.requestName : ''
      const availableRows = filterPstoResultRows(requestName ? filterPstoRowsByRequestName(heatTreatmentRows, requestName) : heatTreatmentRows, current.search)
      const availableIds = new Set(availableRows.filter((row) => canSelectPstoResultRow(row, requestName)).map((row) => row.id))
      const rowIds = new Set([...current.rowIds].filter((id) => availableIds.has(id)))
      return { ...current, requestName, rowIds }
    })
  }, [heatTreatmentRows, isPstoResultModalOpen, pstoResultRequestOptions])

  useEffect(() => {
    setSelectedLnkIds((current) => {
      const ids = new Set(availableLnkRequestRows.map((row) => row.id))
      const next = new Set([...current].filter((id) => ids.has(id)))
      return next.size === current.size ? current : next
    })
  }, [availableLnkRequestRows])

  useEffect(() => {
    setLnkResultDraft((current) => {
      if (!isLnkResultModalOpen) return current
      const selectedRows = lnkRows.filter((row) => current.rowIds.has(row.id))
      const requestName = !current.requestName || lnkResultRequestOptions.includes(current.requestName) ? current.requestName : ''
      const requestRows = filterLnkRowsByRequestName(lnkRows, requestName)
      const methodRows = current.rowIds.size > 0 ? [...selectedRows, ...requestRows] : requestName ? requestRows : lnkRows
      const methods = getLnkInputMethodsForRows(methodRows, '')
      const methodKey = !current.methodKey || methods.some((method) => method.requestKey === current.methodKey) ? current.methodKey : ''
      const rowIds = new Set(
        [...current.rowIds].filter((id) => {
          const row = lnkRows.find((candidate) => candidate.id === id)
          return row ? !methodKey || canSelectLnkResultRow(row, '', methodKey) : false
        }),
      )
      return { ...current, requestName, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
    })
  }, [isLnkResultModalOpen, lnkRequestOptions, lnkResultRequestOptions, lnkRows])

  async function handleImport(file: File) {
    setMessage(null)
    if (activeReport === 'heatTreatment' || activeReport === 'lnk') {
      const editableFieldKeys = activeReport === 'heatTreatment' ? heatTreatmentEditableFieldKeys : lnkEditableFieldKeys
      const matchFieldKeys = activeReport === 'heatTreatment' ? heatTreatmentImportMatchFieldKeys : lnkImportMatchFieldKeys
      const options = {
        editableFieldKeys,
        matchFieldKeys,
      }
      const result = file.name.toLowerCase().endsWith('.csv')
        ? parseEditableCsv(await file.text(), options)
        : parseEditableWorkbook(await file.arrayBuffer(), options)
      const importResult =
        activeReport === 'heatTreatment'
          ? await heatTreatmentImportMutation.mutateAsync(result.records)
          : await lnkImportMutation.mutateAsync(result.records)
      setMessage(
        `Обновлено ${activeReport === 'heatTreatment' ? 'ПСТО' : 'ЛНК'}: ${importResult.updated}; пропущено: ${importResult.skipped + result.skippedRows}`,
      )
      return
    }

    const result = file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : parseWorkbook(await file.arrayBuffer())
    const importResult = await importMutation.mutateAsync(result.records)
    setMessage(`Добавлено ${importResult.inserted}, пропущено служебных строк: ${result.skippedRows}`)
  }

  function exportXlsx() {
    const fields = getReportExportFields({
      storageKey: activeReport,
      hiddenFieldKeys:
        activeReport === 'heatTreatment'
          ? heatTreatmentHiddenFieldKeys
          : activeReport === 'lnk'
            ? lnkHiddenFieldKeys
            : weldingJournalHiddenFieldKeys,
      mergePstoSections: activeReport === 'heatTreatment',
    })
    const exportOptions = {
      fields,
      readOnlyFieldKeys: getReportReadOnlyFieldKeys(activeReport),
      sheetName: activeTitle,
    }
    const bytes = buildExportXlsxBytes(visibleRows, exportOptions)
    downloadExcelBytes(
      bytes,
      activeReport === 'heatTreatment'
        ? 'heat-treatment-register.xlsx'
        : activeReport === 'lnk'
          ? 'lnk-register.xlsx'
          : 'welding-register.xlsx',
    )
  }

  function openLnkWaitingNkReport() {
    const reportRows = buildLnkWaitingNkRows(lnkRows)
    setIsLnkShowMenuOpen(false)
    if (reportRows.length === 0) {
      setMessage('Нет стыков со статусом «ожидает НК»')
      return
    }

    const bytes = buildExportXlsxBytes(reportRows as WeldInput[], {
      fields: LNK_WAITING_NK_FIELDS,
      sheetName: 'Ожидание НК',
    })
    const reportWindow = window.open('', '_blank')
    if (!reportWindow) {
      setMessage('Браузер заблокировал открытие новой вкладки')
      return
    }

    reportWindow.document.open()
    reportWindow.document.write(buildLnkReportHtml(reportRows, bytes))
    reportWindow.document.close()
  }

  function openLnkToRequestReport() {
    const reportRows = buildLnkToRequestRows(lnkRows)
    setIsLnkShowMenuOpen(false)
    if (reportRows.length === 0) {
      setMessage('Нет стыков, по которым нужно создать заявку ЛНК')
      return
    }

    const bytes = buildExportXlsxBytes(reportRows as WeldInput[], {
      fields: LNK_WAITING_NK_FIELDS,
      sheetName: 'Ожидание заявки',
    })
    const reportWindow = window.open('', '_blank')
    if (!reportWindow) {
      setMessage('Браузер заблокировал открытие новой вкладки')
      return
    }

    reportWindow.document.open()
    reportWindow.document.write(buildLnkReportHtml(reportRows, bytes, 'Ожидание заявки', 'lnk-waiting-request.xlsx'))
    reportWindow.document.close()
  }

  function openLnkConclusionsReport() {
    const reportRows = buildLnkConclusionsRows(lnkRows)
    setIsLnkShowMenuOpen(false)
    if (reportRows.length === 0) {
      setMessage('Нет заключений ЛНК для показа')
      return
    }

    const bytes = buildExportXlsxBytes(reportRows as WeldInput[], {
      fields: LNK_CONCLUSIONS_FIELDS,
      sheetName: 'Заключения ЛНК',
    })
    const reportWindow = window.open('', '_blank')
    if (!reportWindow) {
      setMessage('Браузер заблокировал открытие новой вкладки')
      return
    }

    reportWindow.document.open()
    reportWindow.document.write(buildLnkReportHtml(reportRows, bytes, 'Заключения ЛНК', 'lnk-conclusions.xlsx', LNK_CONCLUSIONS_FIELDS))
    reportWindow.document.close()
  }

  function handleCreatePstoRequest() {
    if (selectedHeatTreatmentRows.length === 0) {
      setMessage('Выберите один или несколько стыков для заявки ПСТО')
      return
    }

    const requestName = getRequestNameFromNaming(pstoRequestNaming, nextPstoRequestName)
    if (!requestName) {
      setMessage('Укажите пользовательское наименование заявки ПСТО')
      return
    }

    pstoRequestMutation.mutate({ records: selectedHeatTreatmentRows, requestName, mode: 'create' })
  }

  function openCreatePstoRequestModal() {
    setSelectedHeatTreatmentIds(new Set())
    setPstoRequestNaming(defaultRequestNamingState)
    setPstoRequestSearch('')
    setIsPstoRequestModalOpen(true)
  }

  function openCreatePstoRequestModalForRow(row: WeldInput & { id: number }) {
    if (!canCreatePstoRequest(row)) {
      setMessage('Заявка ПСТО для этого стыка уже создана')
      return
    }

    setSelectedHeatTreatmentIds(new Set([row.id]))
    setPstoRequestNaming(defaultRequestNamingState)
    setPstoRequestSearch(String(row.joint ?? row.line ?? ''))
    setIsPstoRequestModalOpen(true)
  }

  function closeCreatePstoRequestModal() {
    if (pstoRequestMutation.isPending) return
    setIsPstoRequestModalOpen(false)
  }

  function submitCreatePstoRequest() {
    const requestName = getRequestNameFromNaming(pstoRequestNaming, nextPstoRequestName)
    if (!requestName) {
      setMessage('Укажите пользовательское наименование заявки ПСТО')
      return
    }
    pstoRequestMutation.mutate({ records: selectedHeatTreatmentRows, requestName, mode: 'create' })
  }

  function openAddPstoResultModal() {
    setPstoResultDraft(createDefaultPstoResultDraft())
    setIsPstoResultModalOpen(true)
  }

  function openAddPstoResultModalForRow(row: WeldInput & { id: number }) {
    const requestName = String(row.pstoRequest ?? '').trim()
    if (!requestName) {
      setMessage('Сначала создайте заявку ПСТО для этого стыка')
      return
    }

    setPstoResultDraft({
      ...createDefaultPstoResultDraft(),
      requestName,
      rowIds: new Set([row.id]),
      search: String(row.joint ?? row.line ?? ''),
    })
    setIsPstoResultModalOpen(true)
  }

  function closeAddPstoResultModal() {
    if (pstoResultMutation.isPending) return
    setIsPstoResultModalOpen(false)
  }

  function changePstoResultRequest(requestName: string) {
    setPstoResultDraft((current) => {
      if (!requestName) return { ...current, requestName: '' }
      const rowIds = new Set(
        [...current.rowIds].filter((id) => {
          const row = heatTreatmentRows.find((candidate) => candidate.id === id)
          return row ? rowBelongsToPstoRequest(row, requestName) : false
        }),
      )
      return { ...current, requestName, rowIds }
    })
  }

  function togglePstoResultRow(rowId: number) {
    const row = filteredPstoResultRows.find((candidate) => candidate.id === rowId)
    if (!row || !canSelectPstoResultRow(row, pstoResultDraft.requestName)) return

    setPstoResultDraft((current) => {
      const rowIds = new Set(current.rowIds)
      if (rowIds.has(rowId)) {
        rowIds.delete(rowId)
      } else {
        rowIds.add(rowId)
      }
      const selectedRows = heatTreatmentRows.filter((candidate) => rowIds.has(candidate.id))
      const requestOptions = sortPstoRequestNamesNewestFirst(collectRequestNames(selectedRows, ['pstoRequest']))
      const requestName =
        current.requestName && requestOptions.includes(current.requestName)
          ? current.requestName
          : requestOptions.length === 1
            ? requestOptions[0]
            : ''
      return { ...current, requestName, rowIds }
    })
  }

  function toggleAllPstoResultRows() {
    setPstoResultDraft((current) => {
      const filteredIds = new Set(
        filteredPstoResultRows.filter((row) => canSelectPstoResultRow(row, current.requestName)).map((row) => row.id),
      )
      if (filteredIds.size === 0) return current
      const allSelected = [...filteredIds].every((id) => current.rowIds.has(id))
      const rowIds = allSelected
        ? new Set([...current.rowIds].filter((id) => !filteredIds.has(id)))
        : new Set([...current.rowIds, ...filteredIds])
      const selectedRows = heatTreatmentRows.filter((row) => rowIds.has(row.id))
      const requestOptions = sortPstoRequestNamesNewestFirst(collectRequestNames(selectedRows, ['pstoRequest']))
      const requestName =
        current.requestName && requestOptions.includes(current.requestName)
          ? current.requestName
          : requestOptions.length === 1
            ? requestOptions[0]
            : ''
      return { ...current, requestName, rowIds }
    })
  }

  function togglePstoRequestRow(rowId: number) {
    setSelectedHeatTreatmentIds((current) => {
      const next = new Set(current)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
  }

  function toggleAllPstoRequestRows() {
    setSelectedHeatTreatmentIds((current) => {
      const filteredIds = new Set(filteredAvailablePstoRequestRows.map((row) => row.id))
      if (filteredIds.size === 0) return current
      const allFilteredSelected = [...filteredIds].every((id) => current.has(id))
      if (allFilteredSelected) {
        return new Set([...current].filter((id) => !filteredIds.has(id)))
      }
      return new Set([...current, ...filteredIds])
    })
  }

  function handleAddPstoResult() {
    if (!pstoResultDraft.requestName) {
      setMessage('Выберите заявку ПСТО')
      return
    }
    if (selectedPstoResultRows.length === 0) {
      setMessage('Выберите один или несколько стыков')
      return
    }
    if (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && pstoResultDraft.result !== 'проведено') {
      setMessage('Выберите результат ПСТО')
      return
    }
    if (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && !pstoResultDraft.pstoDate) {
      setMessage('Укажите дату ПСТО')
      return
    }
    const diagramName =
      pstoResultDraft.result === PSTO_EMPTY_RESULT_VALUE
        ? ''
        : getRequestNameFromNaming(pstoResultDraft.diagramNaming, nextPstoDiagramName)
    if (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && !diagramName) {
      setMessage('Укажите наименование диаграммы термообработки')
      return
    }

    pstoResultMutation.mutate({
      records: selectedPstoResultRows,
      pstoDate: pstoResultDraft.pstoDate,
      result: pstoResultDraft.result,
      diagramName,
      rows,
    })
  }

  function handleCreateLnkRequest() {
    const methodKeys = selectedLnkMethodKeys
    if (selectedLnkRows.length === 0) {
      setMessage('Выберите один или несколько стыков для заявки ЛНК')
      return
    }
    if (methodKeys.length === 0) {
      setMessage('Выберите один или несколько видов контроля для заявки ЛНК')
      return
    }
    if (selectedLnkRequestTargetCount === 0) {
      setMessage('Нет доступных комбинаций стыков и видов контроля для заявки ЛНК')
      return
    }

    const requestName = getRequestNameFromNaming(lnkRequestNaming, nextLnkRequestName)
    if (!requestName) {
      setMessage('Укажите пользовательское наименование заявки ЛНК')
      return
    }

    lnkRequestMutation.mutate({ records: selectedLnkRows, methodKeys, requestName })
  }

  function openCreateLnkRequestModal() {
    setPreservedLnkOrderIds(null)
    setSelectedLnkIds(new Set())
    setLnkRequestDraft({ methods: new Set() })
    setLnkRequestNaming(defaultRequestNamingState)
    setLnkRequestSearch('')
    setIsLnkRequestModalOpen(true)
  }

  function openCreateLnkRequestModalForRow(row: WeldInput & { id: number }) {
    const availableMethods = getAvailableLnkRequestMethods(row)
    if (availableMethods.length === 0) {
      setMessage('Все заявки ЛНК для этого стыка уже созданы')
      return
    }

    setPreservedLnkOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
    setSelectedLnkIds(new Set([row.id]))
    setLnkRequestDraft({ methods: new Set(availableMethods.map((method) => method.requestKey)) })
    setLnkRequestNaming(defaultRequestNamingState)
    setLnkRequestSearch(String(row.joint ?? row.line ?? ''))
    setIsLnkRequestModalOpen(true)
  }

  function closeCreateLnkRequestModal() {
    if (lnkRequestMutation.isPending) return
    setIsLnkRequestModalOpen(false)
  }

  function openAddLnkResultModal() {
    setPreservedLnkOrderIds(null)
    setLnkResultRequestSearch('')
    setLnkResultDraft(createDefaultLnkResultDraft())
    setShouldPinPreviewedLnkResultRows(false)
    setIsLnkResultModalOpen(true)
  }

  function openAddLnkResultModalForRow(row: WeldInput & { id: number }) {
    const requestNames = getLnkRowRequestNames(row)
    if (requestNames.length === 0) {
      setMessage('Сначала создайте заявку ЛНК для этого стыка')
      return
    }

    const requestName = requestNames.length === 1 ? requestNames[0] : ''
    setPreservedLnkOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
    setLnkResultRequestSearch(requestName)
    setLnkResultDraft({
      ...createDefaultLnkResultDraft(),
      requestName,
      rowIds: new Set([row.id]),
      search: String(row.joint ?? row.line ?? ''),
    })
    setShouldPinPreviewedLnkResultRows(false)
    setIsLnkResultModalOpen(true)
  }

  function closeAddLnkResultModal() {
    if (lnkResultMutation.isPending) return
    setLnkResultRequestSearch('')
    setIsLnkResultPreviewOpen(false)
    setShouldPinPreviewedLnkResultRows(false)
    setIsLnkResultModalOpen(false)
  }

  function openLnkResultManager() {
    const selectedRows = lnkRows.filter((row) => lnkResultDraft.rowIds.has(row.id))
    if (selectedRows.length === 0) {
      setMessage('Выберите один или несколько стыков для редактирования результатов')
      return
    }
    setManagedLnkResultRequestName('')
    setManagedLnkResultMethodKey('')
    setManagedLnkResultRequestSearch('')
    setManagedLnkResultOrderIds(selectedRows.map((row) => row.id))
    setManagedLnkPendingResultChanges({})
    setManagedLnkResultChangeHint(null)
    setManagedLnkResultPreview(null)
    setIsLnkResultManagerOpen(true)
  }

  function changeManagedLnkResultRequest(requestName: string) {
    const rowsForRequest = filterLnkRowsByRequestName(lnkRows, requestName)
    setManagedLnkResultRequestName(requestName)
    setManagedLnkResultMethodKey('')
    setManagedLnkResultOrderIds(rowsForRequest.map((row) => row.id))
    setManagedLnkPendingResultChanges({})
    setManagedLnkResultChangeHint(null)
    setManagedLnkResultPreview(null)
  }

  function renameManagedLnkConclusionForRow(row: WeldInput & { id: number }, methodKey: WeldFieldKey) {
    lnkConclusionCorrectionMutation.mutate({
      records: [row],
      methodKey,
      conclusionName: managedLnkConclusionDrafts[getManagedLnkResultChangeKey(row.id, methodKey)] ?? '',
    })
  }

  function changeLnkResultRequest(requestName: string) {
    setLnkResultDraft((current) => {
      const rowIds = new Set(current.rowIds)
      const selectedRows = lnkRows.filter((row) => rowIds.has(row.id))
      const requestRows = requestName ? filterLnkRowsByRequestName(lnkRows, requestName) : []
      const methodRows = selectedRows.length > 0 ? [...selectedRows, ...requestRows] : requestName ? requestRows : lnkRows
      const methods = getLnkInputMethodsForRows(methodRows, '')
      const methodKey = current.methodKey && methods.some((method) => method.requestKey === current.methodKey) ? current.methodKey : ''
      return { ...current, requestName, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
    })
  }

  function changeLnkResultMethod(methodKey: WeldFieldKey | '') {
    setLnkResultDraft((current) => {
      if (!methodKey) return { ...current, methodKey: '' }
      const rowIds = new Set(
        [...current.rowIds].filter((id) => {
          const row = lnkRows.find((candidate) => candidate.id === id)
          return row ? canSelectLnkResultRow(row, '', methodKey) : false
        }),
      )
      return { ...current, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
    })
  }

  function toggleLnkResultRow(rowId: number) {
    const row = filteredLnkResultRows.find((candidate) => candidate.id === rowId)
    if (!row || !canSelectLnkResultRow(row, lnkResultDraft.requestName, lnkResultDraft.methodKey)) return

    setLnkResultDraft((current) => {
      const rowIds = new Set(current.rowIds)
      if (rowIds.has(rowId)) {
        rowIds.delete(rowId)
      } else {
        rowIds.add(rowId)
      }
      const selectedRows = lnkRows.filter((candidate) => rowIds.has(candidate.id))
      const requestName = current.requestName && selectedRows.some((candidate) => rowBelongsToLnkRequest(candidate, current.requestName))
        ? current.requestName
        : ''
      const methodRows = requestName ? filterLnkRowsByRequestName(lnkRows, requestName) : selectedRows.length > 0 ? selectedRows : lnkRows
      const methods = getLnkInputMethodsForRows(methodRows, requestName)
      const methodKey = current.methodKey && methods.some((method) => method.requestKey === current.methodKey) ? current.methodKey : ''
      return { ...current, requestName, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
    })
  }

  function toggleAllLnkResultRows() {
    setLnkResultDraft((current) => {
      const filteredIds = new Set(
        filteredLnkResultRows
          .filter((row) => canSelectLnkResultRow(row, current.requestName, current.methodKey))
          .map((row) => row.id),
      )
      if (filteredIds.size === 0) return current
      const allSelected = [...filteredIds].every((id) => current.rowIds.has(id))
      const rowIds = allSelected
        ? new Set([...current.rowIds].filter((id) => !filteredIds.has(id)))
        : new Set([...current.rowIds, ...filteredIds])
      const selectedRows = lnkRows.filter((row) => rowIds.has(row.id))
      const requestName = current.requestName && selectedRows.some((row) => rowBelongsToLnkRequest(row, current.requestName))
        ? current.requestName
        : ''
      const methodRows = requestName ? filterLnkRowsByRequestName(lnkRows, requestName) : selectedRows.length > 0 ? selectedRows : lnkRows
      const methods = getLnkInputMethodsForRows(methodRows, requestName)
      const methodKey = current.methodKey && methods.some((method) => method.requestKey === current.methodKey) ? current.methodKey : ''
      return { ...current, requestName, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
    })
  }

  function setLnkResultForRow(rowId: number, result: string) {
    setLnkResultDraft((current) => {
      if (!current.rowIds.has(rowId)) return current
      const baseline = current.result && current.result !== LNK_CUSTOM_RESULT_VALUE ? current.result : ''
      const rowResults: Record<number, string> = {}
      for (const id of current.rowIds) {
        rowResults[id] = current.rowResults[id] || baseline
      }
      rowResults[rowId] = result
      return { ...current, result: LNK_CUSTOM_RESULT_VALUE, rowResults }
    })
  }

  function handleAddLnkResult() {
    if (!lnkResultDraft.methodKey) {
      setMessage('Выберите метод контроля')
      return
    }
    if (selectedLnkResultRows.length === 0) {
      setMessage('Выберите один или несколько стыков')
      return
    }
    const resultById = buildLnkResultDraftById(selectedLnkResultRows, lnkResultDraft)
    const resultValues = Object.values(resultById)
    if (resultValues.some((result) => !isValidLnkResultDraftValue(result))) {
      setMessage('Укажите результат для каждого выбранного стыка')
      return
    }
    const hasNonEmptyResult = resultValues.some((result) => result !== LNK_EMPTY_RESULT_VALUE)
    if (hasNonEmptyResult && !lnkResultDraft.controlDate) {
      setMessage('Укажите дату контроля')
      return
    }
    const conclusionName =
      !hasNonEmptyResult
        ? ''
        : getRequestNameFromNaming(lnkResultDraft.conclusionNaming, nextLnkConclusionName)
    if (hasNonEmptyResult && !conclusionName) {
      setMessage('Укажите наименование заключения')
      return
    }

    lnkResultMutation.mutate({
      records: selectedLnkResultRows,
      methodKey: lnkResultDraft.methodKey,
      controlDate: lnkResultDraft.controlDate,
      resultById,
      conclusionName,
    })
  }

  function replaceLnkResult(row: WeldInput & { id: number }, methodKey: WeldFieldKey, result: string) {
    const method = getLnkMethodByRequestKey(methodKey)
    const currentResult = method ? String(row[method.resultKey] ?? '').trim() : ''
    const changeKey = getManagedLnkResultChangeKey(row.id, methodKey)
    setManagedLnkResultPreview(null)
    if (currentResult && currentResult !== result) {
      setManagedLnkResultChangeHint({ changeKey, rowId: row.id, methodKey, from: currentResult, to: result })
      setManagedLnkPendingResultChanges((current) => ({ ...current, [changeKey]: result }))
    } else {
      setManagedLnkResultChangeHint(null)
      setManagedLnkPendingResultChanges((current) => {
        const next = { ...current }
        delete next[changeKey]
        return next
      })
    }
  }

  function saveManagedLnkResultChanges() {
    if (managedLnkPendingResultRows.length === 0) {
      setMessage('Нет изменений результата для сохранения')
      return
    }
    const updates = managedLnkPendingResultRows.map(({ row, method, changeKey }) => ({
      record: row,
      methodKey: method.requestKey,
      result: managedLnkPendingResultChanges[changeKey],
    }))
    lnkResultReplacementMutation.mutate({
      updates,
    })
  }

  function clearLnkResult(row: WeldInput & { id: number }, methodKey: WeldFieldKey) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) return
    setManagedLnkPendingResultChanges((current) => {
      const next = { ...current }
      delete next[row.id]
      return next
    })
    const confirmed = window.confirm(
      `Удалить результат ${method.code} по стыку ${String(row.joint ?? '-')}? Заключение и дата контроля по этому методу тоже будут очищены.`,
    )
    if (!confirmed) return
    setManagedLnkResultChangeHint(null)
    lnkResultCorrectionMutation.mutate({ record: row, methodKey, result: null })
  }

  function handleClearLnkGeneratedData() {
    const confirmed = window.confirm(
      'Очистить результаты, даты и заключения ЛНК? Заявки ЛНК, сами стыки и отметки наличия контроля останутся.',
    )
    if (!confirmed) return
    clearLnkGeneratedDataMutation.mutate(lnkRows)
  }

  function toggleLnkRequestMethod(requestKey: WeldFieldKey) {
    setLnkRequestDraft((current) => {
      const methods = new Set(current.methods)
      if (methods.has(requestKey)) {
        methods.delete(requestKey)
      } else {
        methods.add(requestKey)
      }
      return { methods }
    })
  }

  function clearLnkRequestFromRow(row: WeldInput & { id: number }, methodKey: WeldFieldKey) {
    lnkRequestCorrectionMutation.mutate({ record: row, methodKey, requestName: null })
  }

  function openLnkRequestManager() {
    const requestName = managedLnkRequestName || lnkRequestManagerOptions[0] || ''
    setManagedLnkRequestName(requestName)
    setManagedLnkRequestNameDraft(requestName)
    setIsLnkRequestManagerOpen(true)
  }

  function changeManagedLnkRequest(requestName: string) {
    setManagedLnkRequestName(requestName)
    setManagedLnkRequestNameDraft(requestName)
  }

  function renameManagedLnkRequest() {
    lnkRequestManagerMutation.mutate({
      action: 'rename',
      requestName: managedLnkRequestName,
      nextRequestName: managedLnkRequestNameDraft,
    })
  }

  function deleteManagedLnkRequest() {
    const requestName = managedLnkRequestName.trim()
    if (!requestName) return
    const confirmed = window.confirm(
      `Удалить заявку ${requestName}? Будут очищены связанные заявки, результаты, даты и заключения ЛНК для этой заявки.`,
    )
    if (!confirmed) return
    lnkRequestManagerMutation.mutate({ action: 'delete', requestName })
  }

  function clearManagedLnkRequestPosition(row: WeldInput & { id: number }, methodKey: WeldFieldKey) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) return
    const requestName = String(row[method.requestKey] ?? '').trim()
    const confirmed = window.confirm(
      `Очистить ${method.code} по стыку ${String(row.joint ?? '-')} из заявки ${requestName}? Будут очищены заявка, результат, дата и заключение только для этой позиции.`,
    )
    if (!confirmed) return
    clearLnkRequestFromRow(row, methodKey)
  }

  function toggleLnkRequestRow(rowId: number) {
    setSelectedLnkIds((current) => {
      const next = new Set(current)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
  }

  function toggleAllLnkRequestRows() {
    setSelectedLnkIds((current) => {
      const filteredIds = new Set(filteredAvailableLnkRequestRows.map((row) => row.id))
      if (filteredIds.size === 0) return current
      const allFilteredSelected = [...filteredIds].every((id) => current.has(id))
      if (allFilteredSelected) {
        return new Set([...current].filter((id) => !filteredIds.has(id)))
      }
      return new Set([...current, ...filteredIds])
    })
  }

  function handleEditRecord(record: WeldInput & { id: number }, focusField?: WeldFieldKey) {
    if (activeReport === 'heatTreatment') {
      if (focusField && heatTreatmentEditableFieldKeys.has(focusField)) {
        const field = FIELD_BY_KEY.get(focusField)
        setHeatTreatmentFieldEditing({
          record,
          fieldKey: focusField,
          label: field?.label ?? 'Поле ПСТО',
          kind: field?.kind === 'date' ? 'date' : 'text',
          value: String(record[focusField] ?? ''),
        })
      }
      return
    }

    if (activeReport === 'lnk') {
      if (focusField && lnkEditableFieldKeys.has(focusField)) {
        if (isLnkRequestField(focusField) && !isLnkRequestAllowedForRow(record, focusField)) {
          setMessage('Сначала укажите наличие этого вида контроля в сварочном журнале')
          return
        }
        const field = FIELD_BY_KEY.get(focusField)
        setHeatTreatmentFieldEditing({
          record,
          fieldKey: focusField,
          label: field?.label ?? 'Поле ЛНК',
          kind: field?.kind === 'date' ? 'date' : 'text',
          value: String(record[focusField] ?? ''),
          report: 'lnk',
          mode: isLnkResultField(focusField) ? 'result' : isLnkRequestField(focusField) ? 'request' : 'text',
        })
      }
      return
    }

    if (focusField && requestAndResultFieldKeys.has(focusField)) {
      setMessage('Поля заявок и результатов редактируются только в отчетах Термообработка и ЛНК')
      return
    }

    setEditing({ record, focusField })
  }

  function saveEditedHeatTreatmentField() {
    if (!heatTreatmentFieldEditing) return
    if (heatTreatmentFieldEditing.report === 'lnk') {
      const value = heatTreatmentFieldEditing.value.trim()
      if (heatTreatmentFieldEditing.mode === 'request' && value && !lnkRequestOptions.includes(value)) {
        setMessage('Можно выбрать только существующую заявку ЛНК или очистить поле')
        return
      }
      lnkFieldMutation.mutate({
        record: heatTreatmentFieldEditing.record,
        fieldKey: heatTreatmentFieldEditing.fieldKey,
        value: value || null,
      })
      return
    }
    heatTreatmentFieldMutation.mutate({
      record: heatTreatmentFieldEditing.record,
      fieldKey: heatTreatmentFieldEditing.fieldKey,
      value: heatTreatmentFieldEditing.value.trim() || null,
      rows,
    })
  }

  function highlightChangedRows(rows: Array<{ id?: number }> | undefined, cellFieldKeys: WeldFieldKey[] = []) {
    if (rows && rows.length > 0) {
      latestHighlightRef.current = {
        rows,
        fieldKeys: expandHighlightFieldKeys(cellFieldKeys),
        createdAt: Date.now(),
      }
    }
    applyChangedRowsHighlight(rows, cellFieldKeys)
  }

  function replayLatestHighlight() {
    const latestHighlight = latestHighlightRef.current
    if (!latestHighlight) return
    if (Date.now() - latestHighlight.createdAt > highlightDurationMs * 4) return
    applyChangedRowsHighlight(latestHighlight.rows, latestHighlight.fieldKeys)
  }

  function applyChangedRowsHighlight(rows: Array<{ id?: number }> | undefined, cellFieldKeys: WeldFieldKey[] = []) {
    const ids = new Set(
      (rows ?? [])
        .map((row) => row.id)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
    )
    if (ids.size === 0) return

    const cellKeys = new Set<string>()
    const expandedFieldKeys = expandHighlightFieldKeys(cellFieldKeys)
    for (const id of ids) {
      for (const fieldKey of expandedFieldKeys) {
        cellKeys.add(getCellKey(id, fieldKey))
      }
    }

    setHighlightedRowIds(ids)
    setHighlightedCellKeys(cellKeys)
    if (importHighlightTimerRef.current) {
      clearTimeout(importHighlightTimerRef.current)
    }
    importHighlightTimerRef.current = setTimeout(() => {
      setHighlightedRowIds(new Set())
      setHighlightedCellKeys(new Set())
      importHighlightTimerRef.current = null
    }, highlightDurationMs)
  }

  return (
    <main className="relative min-h-screen bg-white">
      <aside
        className={`fixed left-0 top-0 z-30 h-screen border-r border-slate-100 bg-white px-3 py-5 transition-[width] duration-200 ${
          navCollapsed ? 'w-16' : 'w-48 lg:w-64 lg:px-4'
        }`}
      >
        <div
          className={`mb-3 flex items-start ${navCollapsed ? 'justify-center [&>div]:sr-only' : 'justify-between gap-3'}`}
        >
          <div className="text-lg font-semibold tracking-tight">Сварка</div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setNavCollapsed((value) => !value)}
            aria-label={navCollapsed ? 'Раскрыть меню' : 'Скрыть меню'}
            title={navCollapsed ? 'Раскрыть меню' : 'Скрыть меню'}
            className="h-9 w-9 shrink-0"
          >
            {navCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
        <nav className="space-y-1">
          <button
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
              activeReport === 'weldingJournal'
                ? 'bg-primary text-primary-foreground'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
            } ${
              navCollapsed ? 'justify-center px-0' : ''
            }`}
            onClick={() => setActiveReport('weldingJournal')}
            title="Сварочный журнал"
          >
            <NotebookTabs className="h-4 w-4 shrink-0" />
            <span className={navCollapsed ? 'sr-only' : ''}>Сварочный журнал</span>
          </button>
          <button
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
              activeReport === 'heatTreatment'
                ? 'bg-primary text-primary-foreground'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
            } ${
              navCollapsed ? 'justify-center px-0' : ''
            }`}
            onClick={() => {
              setActiveReport('heatTreatment')
              setEditing(null)
            }}
            title="Термообработка"
          >
            <Flame className="h-4 w-4 shrink-0" />
            <span className={navCollapsed ? 'sr-only' : ''}>Термообработка</span>
          </button>
          <button
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
              activeReport === 'lnk'
                ? 'bg-primary text-primary-foreground'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
            } ${
              navCollapsed ? 'justify-center px-0' : ''
            }`}
            onClick={() => {
              setActiveReport('lnk')
              setEditing(null)
            }}
            title="ЛНК"
          >
            <ClipboardCheck className="h-4 w-4 shrink-0" />
            <span className={navCollapsed ? 'sr-only' : ''}>ЛНК</span>
          </button>
        </nav>
      </aside>

      <div
        className={`min-w-0 bg-white py-5 pr-4 transition-[padding-left] duration-200 lg:pr-6 ${
          navCollapsed ? 'pl-20' : 'pl-52 lg:pl-72'
        }`}
      >
        <div className="min-w-full w-max space-y-4 bg-white" style={{ minWidth: registerMinWidth }}>
          <header
            className="sticky z-40 flex w-full items-start gap-4 bg-white pb-1"
            style={{ left: stickyLeft, minWidth: registerMinWidth }}
          >
            <div className="shrink-0">
              <h1 className="text-2xl font-semibold tracking-tight">{activeTitle}</h1>
            </div>
            <div className="flex flex-wrap gap-2 lg:pt-0.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleImport(file)
                  event.currentTarget.value = ''
                }}
              />
              {activeReport === 'heatTreatment' ? (
                <>
                  <Button onClick={openCreatePstoRequestModal} disabled={pstoRequestMutation.isPending}>
                    <Plus className="mr-2 h-4 w-4" />
                    Создать заявку ПСТО
                  </Button>
                  <Button onClick={openAddPstoResultModal} disabled={pstoResultMutation.isPending || pstoResultRequestOptions.length === 0}>
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                    Добавить результат
                  </Button>
                </>
              ) : null}
              {activeReport === 'lnk' ? (
                <>
                  <Button onClick={openCreateLnkRequestModal} disabled={lnkRequestMutation.isPending}>
                    <Plus className="mr-2 h-4 w-4" />
                    Заявка
                  </Button>
                  <Button onClick={openAddLnkResultModal} disabled={lnkResultMutation.isPending || lnkResultRequestOptions.length === 0}>
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                    Результат
                  </Button>
                  <div className="relative">
                    <Button variant="outline" onClick={() => setIsLnkShowMenuOpen((current) => !current)}>
                      Показать
                      <ChevronDown className="ml-2 h-4 w-4" />
                    </Button>
                    {isLnkShowMenuOpen ? (
                      <div className="absolute right-0 z-50 mt-2 w-52 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
                        <button
                          type="button"
                          onClick={openLnkToRequestReport}
                          className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-sky-50 hover:text-sky-900"
                        >
                          Ожидание заявки
                        </button>
                        <button
                          type="button"
                          onClick={openLnkWaitingNkReport}
                          className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-sky-50 hover:text-sky-900"
                        >
                          Ожидание НК
                        </button>
                        <button
                          type="button"
                          onClick={openLnkConclusionsReport}
                          className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-sky-50 hover:text-sky-900"
                        >
                          Показать заключения
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
              {activeReport === 'weldingJournal' ? (
                <Button onClick={() => setEditing({ record: {} })}>
                  <Plus className="mr-2 h-4 w-4" />
                  Новый стык
                </Button>
              ) : null}
              {activeReport !== 'lnk' ? (
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importMutation.isPending || heatTreatmentImportMutation.isPending || lnkImportMutation.isPending}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Импорт
                </Button>
              ) : null}
              <Button variant="outline" onClick={exportXlsx}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Excel
              </Button>
            </div>
          </header>

          <div
            className="sticky z-20 flex min-h-6 w-full items-center justify-between bg-white text-sm text-muted-foreground"
            style={{ left: stickyLeft, minWidth: registerMinWidth }}
          >
            <span>
              {weldsQuery.isLoading
                ? 'Загрузка...'
                : activeReport === 'heatTreatment'
                  ? `Стыков на ПСТО: ${heatTreatmentRows.length} · Выбрано: ${selectedHeatTreatmentRows.length}`
                  : activeReport === 'lnk'
                    ? `Стыков на ЛНК: ${lnkRows.length} · Доступно для новой заявки: ${availableLnkRequestRows.length}`
                    : `Записей: ${rows.length} · WDI годных: ${formatWdiTotal(acceptedWdiTotal)}`}
              {weldsQuery.error ? ` Ошибка: ${(weldsQuery.error as Error).message}` : null}
            </span>
            <span>{message}</span>
          </div>

          <WeldTable
            rows={visibleRows as Array<WeldInput & { id: number }>}
            columnFilters={activeColumnFilters}
            onColumnFiltersChange={activeFiltersSetter}
            onEdit={handleEditRecord}
            onDelete={(id) => {
              if (confirm('Удалить запись стыка?')) deleteMutation.mutate(id)
            }}
            stickyLeft={stickyLeft}
            highlightedRowIds={highlightedRowIds}
            highlightedCellKeys={highlightedCellKeys}
            readOnly={activeReport === 'heatTreatment' || activeReport === 'lnk'}
            editableFieldKeys={
              activeReport === 'heatTreatment'
                ? heatTreatmentEditableFieldKeys
                : activeReport === 'lnk'
                  ? lnkEditableFieldKeys
                  : undefined
            }
            blockedFieldKeys={activeReport === 'weldingJournal' ? weldingJournalBlockedFieldKeys : undefined}
            isCellEditable={
              activeReport === 'lnk'
                ? (row, fieldKey) => !isLnkRequestField(fieldKey) || isLnkRequestAllowedForRow(row, fieldKey)
                : undefined
            }
            getDisplayValue={activeReport === 'lnk' ? getLnkDisplayValue : undefined}
            rowActions={
              activeReport === 'heatTreatment'
                ? {
                    onCreateRequest: openCreatePstoRequestModalForRow,
                    onAddResult: openAddPstoResultModalForRow,
                    canCreateRequest: canCreatePstoRequest,
                    canAddResult: (row) => hasText(row.pstoRequest),
                    headerLabel: 'Действия ПСТО',
                    createTitle: 'Создать заявку ПСТО на этот стык',
                    createDisabledTitle: 'Заявка ПСТО по этому стыку уже создана',
                    createAriaLabel: 'Создать заявку ПСТО на этот стык',
                    resultTitle: 'Добавить результат ПСТО на этот стык',
                    resultDisabledTitle: 'Сначала создайте заявку ПСТО на этот стык',
                    resultAriaLabel: 'Добавить результат ПСТО на этот стык',
                  }
                : activeReport === 'lnk'
                ? {
                    onCreateRequest: openCreateLnkRequestModalForRow,
                    onAddResult: openAddLnkResultModalForRow,
                    canCreateRequest: canCreateLnkRequest,
                    canAddResult: (row) => getLnkRowRequestNames(row).length > 0,
                    headerLabel: 'Действия ЛНК',
                    createTitle: 'Создать заявку ЛНК на этот стык',
                    createDisabledTitle: 'Все заявки ЛНК по этому стыку уже созданы',
                    createAriaLabel: 'Создать заявку ЛНК на этот стык',
                    resultTitle: 'Добавить результат ЛНК на этот стык',
                    resultDisabledTitle: 'Сначала создайте заявку ЛНК на этот стык',
                    resultAriaLabel: 'Добавить результат ЛНК на этот стык',
                  }
                : undefined
            }
            storageKey={activeReport}
            hiddenFieldKeys={
              activeReport === 'heatTreatment'
                ? heatTreatmentHiddenFieldKeys
                : activeReport === 'lnk'
                  ? lnkHiddenFieldKeys
                  : weldingJournalHiddenFieldKeys
            }
            mergePstoSections={activeReport === 'heatTreatment'}
          />
        </div>
      </div>

      {editing ? (
        <WeldForm
          key={`${editing.record.id ?? 'new'}:${editing.focusField ?? 'form'}`}
          value={editing.record}
          focusField={editing.focusField}
          busy={saveMutation.isPending}
          onCancel={() => setEditing(null)}
          onSave={(value) => saveMutation.mutate({ ...value, id: editing.record.id })}
        />
      ) : null}

      {isPstoRequestModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="flex h-[94vh] w-full max-w-[1480px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Создание заявки ПСТО</h2>
                <p className="text-sm text-muted-foreground">
                  {nextPstoRequestName} · Стыков: {selectedHeatTreatmentRows.length}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeCreatePstoRequestModal} aria-label="Закрыть">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="border-b border-slate-100 px-5 py-4">
              <RequestNamingControls
                naming={pstoRequestNaming}
                systemName={nextPstoRequestName}
                label="Наименование заявки ПСТО"
                onChange={setPstoRequestNaming}
              />
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
              <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
                <h3 className="text-sm font-semibold text-slate-800">Термообработка</h3>
                <p className="text-xs leading-5 text-slate-500">
                  В заявку можно добавить один или несколько стыков, где ПСТО требуется и заявка еще не создана.
                </p>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                  После создания наименование заявки попадет в столбец «Заявка ПСТО», а строка обновит дату «Внесен ПСТО».
                </div>
              </section>

              <section className="flex min-h-0 flex-col space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Стыки</h3>
                    <p className="text-xs leading-5 text-slate-500">
                      Галочка доступна только там, где заявка ПСТО еще не создана.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={toggleAllPstoRequestRows}>
                    {isEveryFilteredLnkRequestRowSelected(selectedHeatTreatmentIds, filteredAvailablePstoRequestRows)
                      ? 'Снять все'
                      : 'Выбрать доступные'}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <Input
                    value={pstoRequestSearch}
                    onChange={(event) => setPstoRequestSearch(event.target.value)}
                    placeholder="Проект, шифр, линия, спул или стык"
                    className="h-9 min-w-64 flex-1 bg-white"
                  />
                  <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                    Найдено: {filteredPstoRequestRows.length} · Доступно: {filteredAvailablePstoRequestRows.length}
                  </span>
                  {pstoRequestSearch ? (
                    <Button variant="outline" size="sm" onClick={() => setPstoRequestSearch('')}>
                      Очистить
                    </Button>
                  ) : null}
                </div>

                <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
                  {filteredPstoRequestRows.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">
                      {heatTreatmentRows.length === 0 ? 'Нет стыков для отчета Термообработка.' : 'По фильтру ничего не найдено.'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredPstoRequestRows.map((row) => {
                        const disabled = !canCreatePstoRequest(row)
                        const selected = selectedHeatTreatmentIds.has(row.id)
                        return (
                          <label
                            key={row.id}
                            className={`grid grid-cols-[28px_minmax(220px,1fr)_minmax(180px,0.8fr)] items-center gap-3 px-4 py-3 text-sm transition-colors ${
                              disabled
                                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                                : selected
                                  ? 'cursor-pointer bg-sky-50/80'
                                  : 'cursor-pointer bg-white hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => togglePstoRequestRow(row.id)}
                              disabled={disabled}
                              className="h-4 w-4 rounded border-slate-300 text-slate-900"
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-slate-900">{getJointTitle(row)}</span>
                              <span className="block truncate text-xs text-slate-500">Спул: {String(row.spool ?? '-')}</span>
                            </span>
                            <span className="flex flex-wrap gap-1.5">
                              {disabled ? (
                                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
                                  {String(row.pstoRequest ?? '').trim() || 'Заявка уже создана'}
                                </span>
                              ) : (
                                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">
                                  ПСТО
                                </span>
                              )}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
              <Button variant="outline" onClick={closeCreatePstoRequestModal}>
                Отмена
              </Button>
              <Button onClick={submitCreatePstoRequest} disabled={pstoRequestMutation.isPending || selectedHeatTreatmentRows.length === 0}>
                <Check className="mr-2 h-4 w-4" />
                Создать заявку
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isPstoResultModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="flex max-h-[92vh] w-full max-w-[1320px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Добавление результата ПСТО</h2>
                <p className="text-sm text-muted-foreground">
                  Заявка: {pstoResultDraft.requestName || '-'} · Выбрано: {pstoResultDraft.rowIds.size}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeAddPstoResultModal} aria-label="Закрыть">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden px-6 py-5 lg:grid-cols-[380px_minmax(0,1fr)]">
              <section className="space-y-4">
                <label className="block space-y-1.5 text-sm">
                  <span className="text-[13px] font-medium leading-none text-slate-700">Заявка ПСТО</span>
                  <Select value={pstoResultDraft.requestName} onChange={(event) => changePstoResultRequest(event.target.value)}>
                    <option value="">Выберите заявку</option>
                    {pstoResultAvailableRequestOptions.map((requestName) => (
                      <option key={requestName} value={requestName}>
                        {requestName}
                      </option>
                    ))}
                  </Select>
                </label>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <label className="block space-y-1.5 text-sm">
                    <span className="text-[13px] font-medium leading-none text-slate-700">Дата ПСТО</span>
                    <Input
                      type="date"
                      value={pstoResultDraft.pstoDate}
                      disabled={pstoResultDraft.result === PSTO_EMPTY_RESULT_VALUE}
                      onChange={(event) => setPstoResultDraft((current) => ({ ...current, pstoDate: event.target.value }))}
                    />
                  </label>

                  <label className="block space-y-1.5 text-sm">
                    <span className="text-[13px] font-medium leading-none text-slate-700">Результат</span>
                    <Select
                      value={pstoResultDraft.result}
                      onChange={(event) => setPstoResultDraft((current) => ({ ...current, result: event.target.value }))}
                    >
                      <option value="">Выберите результат</option>
                      <option value="проведено">проведено</option>
                      <option value={PSTO_EMPTY_RESULT_VALUE}>аннулировать</option>
                    </Select>
                  </label>
                </div>

                <div
                  className={`rounded-md border border-slate-200 p-3 ${
                    pstoResultDraft.result === PSTO_EMPTY_RESULT_VALUE ? 'bg-slate-50 opacity-60' : 'bg-white'
                  }`}
                >
                  <RequestNamingControls
                    naming={pstoResultDraft.diagramNaming}
                    systemName={nextPstoDiagramName}
                    label="Диаграмма термообработки"
                    placeholder="Введите наименование диаграммы"
                    disabled={pstoResultDraft.result === PSTO_EMPTY_RESULT_VALUE}
                    onChange={(diagramNaming) => setPstoResultDraft((current) => ({ ...current, diagramNaming }))}
                  />
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                  Результат «проведено» заполнит дату ПСТО и диаграмму термообработки. Если выбрать «аннулировать», результат,
                  дата и диаграмма очистятся, заявка ПСТО останется.
                </div>
              </section>

              <section className="flex min-h-0 flex-col space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">
                      {lnkResultContextReady ? 'Стыки в выбранной заявке' : 'Поиск стыков'}
                    </h3>
                    <p className="text-xs leading-5 text-slate-500">
                      {lnkResultContextReady
                        ? 'Видны проект, шифр, линия, спул и номер стыка для проверки перед сохранением.'
                        : 'Найдите стык, посмотрите его заявки и выберите заявку с методом контроля слева.'}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={toggleAllPstoResultRows} disabled={filteredPstoResultRows.length === 0}>
                    {isEveryFilteredLnkRequestRowSelected(
                      pstoResultDraft.rowIds,
                      filteredPstoResultRows.filter((row) => canSelectPstoResultRow(row, pstoResultDraft.requestName)),
                    )
                      ? 'Снять все'
                      : 'Выбрать все'}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <Input
                    value={pstoResultDraft.search}
                    onChange={(event) => setPstoResultDraft((current) => ({ ...current, search: event.target.value }))}
                    placeholder="Проект, шифр, линия, спул или стык"
                    className="h-9 min-w-64 flex-1 bg-white"
                  />
                  <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                    Найдено: {filteredPstoResultRows.length} · Выбрано: {pstoResultDraft.rowIds.size}
                  </span>
                  {pstoResultDraft.search ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setPstoResultDraft((current) => ({
                          ...current,
                          requestName: '',
                          rowIds: new Set(),
                          search: '',
                        }))
                      }
                    >
                      Очистить
                    </Button>
                  ) : null}
                </div>

                <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
                  {filteredPstoResultRows.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">
                      {pstoResultDraft.search ? 'По фильтру ничего не найдено.' : 'Введите поиск или выберите заявку ПСТО.'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredPstoResultRows.map((row) => {
                        const selected = pstoResultDraft.rowIds.has(row.id)
                        const disabled = !canSelectPstoResultRow(row, pstoResultDraft.requestName)
                        const requestName = String(row.pstoRequest ?? '').trim()
                        const diagramName = String(row.heatTreatmentDiagram ?? '').trim()
                        return (
	                          <div
	                            key={row.id}
	                            onClick={() => {
	                              if (!disabled && !selected) togglePstoResultRow(row.id)
	                            }}
                            className={`grid grid-cols-[28px_minmax(220px,1fr)_minmax(180px,0.8fr)] gap-3 px-4 py-3 text-sm transition-colors ${
                              disabled
                                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                                : selected
                                  ? 'cursor-pointer border-l-4 border-emerald-400 bg-emerald-100/80 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)]'
                                  : 'cursor-pointer bg-white hover:bg-slate-50'
                            }`}
                          >
	                            <input
	                              type="checkbox"
	                              checked={selected}
	                              onClick={(event) => event.stopPropagation()}
	                              onChange={() => togglePstoResultRow(row.id)}
	                              disabled={disabled}
	                              className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900"
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-slate-900">{getJointTitle(row)}</span>
                              <span className="block truncate text-xs text-slate-500">
                                Спул: {String(row.spool ?? '-')} · Текущий результат: {String(row.pstoResult ?? '-')}
                              </span>
                              {disabled ? (
                                <span className="block truncate text-xs text-amber-700">
                                  {requestName ? 'Выберите эту заявку ПСТО, чтобы отметить стык.' : 'На этот стык еще нет заявки ПСТО.'}
                                </span>
                              ) : null}
                            </span>
                            <span className="flex flex-wrap content-start gap-1.5">
                              {requestName ? (
                                <span className={`inline-flex max-w-full flex-col gap-0.5 rounded border px-2 py-1 text-xs font-medium ${getPstoResultBadgeClass(row.pstoResult)}`}>
                                  <span className="max-w-52 truncate">ПСТО {requestName}</span>
                                  {diagramName ? <span className="max-w-52 truncate text-[11px] text-slate-500">{diagramName}</span> : null}
                                </span>
                              ) : (
                                <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                                  Нет заявки
                                </span>
                              )}
                            </span>
	                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
              <Button variant="outline" onClick={closeAddPstoResultModal}>
                Отмена
              </Button>
              <Button
                onClick={handleAddPstoResult}
                disabled={
                  pstoResultMutation.isPending ||
                  selectedPstoResultRows.length === 0 ||
                  !pstoResultDraft.result ||
                  (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && !pstoResultDraft.pstoDate) ||
                  (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE &&
                    !getRequestNameFromNaming(pstoResultDraft.diagramNaming, nextPstoDiagramName))
                }
              >
                <Check className="mr-2 h-4 w-4" />
                Сохранить результат
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isLnkRequestModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="flex max-h-[92vh] w-full max-w-[1320px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Создание заявки ЛНК</h2>
                <p className="text-sm text-muted-foreground">
                  {nextLnkRequestName} · Стыков: {selectedLnkRows.length} · Позиций: {selectedLnkRequestTargetCount}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeCreateLnkRequestModal} aria-label="Закрыть">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <RequestNamingControls
                    naming={lnkRequestNaming}
                    systemName={nextLnkRequestName}
                    label="Наименование заявки ЛНК"
                    onChange={setLnkRequestNaming}
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={openLnkRequestManager}
                  disabled={lnkRequestManagerOptions.length === 0}
                  className="shrink-0 border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Управление заявками
                </Button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
              <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-800">Виды контроля</h3>
                  <span className="text-xs text-slate-500">{selectedLnkMethodKeys.length}/{LNK_METHODS.length}</span>
                </div>
                <p className="text-xs leading-5 text-slate-500">
                  Выберите один или несколько видов контроля для этой заявки.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {LNK_METHODS.map((method) => (
                    <button
                      key={method.requestKey}
                      type="button"
                      onClick={() => toggleLnkRequestMethod(method.requestKey)}
                      className={`inline-flex h-10 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors ${
                        lnkRequestDraft.methods.has(method.requestKey)
                          ? 'border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {method.code}
                    </button>
                  ))}
                </div>
              </section>

              <section className="flex min-h-0 flex-col space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Стыки</h3>
                    <p className="text-xs leading-5 text-slate-500">
                      Галочка доступна только там, где есть хотя бы один вид контроля без заявки.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleAllLnkRequestRows}
                    disabled={!lnkRequestSearch.trim() || filteredAvailableLnkRequestRows.length === 0}
                    title={!lnkRequestSearch.trim() ? 'Сначала сузьте список поиском' : undefined}
                  >
                    {isEveryFilteredLnkRequestRowSelected(selectedLnkIds, filteredAvailableLnkRequestRows)
                      ? 'Снять все'
                      : 'Выбрать доступные'}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <Input
                    value={lnkRequestSearch}
                    onChange={(event) => setLnkRequestSearch(event.target.value)}
                    placeholder="Линия, спул или стык"
                    className="h-9 min-w-64 flex-1 bg-white"
                  />
                  <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                    Найдено: {filteredLnkRequestRows.length} · Доступно: {filteredAvailableLnkRequestRows.length}
                  </span>
                  {lnkRequestSearch ? (
                    <Button variant="outline" size="sm" onClick={() => setLnkRequestSearch('')}>
                      Очистить
                    </Button>
                  ) : null}
                </div>

                <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
                  {filteredAvailableLnkRequestRows.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">
                      {lnkRows.length === 0
                        ? 'Нет стыков для отчета ЛНК.'
                        : filteredLnkRequestRows.length === 0
                          ? 'По фильтру ничего не найдено.'
                          : 'По найденным стыкам нет доступных методов для новой заявки.'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredAvailableLnkRequestRows.map((row) => {
                        const availableMethods = getAvailableLnkRequestMethods(row)
                        const existingMethods = getLnkRowRequestMethods(row, '')
                        const disabled = availableMethods.length === 0
                        const selected = selectedLnkIds.has(row.id)
                        return (
                          <label
                            key={row.id}
                            className={`grid grid-cols-[28px_minmax(180px,1fr)_minmax(220px,1.4fr)] items-center gap-3 px-4 py-3 text-sm transition-colors ${
                              disabled
                                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                                : selected
                                  ? 'cursor-pointer bg-emerald-50/80'
                                  : 'cursor-pointer bg-white hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleLnkRequestRow(row.id)}
                              disabled={disabled}
                              className="h-4 w-4 rounded border-slate-300 text-slate-900"
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-slate-900">{getJointTitle(row)}</span>
                              <span className="block truncate text-xs text-slate-500">Спул: {String(row.spool ?? '-')}</span>
                            </span>
                            <span className="flex flex-wrap gap-1.5">
                              {availableMethods.length > 0 ? (
                                availableMethods.map((method) => {
                                  const isSelectedMethod = selected && lnkRequestDraft.methods.has(method.requestKey)
                                  return (
                                    <span
                                      key={method.requestKey}
                                      className={`rounded border px-2 py-1 text-xs font-medium ${
                                        isSelectedMethod
                                          ? 'border-sky-300 bg-sky-100 text-sky-900'
                                          : 'border-slate-200 bg-slate-50 text-slate-600'
                                      }`}
                                    >
                                      {method.code}
                                    </span>
                                  )
                                })
                              ) : (
                                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
                                  Все заявки уже созданы
                                </span>
                              )}
                              {existingMethods.map((method) => (
                                <span
                                  key={`${method.requestKey}-existing`}
                                  className="inline-flex max-w-full flex-wrap items-center gap-1 overflow-visible rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800"
                                  title={`${method.code}: ${String(row[method.requestKey] ?? '')}`}
                                >
                                  <span>{method.code}</span>
                                  <span className="overflow-visible break-all whitespace-normal text-sky-600 [text-overflow:clip]">
                                    {String(row[method.requestKey] ?? '')}
                                  </span>
                                </span>
                              ))}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
              <Button variant="outline" onClick={closeCreateLnkRequestModal}>
                Отмена
              </Button>
              <Button
                onClick={handleCreateLnkRequest}
                disabled={lnkRequestMutation.isPending || selectedLnkRequestTargetCount === 0}
              >
                <Check className="mr-2 h-4 w-4" />
                Создать заявку
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isLnkRequestManagerOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-[1px]">
          <div className="flex max-h-[90vh] w-full max-w-[920px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Управление заявками ЛНК</h2>
                <p className="text-sm text-muted-foreground">Переименование и удаление уже созданных заявок.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsLnkRequestManagerOpen(false)} aria-label="Закрыть">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-0 space-y-4 overflow-auto px-5 py-4">
              <label className="block space-y-1.5 text-sm">
                <span className="text-[13px] font-medium leading-none text-slate-700">Заявка ЛНК</span>
                <Select value={managedLnkRequestName} onChange={(event) => changeManagedLnkRequest(event.target.value)}>
                  <option value="">Выберите заявку</option>
                  {lnkRequestManagerOptions.map((requestName) => (
                    <option key={requestName} value={requestName}>
                      {requestName}
                    </option>
                  ))}
                </Select>
              </label>

              {managedLnkRequestName ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-slate-800">Используется:</span>
                    <span className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
                      Стыков: {managedLnkRequestRows.length}
                    </span>
                    <span className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
                      Позиций:{' '}
                      {LNK_METHODS.reduce(
                        (count, method) =>
                          count + managedLnkRequestRows.filter((row) => String(row[method.requestKey] ?? '').trim() === managedLnkRequestName).length,
                        0,
                      )}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {managedLnkRequestMethods.map((method) => (
                      <span
                        key={method.requestKey}
                        className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800"
                      >
                        {method.code}:{' '}
                        {managedLnkRequestRows.filter((row) => String(row[method.requestKey] ?? '').trim() === managedLnkRequestName).length}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  Созданных заявок ЛНК пока нет.
                </div>
              )}

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Переименовать заявку</h3>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={managedLnkRequestNameDraft}
                    onChange={(event) => setManagedLnkRequestNameDraft(event.target.value)}
                    placeholder="Новое наименование заявки"
                    disabled={!managedLnkRequestName || lnkRequestManagerMutation.isPending}
                    className="h-10 flex-1"
                  />
                  <Button
                    onClick={renameManagedLnkRequest}
                    disabled={
                      !managedLnkRequestName ||
                      !managedLnkRequestNameDraft.trim() ||
                      managedLnkRequestNameDraft.trim() === managedLnkRequestName ||
                      lnkRequestManagerMutation.isPending
                    }
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Переименовать
                  </Button>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-slate-800">Очистить конкретную позицию</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Можно удалить заявку только у выбранного стыка и метода контроля, не затрагивая остальные позиции заявки.
                  </p>
                </div>
                {managedLnkRequestName && managedLnkRequestRows.length > 0 ? (
                  <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
                    <div className="divide-y divide-slate-100">
                      {managedLnkRequestRows.map((row) => {
                        const methods = getLnkRowRequestMethods(row, managedLnkRequestName)
                        return (
                          <div
                            key={row.id}
                            className="grid grid-cols-[minmax(220px,1fr)_minmax(220px,1.2fr)] gap-3 px-3 py-2.5 text-sm"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium text-slate-900">{getJointTitle(row)}</div>
                              <div className="truncate text-xs text-slate-500">
                                Спул: {String(row.spool ?? '-')} · Линия: {String(row.line ?? '-')}
                              </div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-1.5">
                              {methods.map((method) => (
                                <button
                                  key={method.requestKey}
                                  type="button"
                                  onClick={() => clearManagedLnkRequestPosition(row, method.requestKey)}
                                  disabled={lnkRequestCorrectionMutation.isPending}
                                  className="inline-flex items-center gap-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  title={`Очистить ${method.code} только для этого стыка`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  {method.code}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                    Выберите заявку, чтобы увидеть ее стыки и методы контроля.
                  </div>
                )}
              </div>

              <div className="rounded-md border border-rose-200 bg-rose-50/60 p-3">
                <h3 className="mb-1 text-sm font-semibold text-rose-900">Удалить заявку</h3>
                <p className="mb-3 text-xs leading-5 text-rose-800">
                  Будут очищены заявка, результат, дата и заключение ЛНК по всем стыкам, где используется выбранная заявка.
                </p>
                <Button
                  variant="outline"
                  onClick={deleteManagedLnkRequest}
                  disabled={!managedLnkRequestName || lnkRequestManagerMutation.isPending}
                  className="border-rose-300 bg-white text-rose-800 hover:bg-rose-50"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Удалить выбранную заявку
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isLnkResultManagerOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-[1px]">
          <div className="flex max-h-[92vh] w-full max-w-[1320px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Редактирование результатов ЛНК</h2>
                <p className="text-sm text-muted-foreground">Замена результата или удаление результата вместе с датой и заключением.</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setIsLnkResultManagerOpen(false)
                  setManagedLnkResultOrderIds(null)
                  setManagedLnkResultPreview(null)
                  setManagedLnkResultChangeHint(null)
                  setManagedLnkPendingResultChanges({})
                }}
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-5 py-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">Что редактируем</h3>
                  <div className="space-y-3">
                    <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                      Выбрано стыков: <span className="font-semibold text-slate-900">{managedLnkResultRows.length}</span>
                    </div>

                    <label className="block space-y-1.5 text-sm">
                      <span className="text-[13px] font-medium leading-none text-slate-700">Метод контроля</span>
                      <Select
                        value={managedLnkResultMethodKey}
                        onChange={(event) => {
                          setManagedLnkResultMethodKey(event.target.value as WeldFieldKey)
                          setManagedLnkPendingResultChanges({})
                          setManagedLnkResultChangeHint(null)
                          setManagedLnkResultPreview(null)
                        }}
                        disabled={managedLnkResultMethods.length === 0}
                      >
                        <option value="">Все методы</option>
                        {managedLnkResultMethods.map((method) => (
                          <option key={method.requestKey} value={method.requestKey}>
                            {method.code}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                  Замена меняет только результат и сохраняет существующее заключение. Наименование заключения редактируется отдельно у
                  конкретного стыка. Удаление очищает результат, дату контроля и заключение.
                </div>
              </section>

              <section className="min-h-0 overflow-auto rounded-md border border-slate-200">
                {managedLnkResultEntries.length > 0 ? (
                  <div className="divide-y divide-slate-100">
                    {managedLnkResultEntries
                      .map(({ row, method, changeKey }) => {
                        const currentResult = String(row[method.resultKey] ?? '').trim()
                        const conclusionName = String(row[method.conclusionKey] ?? '').trim()
                        const conclusionDate = String(row[method.conclusionDateKey] ?? '').trim()
                        const conclusionDraft = managedLnkConclusionDrafts[changeKey] ?? conclusionName
                        const previewResult = managedLnkResultPreview?.changeKey === changeKey ? managedLnkResultPreview.result : ''
                        const pendingResult = managedLnkPendingResultChanges[changeKey] ?? ''
                        const changeHint = pendingResult && pendingResult !== currentResult
                          ? { changeKey, rowId: row.id, methodKey: method.requestKey, from: currentResult, to: pendingResult }
                          : managedLnkResultChangeHint?.changeKey === changeKey
                            ? managedLnkResultChangeHint
                            : null
                        return (
                          <div key={changeKey} className="grid grid-cols-[minmax(520px,1fr)_minmax(260px,0.5fr)] gap-4 px-4 py-3 text-sm">
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900">{getJointTitle(row)}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                <span>Спул: {String(row.spool ?? '-')}</span>
                                {changeHint || (previewResult && previewResult !== currentResult) ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="font-medium text-slate-500">{pendingResult && pendingResult !== currentResult ? 'Будет:' : 'Проверка:'}</span>
                                    <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getLnkResultBadgeClass(changeHint?.from || currentResult)}`}>
                                      {changeHint?.from || currentResult || '-'}
                                    </span>
                                    <span className="px-0.5 text-sm font-bold leading-none text-slate-700">→</span>
                                    <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getLnkResultBadgeClass(changeHint?.to || previewResult)}`}>
                                      {changeHint?.to || previewResult}
                                    </span>
                                  </span>
                                ) : (
                                  <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${currentResult ? getLnkResultBadgeClass(currentResult) : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                                    Сейчас {method.code}: {currentResult || '-'}
                                  </span>
                                )}
                              </div>
                              {conclusionName || conclusionDate ? (
                                <div className="mt-1 text-xs leading-5 text-slate-500">
                                  <span className="font-medium text-slate-700">Заключение:</span> <span className="break-words">{conclusionName || '-'}</span>
                                  <span className="mx-1 text-slate-300">·</span>
                                  <span className="font-medium text-slate-700">Дата:</span> {conclusionDate || '-'}
                                </div>
                              ) : null}
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Input
                                  value={conclusionDraft}
                                  onChange={(event) =>
                                    setManagedLnkConclusionDrafts((current) => ({ ...current, [changeKey]: event.target.value }))
                                  }
                                  placeholder="Наименование заключения для этого стыка"
                                  disabled={lnkConclusionCorrectionMutation.isPending}
                                  className="h-8 min-w-72 max-w-xl flex-1 bg-white text-xs"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => renameManagedLnkConclusionForRow(row, method.requestKey)}
                                  disabled={
                                    lnkConclusionCorrectionMutation.isPending ||
                                    !conclusionDraft.trim() ||
                                    conclusionDraft.trim() === conclusionName
                                  }
                                  className="h-8"
                                >
                                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                  Переименовать
                                </Button>
                              </div>
                            </div>
                            <div className="flex flex-wrap content-start justify-end gap-1.5">
                              <span className="w-full text-right text-xs font-medium text-slate-500">Изменить на:</span>
                              {LNK_RESULT_OPTIONS.map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => replaceLnkResult(row, method.requestKey, option)}
                                  onMouseEnter={() => setManagedLnkResultPreview({ changeKey, rowId: row.id, methodKey: method.requestKey, result: option })}
                                  onMouseLeave={() => setManagedLnkResultPreview((current) => (current?.changeKey === changeKey ? null : current))}
                                  onFocus={() => setManagedLnkResultPreview({ changeKey, rowId: row.id, methodKey: method.requestKey, result: option })}
                                  onBlur={() => setManagedLnkResultPreview((current) => (current?.changeKey === changeKey ? null : current))}
                                  disabled={lnkResultCorrectionMutation.isPending || lnkResultReplacementMutation.isPending}
                                  className={`rounded border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                    (pendingResult || currentResult) === option
                                      ? getLnkResultBadgeClass(option)
                                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                  }`}
                                >
                                  {option}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => clearLnkResult(row, method.requestKey)}
                                disabled={!currentResult || lnkResultCorrectionMutation.isPending || lnkResultReplacementMutation.isPending}
                                className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                удалить результат
                              </button>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                ) : (
                  <div className="flex min-h-72 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
                    {managedLnkResultRows.length === 0
                      ? 'Выберите стыки в окне добавления результата.'
                      : 'По выбранным стыкам нет внесенных результатов для редактирования.'}
                  </div>
                )}
              </section>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-slate-200/80 px-5 py-4">
              <div className="text-sm text-slate-500">
                {managedLnkPendingResultRows.length > 0 ? (
                  <span className="inline-flex rounded border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800">
                    Подготовлено изменений: {managedLnkPendingResultRows.length}
                  </span>
                ) : (
                  <span className="text-xs">Выберите новый результат, затем сохраните изменения.</span>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setManagedLnkPendingResultChanges({})
                    setManagedLnkResultChangeHint(null)
                    setManagedLnkResultPreview(null)
                  }}
                  disabled={managedLnkPendingResultRows.length === 0 || lnkResultReplacementMutation.isPending}
                >
                  Отменить изменения
                </Button>
                <Button
                  onClick={saveManagedLnkResultChanges}
                  disabled={managedLnkPendingResultRows.length === 0 || lnkResultReplacementMutation.isPending}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Сохранить изменения
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isLnkResultModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="flex h-[94vh] w-full max-w-[1480px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Добавление результата ЛНК</h2>
                <p className="text-sm text-muted-foreground">
                  Заявка: {lnkResultDraft.requestName || '-'} · Выбрано: {lnkResultDraft.rowIds.size}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={openLnkResultManager}
                  disabled={lnkResultDraft.rowIds.size === 0}
                  className="border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Редактировать результаты
                </Button>
                <Button variant="ghost" size="icon" onClick={closeAddLnkResultModal} aria-label="Закрыть">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden px-6 py-5 lg:grid-cols-[340px_minmax(0,1fr)]">
              <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">1. Метод и результат</h3>
                  <div className="grid grid-cols-1 gap-3">
                  <label className="block space-y-1.5 text-sm">
                    <span className="text-[13px] font-medium leading-none text-slate-700">Метод контроля</span>
                    <Select
                      value={lnkResultDraft.methodKey}
                      onChange={(event) => changeLnkResultMethod(event.target.value as WeldFieldKey)}
                      disabled={selectedLnkResultMethods.length === 0}
                    >
                      <option value="">Выберите метод</option>
                      {selectedLnkResultMethods.map((method) => (
                        <option key={method.requestKey} value={method.requestKey}>
                          {method.code}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="block space-y-1.5 text-sm">
                    <span className="text-[13px] font-medium leading-none text-slate-700">Дата контроля</span>
                    <Input
                      type="date"
                      value={lnkResultDraft.controlDate}
                      disabled={!hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft)}
                      onChange={(event) => setLnkResultDraft((current) => ({ ...current, controlDate: event.target.value }))}
                    />
                  </label>

                  <label className="block space-y-1.5 text-sm">
                    <span className="text-[13px] font-medium leading-none text-slate-700">Результат по умолчанию</span>
                    <Select
                      value={lnkResultDraft.result}
                      onChange={(event) =>
                        setLnkResultDraft((current) => ({
                          ...current,
                          result: event.target.value,
                          rowResults: {},
                        }))
                      }
                    >
                      <option value="">Выберите результат</option>
                      <option value={LNK_CUSTOM_RESULT_VALUE} disabled>
                        пользовательский
                      </option>
                      {LNK_RESULT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </label>
                  </div>
                </div>

                <div
                  className={`rounded-md border border-slate-200 p-3 ${
                    !hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft) ? 'bg-slate-50 opacity-60' : 'bg-white'
                  }`}
                >
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">2. Заключение</h3>
                  <RequestNamingControls
                    naming={lnkResultDraft.conclusionNaming}
                    systemName={nextLnkConclusionName}
                    label="Наименование заключения"
                    placeholder="Введите наименование заключения"
                    disabled={!hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft)}
                    onChange={(conclusionNaming) => setLnkResultDraft((current) => ({ ...current, conclusionNaming }))}
                  />
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                  Результат заменит статус «ожидает НК» в выбранном виде контроля. Наименование заключения попадет в
                  соответствующий столбец раздела «Заключения». Уже внесенные результаты изменяются только через
                  «Редактировать результаты».
                </div>
              </section>

              <section className="flex min-h-0 flex-col space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Стыки для результата</h3>
                    <p className="text-xs leading-5 text-slate-500">
                      Видны проект, шифр, линия, спул и номер стыка для проверки перед сохранением.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {lnkResultDraft.rowIds.size > 0 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShouldPinPreviewedLnkResultRows(false)
                          setLnkResultDraft((current) => ({
                            ...current,
                            rowIds: new Set(),
                            rowResults: {},
                          }))
                        }}
                      >
                        Снять выбор
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleAllLnkResultRows}
                      disabled={!canBulkToggleLnkResultRows}
                    >
                      {!lnkResultContextReady
                        ? 'Выберите метод'
                        : !canBulkToggleLnkResultRows
                          ? 'Сузьте поиск'
                        : isEveryFilteredLnkRequestRowSelected(
                        lnkResultDraft.rowIds,
                        selectableVisibleLnkResultRows,
                      )
                        ? 'Снять все'
                        : 'Выбрать все доступные'}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <Input
                    value={lnkResultDraft.search}
                    onChange={(event) => setLnkResultDraft((current) => ({ ...current, search: event.target.value }))}
                    placeholder="Проект, шифр, линия, спул или стык"
                    className="h-9 min-w-56 flex-[0.85] bg-white"
                  />
                  <Input
                    value={lnkResultRequestSearch}
                    onChange={(event) => setLnkResultRequestSearch(event.target.value)}
                    placeholder="Поиск заявки"
                    className="h-9 min-w-44 flex-[0.45] bg-white"
                  />
                  <Select
                    value={lnkResultDraft.requestName}
                    onChange={(event) => changeLnkResultRequest(event.target.value)}
                    className="h-9 min-w-48 flex-[0.5] bg-white"
                  >
                    <option value="">Все заявки</option>
                    {filteredLnkResultRequestOptions.map((requestName) => (
                      <option key={requestName} value={requestName}>
                        {requestName}
                      </option>
                    ))}
                  </Select>
                  {lnkResultRequestSearch ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLnkResultRequestSearch('')}
                      className="h-9 px-2"
                      aria-label="Очистить поиск заявки"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                    Заявок: {filteredLnkResultRequestOptions.length}/{lnkResultAvailableRequestOptions.length}
                  </span>
                  <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                    Найдено: {visibleLnkResultRows.length} · Выбрано: {lnkResultDraft.rowIds.size}
                  </span>
                  {lnkResultDraft.search ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setLnkResultRequestSearch('')
                        setShouldPinPreviewedLnkResultRows(false)
                        setLnkResultDraft((current) => ({
                          ...current,
                          requestName: '',
                          rowIds: new Set(),
                          rowResults: {},
                          search: '',
                        }))
                      }}
                    >
                      Очистить
                    </Button>
                  ) : null}
                </div>

                <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
                  {visibleLnkResultRows.length === 0 ? (
                    <div className="flex min-h-72 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
                      {lnkResultDraft.search
                          ? 'По фильтру ничего не найдено.'
                          : 'По выбранному методу нет стыков для добавления результата.'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {visibleLnkResultRows.map((row) => {
                        const method = getLnkMethodByRequestKey(lnkResultDraft.methodKey)
                        const disabled = !canSelectLnkResultRow(row, lnkResultDraft.requestName, lnkResultDraft.methodKey)
                        const selected = lnkResultDraft.rowIds.has(row.id) && !disabled
                        const rowRequestNames = getLnkRowRequestNames(row)
                        const rowResult = getEffectiveLnkResultDraftValue(row.id, lnkResultDraft)
                        const hasSavedFinalResult = Boolean(
                          method && LNK_RESULT_OPTIONS.includes(String(row[method.resultKey] ?? '').trim().toLowerCase() as never),
                        )
                        return (
	                          <div
	                            key={row.id}
	                            onClick={() => {
	                              if (!disabled) toggleLnkResultRow(row.id)
	                            }}
	                            className={`grid grid-cols-[28px_minmax(220px,1fr)_minmax(180px,0.8fr)] gap-3 px-4 py-3 text-sm transition-colors ${
                              disabled
                                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                                : selected
                                  ? 'cursor-pointer bg-emerald-50/80'
                                  : 'cursor-pointer bg-white hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleLnkResultRow(row.id)}
                              disabled={disabled}
                              className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900"
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-slate-900">{getJointTitle(row)}</span>
                              <span className="block truncate text-xs text-slate-500">
                                Проект: <span className="font-semibold text-slate-700">{String(row.projectTitle ?? '-')}</span> · Шифр:{' '}
                                <span className="font-semibold text-slate-700">{String(row.subtitleCode ?? '-')}</span> · Стык:{' '}
                                <span className="font-semibold text-slate-700">{String(row.joint ?? '-')}</span>
                              </span>
                              <span className="block truncate text-xs text-slate-500">
                                Спул: <span className="font-semibold text-slate-700">{String(row.spool ?? '-')}</span>
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                                {formatLnkResultSummaryItems(row).map((item) => (
                                  <span
                                    key={item.method}
                                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium ${item.inactive ? getInactiveLnkRequestBadgeClass() : getLnkResultBadgeClass(item.result)}`}
                                  >
                                    <span className="font-bold">{item.method}</span>
                                    <span>{item.result}</span>
                                  </span>
                                ))}
                              </span>
                              {disabled ? (
                                <span className="block truncate text-xs text-amber-700">
                                  {rowRequestNames.length === 0
                                    ? 'На этот стык еще нет заявки ЛНК.'
                                    : !lnkResultDraft.methodKey
                                      ? 'Выберите метод контроля, чтобы отметить стык.'
                                    : hasSavedFinalResult
                                      ? 'Результат уже внесен. Используйте «Редактировать результаты».'
                                    : lnkResultDraft.requestName
                                      ? 'Для выбранных заявки и метода этот стык не подходит.'
                                      : 'На выбранный метод по этому стыку нет заявки ЛНК.'}
                                </span>
                              ) : null}
                              {selected ? (
                                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                                  <span className="mr-1 text-xs font-medium text-slate-500">Результат:</span>
                                  {LNK_RESULT_OPTIONS.map((option) => {
                                    const active = rowResult === option
                                    return (
                                      <button
                                        key={option}
                                        type="button"
                                        onClick={(event) => {
                                          event.preventDefault()
                                          event.stopPropagation()
                                          setLnkResultForRow(row.id, option)
                                        }}
                                        className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                                          active
                                            ? getLnkResultBadgeClass(option)
                                            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                                        }`}
                                      >
                                        {option}
                                      </button>
                                    )
                                  })}
                                </span>
                              ) : null}
                            </span>
                            <span className="flex flex-wrap content-start gap-1.5">
                              {rowRequestNames.length === 0 ? (
                                <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                                  Нет заявки
                                </span>
                              ) : (
                                getLnkRowRequestMethods(row, lnkResultDraft.requestName).map((availableMethod) => {
                                  const requestName = String(row[availableMethod.requestKey] ?? '').trim()
                                  const conclusionName = String(row[availableMethod.conclusionKey] ?? '').trim()
                                  const hasNoNeed = isLnkMethodNoNeed(row, availableMethod)
                                  const isSelectedMethod = availableMethod.requestKey === lnkResultDraft.methodKey
                                  const isSelectedRowMethod = selected && isSelectedMethod
                                  return (
                                    <span
                                      key={availableMethod.requestKey}
                                      className={`inline-flex max-w-full flex-col gap-0.5 rounded border px-2 py-1 text-xs font-medium ${
                                        isSelectedRowMethod
                                          ? 'border-sky-200 bg-sky-50 text-sky-900'
                                          : getLnkRequestMethodBadgeClass(row, availableMethod)
                                      }`}
                                    >
                                      <span
                                        className={`flex max-w-full items-center gap-1.5 whitespace-normal break-words ${
                                          isSelectedRowMethod ? 'text-sky-700' : 'text-slate-500'
                                        }`}
                                      >
                                        <span
                                          className={`rounded px-1.5 py-0.5 text-[11px] font-bold leading-none ${
                                            isSelectedRowMethod
                                              ? 'bg-sky-100 text-sky-900'
                                              : 'border border-slate-200 bg-slate-100 text-slate-700'
                                          }`}
                                        >
                                          {availableMethod.code}
                                        </span>
                                        <span className="min-w-0 overflow-visible break-all whitespace-normal [text-overflow:clip]">
                                          {hasNoNeed ? 'нет потребности' : requestName}
                                        </span>
                                      </span>
                                      {conclusionName && !hasNoNeed ? (
                                        <span className="max-w-full overflow-visible break-all whitespace-normal [text-overflow:clip]">
                                          {conclusionName}
                                        </span>
                                      ) : null}
                                    </span>
                                  )
                                })
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="flex items-end justify-between gap-4 border-t border-slate-200/80 px-5 py-4">
              <div className="min-h-5 text-sm text-slate-500">
                {lnkResultSaveBlockReason ? (
                  <span className="text-sm text-slate-500">
                    Чтобы сохранить: {lnkResultSaveBlockReason}
                  </span>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeAddLnkResultModal}>
                  Отмена
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShouldPinPreviewedLnkResultRows(true)
                    setIsLnkResultPreviewOpen(true)
                  }}
                  disabled={selectedLnkResultRows.length === 0}
                >
                  Предпросмотр ({selectedLnkResultRows.length})
                </Button>
                <span title={lnkResultSaveBlockReason || 'Можно сохранить результат'}>
                  <Button
                    onClick={handleAddLnkResult}
                    disabled={isLnkResultSaveDisabled}
                    className={isLnkResultSaveDisabled ? 'pointer-events-none' : ''}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Сохранить результат
                  </Button>
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isLnkResultPreviewOpen ? (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/25 px-4 backdrop-blur-[1px]">
          <div className="flex max-h-[86vh] w-full max-w-4xl flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Предпросмотр выбранных стыков</h2>
                <p className="text-sm text-muted-foreground">
                  Метод: {getLnkMethodByRequestKey(lnkResultDraft.methodKey)?.code || '-'} · Выбрано: {selectedLnkResultRows.length}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsLnkResultPreviewOpen(false)} aria-label="Закрыть предпросмотр">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              {selectedLnkResultRows.length === 0 ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Нет выбранных стыков.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {selectedLnkResultRows.map((row) => {
                    const method = getLnkMethodByRequestKey(lnkResultDraft.methodKey)
                    const currentResult = method ? String(row[method.resultKey] ?? '').trim() || 'заявка' : '-'
                    const requestName = method ? String(row[method.requestKey] ?? '').trim() : ''
                    const result = getEffectiveLnkResultDraftValue(row.id, lnkResultDraft)
                    return (
                      <div key={row.id} className="grid grid-cols-[minmax(320px,1fr)_minmax(220px,0.45fr)] gap-4 px-4 py-3 text-sm">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900">{getJointTitle(row)}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            Проект: <span className="font-semibold text-slate-700">{String(row.projectTitle ?? '-')}</span> · Шифр:{' '}
                            <span className="font-semibold text-slate-700">{String(row.subtitleCode ?? '-')}</span> · Спул:{' '}
                            <span className="font-semibold text-slate-700">{String(row.spool ?? '-')}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-bold text-slate-700">
                              {method?.code || '-'}
                            </span>
                            {requestName ? (
                              <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-medium text-sky-800">
                                {requestName}
                              </span>
                            ) : null}
                            <span className={`rounded border px-1.5 py-0.5 font-semibold ${getLnkResultBadgeClass(currentResult)}`}>
                              Сейчас: {currentResult}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end justify-start gap-1.5">
                          <span className="text-xs font-medium text-slate-500">Будет записано:</span>
                          <span className={`rounded border px-2 py-1 text-xs font-semibold ${getLnkResultBadgeClass(result)}`}>
                            {result || '-'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
              <Button variant="outline" onClick={() => setIsLnkResultPreviewOpen(false)}>
                Закрыть
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {heatTreatmentFieldEditing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="w-full max-w-xl rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
            <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">{heatTreatmentFieldEditing.label}</h2>
                <p className="text-sm text-muted-foreground">{getJointTitle(heatTreatmentFieldEditing.record)}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setHeatTreatmentFieldEditing(null)} aria-label="Закрыть">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2 px-5 py-5">
              <label className="space-y-1.5 text-sm">
                <span className="text-[13px] font-medium leading-none text-slate-700">{heatTreatmentFieldEditing.label}</span>
                {heatTreatmentFieldEditing.mode === 'result' ? (
                  <Select
                    autoFocus
                    value={heatTreatmentFieldEditing.value}
                    onChange={(event) =>
                      setHeatTreatmentFieldEditing((current) =>
                        current ? { ...current, value: event.target.value } : current,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setHeatTreatmentFieldEditing(null)
                      if (event.key === 'Enter') saveEditedHeatTreatmentField()
                    }}
                  >
                    <option value="">пусто</option>
                    {RESULT_STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                ) : heatTreatmentFieldEditing.mode === 'request' ? (
                  <Select
                    autoFocus
                    value={heatTreatmentFieldEditing.value}
                    onChange={(event) =>
                      setHeatTreatmentFieldEditing((current) =>
                        current ? { ...current, value: event.target.value } : current,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setHeatTreatmentFieldEditing(null)
                      if (event.key === 'Enter') saveEditedHeatTreatmentField()
                    }}
                  >
                    <option value="">пусто</option>
                    {withCurrentOption(lnkRequestOptions, heatTreatmentFieldEditing.value).map((requestName) => (
                      <option key={requestName} value={requestName}>
                        {requestName}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    autoFocus
                    type={heatTreatmentFieldEditing.kind}
                    value={heatTreatmentFieldEditing.value}
                    onChange={(event) =>
                      setHeatTreatmentFieldEditing((current) =>
                        current ? { ...current, value: event.target.value } : current,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setHeatTreatmentFieldEditing(null)
                      if (event.key === 'Enter') saveEditedHeatTreatmentField()
                    }}
                  />
                )}
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
              <Button variant="outline" onClick={() => setHeatTreatmentFieldEditing(null)}>
                Отмена
              </Button>
              <Button
                onClick={saveEditedHeatTreatmentField}
                disabled={heatTreatmentFieldMutation.isPending || lnkFieldMutation.isPending}
              >
                <Check className="mr-2 h-4 w-4" />
                Сохранить
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

async function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  await queryClient.invalidateQueries({ queryKey: ['weld-joints'] })
}

function filterLocalWelds(filters: WeldFilters) {
  return readLocalWelds().filter((row) => {
    const search = filters.search?.trim().toLowerCase()
    if (search) {
      const haystack = [row.joint, row.line, row.isometry, row.spool, row.material1, row.material2, row.responsible]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(search)) return false
    }

    for (const key of [
      'projectTitle',
      'line',
      'groupName',
      'category',
      'pstoRequired',
      'weldingMethod',
      'status',
      'finalStatus',
    ] as const) {
      if (filters[key] && row[key] !== filters[key]) return false
    }

    if (filters.controlMethod) {
      const controlKey = {
        ВИК: 'hasVik',
        РК: 'hasRk',
        ПВК: 'hasPvk',
        УЗК: 'hasUzk',
        ТВМТ: 'hasTvmt',
        РФА: 'hasRfa',
        СТЛС: 'hasStls',
        МКК: 'hasMkk',
      }[filters.controlMethod] as keyof typeof row | undefined
      if (controlKey && row[controlKey] !== true) return false
    }

    return true
  })
}

function sumAcceptedWdi(rows: Array<WeldInput & { id?: number }>) {
  return rows.reduce((total, row) => {
    if (String(row.finalStatus ?? '').trim().toLowerCase() !== 'годен') return total
    const value = typeof row.wdi === 'number' ? row.wdi : Number(String(row.wdi ?? '').replace(',', '.'))
    return Number.isFinite(value) ? total + value : total
  }, 0)
}

function buildLnkWaitingNkRows(rows: Array<WeldInput & { id: number }>) {
  return rows.flatMap((row) =>
    LNK_METHODS.flatMap((method) => {
      const result = String(row[method.resultKey] ?? '').trim().toLowerCase()
      const requestName = String(row[method.requestKey] ?? '').trim()
      if (result !== 'ожидает нк') return []
      if (isLnkMethodNoNeed(row, method)) return []
      return [
        {
          projectTitle: row.projectTitle ?? '',
          subtitleCode: row.subtitleCode ?? '',
          line: row.line ?? '',
          spool: row.spool ?? '',
          joint: row.joint ?? '',
          wdi: row.wdi ?? '',
          weldDate: row.weldDate ?? '',
          requestName,
          controlMethod: method.code,
        },
      ]
    }),
  )
}

function buildLnkToRequestRows(rows: Array<WeldInput & { id: number }>) {
  return rows.flatMap((row) =>
    getAvailableLnkRequestMethods(row).map((method) => ({
      projectTitle: row.projectTitle ?? '',
      subtitleCode: row.subtitleCode ?? '',
      line: row.line ?? '',
      spool: row.spool ?? '',
      joint: row.joint ?? '',
      wdi: row.wdi ?? '',
      weldDate: row.weldDate ?? '',
      requestName: '',
      controlMethod: method.code,
    })),
  )
}

function buildLnkConclusionsRows(rows: Array<WeldInput & { id: number }>) {
  return rows.flatMap((row) =>
    LNK_METHODS.flatMap((method) => {
      const result = String(row[method.resultKey] ?? '').trim()
      const conclusionName = String(row[method.conclusionKey] ?? '').trim()
      const controlDate = row[method.conclusionDateKey] ?? ''
      if (!result && !conclusionName && !controlDate) return []
      if (result.toLowerCase() === 'ожидает нк' && !conclusionName && !controlDate) return []

      return [
        {
          projectTitle: row.projectTitle ?? '',
          subtitleCode: row.subtitleCode ?? '',
          line: row.line ?? '',
          spool: row.spool ?? '',
          joint: row.joint ?? '',
          wdi: row.wdi ?? '',
          weldDate: row.weldDate ?? '',
          requestName: row[method.requestKey] ?? '',
          controlMethod: method.code,
          controlDate,
          result,
          conclusionName,
        },
      ]
    }),
  )
}

function buildLnkReportHtml(
  rows: WeldInput[],
  bytes: Uint8Array,
  title = 'Ожидание НК',
  filename = 'lnk-waiting-nk.xlsx',
  fields = LNK_WAITING_NK_FIELDS,
) {
  const headers = fields.map((field) => field.label)
  const xlsxBase64 = bytesToBase64(bytes)
  const bodyRows = rows
    .map(
      (row) => `
        <tr>
          ${fields.map((field) => `<td>${escapeHtml(formatLnkReportCell(row[field.key], field))}</td>`).join('')}
        </tr>
      `,
    )
    .join('')

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f8fafc; color: #172033; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .page { padding: 24px; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
    h1 { margin: 0; font-size: 22px; line-height: 1.2; }
    .meta { margin-top: 4px; color: #64748b; font-size: 13px; }
    button { border: 1px solid #1e293b; border-radius: 6px; background: #172033; color: white; padding: 10px 14px; font: inherit; font-weight: 600; cursor: pointer; }
    button:hover { background: #0f172a; }
    .table-wrap { overflow: auto; border: 1px solid #d8e0ec; border-radius: 8px; background: white; }
    table { width: 100%; min-width: 1080px; border-collapse: collapse; table-layout: fixed; }
    th { background: #d8e0ec; color: #334155; font-size: 13px; font-weight: 700; text-align: center; padding: 14px 10px; border-right: 1px solid #edf2f7; }
    td { padding: 12px 10px; border-top: 1px solid #edf2f7; border-right: 1px solid #edf2f7; color: #24364d; font-size: 13px; text-align: center; }
    tr:nth-child(even) td { background: #f8fafc; }
  </style>
</head>
<body>
  <div class="page">
    <div class="toolbar">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">Строк: ${rows.length}</div>
      </div>
      <button type="button" id="download">Скачать Excel</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  </div>
  <script>
    const base64 = "${xlsxBase64}";
    document.getElementById("download").addEventListener("click", () => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "${escapeJsString(filename)}";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  </script>
</body>
</html>`
}

function formatLnkReportCell(value: unknown, field: WeldField) {
  if (field.key === 'weldDate' || field.key === 'controlDate') return formatDisplayDate(value)
  if (field.key === 'wdi') return value ?? ''
  return value ?? ''
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function escapeJsString(value: unknown) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
}

function formatDisplayDate(value: unknown) {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return text
  return `${match[3]}.${match[2]}.${match[1]}`
}

function buildHeatTreatmentImportUpdates(
  importedRecords: WeldInput[],
  heatTreatmentRows: Array<WeldInput & { id: number }>,
  rows: Array<WeldInput & { id: number }>,
  allowedPstoRequestNames: ReadonlySet<string>,
) {
  const rowsByKey = new Map<string, WeldInput & { id: number }>()
  const duplicateKeys = new Set<string>()
  for (const row of heatTreatmentRows) {
    const key = getHeatTreatmentImportKey(row)
    if (!key) continue
    if (rowsByKey.has(key)) {
      duplicateKeys.add(key)
      rowsByKey.delete(key)
      continue
    }
    if (!duplicateKeys.has(key)) rowsByKey.set(key, row)
  }

  const proposedRowsById = new Map<number, WeldInput & { id: number }>()
  let matched = 0
  let skipped = 0

  for (const importedRecord of importedRecords) {
    const key = getHeatTreatmentImportKey(importedRecord)
    const currentRow = key ? rowsByKey.get(key) : null
    if (!currentRow) {
      skipped += 1
      continue
    }

    matched += 1
    let nextRow: WeldInput & { id: number } = { ...currentRow }
    let changed = false

    for (const fieldKey of heatTreatmentEditableFieldKeys) {
      if (!(fieldKey in importedRecord)) continue
      const importedUpdate =
        fieldKey === 'pstoRequest'
          ? normalizeExistingRequestImportValue(importedRecord[fieldKey], allowedPstoRequestNames)
          : { skip: false, value: normalizeHeatTreatmentImportValue(fieldKey, importedRecord[fieldKey]) }
      if (importedUpdate.skip) continue
      const importedValue = importedUpdate.value
      if (fieldKey === 'pstoResult' && importedValue === 'проведено' && !hasText(nextRow.pstoRequest)) continue
      if (isSameImportValue(nextRow[fieldKey], importedValue)) continue

      nextRow = { ...nextRow, [fieldKey]: importedValue }
      changed = true
    }

    if (changed) proposedRowsById.set(currentRow.id, nextRow)
  }

  if (proposedRowsById.size === 0) {
    return { updatedRows: [], changedFieldKeys: [], matched, skipped }
  }

  const updatedIds = new Set(proposedRowsById.keys())
  const recalculatedRows = withAutoHeatTreatmentDiagrams(rows.map((row) => proposedRowsById.get(row.id) ?? row))
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const updatedRows: WeldRow[] = []
  const changedFieldKeys = new Set<WeldFieldKey>()

  for (const row of recalculatedRows) {
    if (!updatedIds.has(row.id)) continue
    const originalRow = rowsById.get(row.id)
    if (!originalRow) continue

    for (const fieldKey of heatTreatmentEditableFieldKeys) {
      if (!isSameImportValue(originalRow[fieldKey], row[fieldKey])) {
        changedFieldKeys.add(fieldKey)
      }
    }
    if (!isSameImportValue(originalRow.heatTreatmentDiagram, row.heatTreatmentDiagram)) {
      changedFieldKeys.add('heatTreatmentDiagram')
    }
    updatedRows.push(row as WeldRow)
  }

  return { updatedRows, changedFieldKeys: [...changedFieldKeys], matched, skipped }
}

function buildEditableImportUpdates({
  importedRecords,
  targetRows,
  rows,
  editableFieldKeys,
  normalizeValue,
  transformRow,
}: {
  importedRecords: WeldInput[]
  targetRows: Array<WeldInput & { id: number }>
  rows: Array<WeldInput & { id: number }>
  editableFieldKeys: ReadonlySet<WeldFieldKey>
  normalizeValue?: (
    fieldKey: WeldFieldKey,
    value: unknown,
    currentRow: WeldInput & { id: number },
  ) => { skip: boolean; value: unknown }
  transformRow?: (row: WeldInput & { id: number }) => WeldInput & { id: number }
}) {
  const rowsByKey = new Map<string, WeldInput & { id: number }>()
  const duplicateKeys = new Set<string>()
  for (const row of targetRows) {
    const key = getHeatTreatmentImportKey(row)
    if (!key) continue
    if (rowsByKey.has(key)) {
      duplicateKeys.add(key)
      rowsByKey.delete(key)
      continue
    }
    if (!duplicateKeys.has(key)) rowsByKey.set(key, row)
  }

  const proposedRowsById = new Map<number, WeldInput & { id: number }>()
  let matched = 0
  let skipped = 0

  for (const importedRecord of importedRecords) {
    const key = getHeatTreatmentImportKey(importedRecord)
    const currentRow = key ? rowsByKey.get(key) : null
    if (!currentRow) {
      skipped += 1
      continue
    }

    matched += 1
    let nextRow: WeldInput & { id: number } = { ...currentRow }
    let changed = false

    for (const fieldKey of editableFieldKeys) {
      if (!(fieldKey in importedRecord)) continue
      const importedUpdate = normalizeValue
        ? normalizeValue(fieldKey, importedRecord[fieldKey], currentRow)
        : { skip: false, value: normalizeEditableImportValue(fieldKey, importedRecord[fieldKey]) }
      if (importedUpdate.skip) continue
      const importedValue = importedUpdate.value
      if (isSameImportValue(nextRow[fieldKey], importedValue)) continue
      nextRow = { ...nextRow, [fieldKey]: importedValue }
      changed = true
    }

    if (changed) proposedRowsById.set(currentRow.id, transformRow ? transformRow(nextRow) : nextRow)
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const updatedRows: WeldRow[] = []
  const changedFieldKeys = new Set<WeldFieldKey>()

  for (const row of proposedRowsById.values()) {
    const originalRow = rowsById.get(row.id)
    if (!originalRow) continue

    for (const fieldKey of editableFieldKeys) {
      if (!isSameImportValue(originalRow[fieldKey], row[fieldKey])) {
        changedFieldKeys.add(fieldKey)
      }
    }
    if (!isSameImportValue(originalRow.finalStatus, row.finalStatus)) {
      changedFieldKeys.add('finalStatus')
    }
    updatedRows.push(row as WeldRow)
  }

  return { updatedRows, changedFieldKeys: [...changedFieldKeys], matched, skipped }
}

function getHeatTreatmentImportKey(record: WeldInput) {
  const line = normalizeImportKeyPart(record.line)
  const joint = normalizeImportKeyPart(record.joint)
  return line && joint ? `${line}|${joint}` : null
}

function normalizeImportKeyPart(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function normalizeHeatTreatmentImportValue(fieldKey: WeldFieldKey, value: unknown) {
  if (fieldKey === 'pstoResult') return getPstoResultValue(value) || null
  return value === undefined ? null : value
}

function normalizeEditableImportValue(fieldKey: WeldFieldKey, value: unknown) {
  return value === undefined ? null : value
}

function normalizeExistingRequestImportValue(value: unknown, allowedRequestNames: ReadonlySet<string>) {
  const requestName = String(value ?? '').trim()
  if (!requestName) return { skip: false, value: null }
  if (!allowedRequestNames.has(requestName)) return { skip: true, value: null }
  return { skip: false, value: requestName }
}

function isSameImportValue(left: unknown, right: unknown) {
  return String(left ?? '').trim() === String(right ?? '').trim()
}

function downloadExcelBytes(bytes: Uint8Array, filename: string) {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const blob = new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function getReportExportFields({
  storageKey,
  hiddenFieldKeys,
  mergePstoSections,
}: {
  storageKey: string
  hiddenFieldKeys: ReadonlySet<WeldFieldKey>
  mergePstoSections: boolean
}) {
  const collapsedSections = readCollapsedSections(storageKey)
  const reportAlwaysVisibleFieldKeys = new Set(alwaysVisibleFieldKeys)
  if (mergePstoSections) {
    for (const fieldKey of pstoSectionFieldKeys) {
      reportAlwaysVisibleFieldKeys.add(fieldKey)
    }
  }
  const availableSections = getReportExportSections(hiddenFieldKeys, mergePstoSections)

  return availableSections.flatMap((group) => {
    const isCollapsed = collapsedSections.has(group.section) && canCollapseExportSection(group.fields, reportAlwaysVisibleFieldKeys)
    return isCollapsed ? group.fields.filter((field) => reportAlwaysVisibleFieldKeys.has(field.key)) : group.fields
  })
}

function getReportExportSections(hiddenFieldKeys: ReadonlySet<WeldFieldKey>, mergePstoSections: boolean) {
  const sections = VISIBLE_FIELD_SECTIONS.map((group) => ({
    ...group,
    fields: group.fields.filter((field) => !hiddenFieldKeys.has(field.key)),
  })).filter((group) => group.fields.length > 0)

  if (!mergePstoSections) return sections

  const pstoFields = sections.flatMap((group) => group.fields).filter((field) => pstoSectionFieldKeys.has(field.key))
  const sectionsWithoutPsto = sections
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => !pstoSectionFieldKeys.has(field.key)),
    }))
    .filter((group) => group.fields.length > 0)
  const miscIndex = sectionsWithoutPsto.findIndex((group) => group.section === 'Прочее')
  const pstoSection = pstoFields.length > 0 ? [{ section: 'ПСТО', fields: pstoFields }] : []
  if (miscIndex === -1) return [...sectionsWithoutPsto, ...pstoSection]

  return [...sectionsWithoutPsto.slice(0, miscIndex), ...pstoSection, ...sectionsWithoutPsto.slice(miscIndex)]
}

function canCollapseExportSection(fields: readonly WeldField[], reportAlwaysVisibleFieldKeys: ReadonlySet<WeldFieldKey>) {
  return fields.some((field) => !reportAlwaysVisibleFieldKeys.has(field.key as WeldFieldKey))
}

function getReportReadOnlyFieldKeys(activeReport: ActiveReport) {
  if (activeReport === 'weldingJournal') return weldingJournalBlockedFieldKeys
  if (activeReport === 'lnk') {
    return new Set(VISIBLE_FIELDS.map((field) => field.key as WeldFieldKey).filter((fieldKey) => !lnkEditableFieldKeys.has(fieldKey)))
  }
  return new Set(
    VISIBLE_FIELDS.map((field) => field.key as WeldFieldKey).filter((fieldKey) => !heatTreatmentEditableFieldKeys.has(fieldKey)),
  )
}

function readCollapsedSections(storageKey: string) {
  if (typeof window === 'undefined') return new Set<string>()

  try {
    const stored = window.localStorage.getItem(`${collapsedSectionsStoragePrefix}:${storageKey}`)
    if (!stored) return new Set<string>()
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? new Set(parsed.filter((value): value is string => typeof value === 'string')) : new Set<string>()
  } catch {
    return new Set<string>()
  }
}

function formatWdiTotal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function formatPstoRequestName(rows: Array<WeldInput & { id: number }>) {
  const date = formatShortDate(new Date())
  const prefix = `ПСТО-${date}-`
  const requestNames = [
    ...new Set(
      rows
        .map((row) => String(row.pstoRequest ?? '').trim())
        .filter((requestName) => requestName.startsWith(prefix)),
    ),
  ]
  const maxNumber = requestNames.reduce((max, requestName) => {
    const match = requestName.match(new RegExp(`^${escapeRegExp(prefix)}(\\d{3})$`))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  const nextNumber = Math.max(maxNumber, requestNames.length) + 1
  return `${prefix}${String(nextNumber).padStart(3, '0')}`
}

function formatLnkRequestName(rows: Array<WeldInput & { id: number }>) {
  const date = formatLongDate(new Date())
  const prefix = `Заявка-${date}-`
  const maxNumber = rows
    .flatMap((row) => LNK_METHODS.map((method) => String(row[method.requestKey] ?? '').trim()))
    .map((requestName) => parseLnkRequestName(requestName))
    .filter((parsed): parsed is { dateValue: number; number: number } => Boolean(parsed && parsed.dateValue === parseLongDateValue(date)))
    .reduce((max, parsed) => Math.max(max, parsed.number), 0)
  const requestNames = [
    ...new Set(
      rows
        .flatMap((row) => LNK_METHODS.map((method) => String(row[method.requestKey] ?? '').trim()))
        .filter((requestName) => parseLnkRequestName(requestName)?.dateValue === parseLongDateValue(date)),
    ),
  ]
  const nextNumber = Math.max(maxNumber, requestNames.length) + 1
  return `${prefix}${String(nextNumber).padStart(3, '0')}`
}

function hasAnyLnkControl(row: WeldInput) {
  return LNK_METHODS.some((method) => isEnabledControlValue(row[method.enabledKey]))
}

function hasAnyLnkGeneratedData(row: WeldInput) {
  return [...lnkGeneratedFieldKeys].some((fieldKey) => hasText(row[fieldKey]))
}

function hasAnyLnkReportControl(row: WeldInput) {
  return LNK_METHODS.some((method) => isEnabledControlValue(row[method.enabledKey]) || isCancelledLnkControl(row, method))
}

function withPendingLnkResults<T extends WeldInput>(row: T): T {
  let nextRow: (T & Record<string, unknown>) | null = null
  for (const method of LNK_METHODS) {
    if (!hasText(row[method.requestKey]) || hasText(row[method.resultKey])) continue
    nextRow = nextRow ?? ({ ...row } as T & Record<string, unknown>)
    nextRow[method.resultKey] = 'ожидает НК'
  }
  return (nextRow ?? row) as T
}

function toLnkReportRow<T extends WeldInput>(row: T): T {
  return toControlCancellationReportRow(row)
}

function toControlCancellationReportRow<T extends WeldInput>(row: T): T {
  let nextRow: (T & Record<string, unknown>) | null = null
  if (isCancelledPstoControl(row)) {
    nextRow = { ...row } as T & Record<string, unknown>
    nextRow.pstoRequired = 'отменен'
  }
  for (const method of LNK_METHODS) {
    if (!isCancelledLnkControl(row, method)) continue
    nextRow = nextRow ?? ({ ...row } as T & Record<string, unknown>)
    nextRow[method.enabledKey] = 'отменен'
  }
  return (nextRow ?? row) as T
}

function hasHeatTreatmentReportState(row: WeldInput) {
  return isYesText(row.pstoRequired) || isCancelledPstoControl(row)
}

function toHeatTreatmentReportRow<T extends WeldInput>(row: T): T {
  return toControlCancellationReportRow(row)
}

function isCancelledPstoControl(row: WeldInput) {
  return !isYesText(row.pstoRequired) && hasText(row.pstoResult)
}

function isCancelledLnkControl(row: WeldInput, method: (typeof LNK_METHODS)[number]) {
  return !isEnabledControlValue(row[method.enabledKey]) && hasLnkMethodReportHistory(row, method)
}

function hasLnkMethodReportHistory(row: WeldInput, method: (typeof LNK_METHODS)[number]) {
  return hasText(row[method.resultKey]) && hasText(row[method.conclusionKey])
}

function canCreateLnkRequest(row: WeldInput) {
  if (hasRejectedLnkResult(row)) return false
  return LNK_METHODS.some((method) => isEnabledControlValue(row[method.enabledKey]) && !hasText(row[method.requestKey]))
}

function getAvailableLnkRequestMethods(row: WeldInput) {
  if (hasRejectedLnkResult(row)) return []
  return LNK_METHODS.filter((method) => isEnabledControlValue(row[method.enabledKey]) && !hasText(row[method.requestKey]))
}

function collectRequestNames(rows: WeldInput[], fieldKeys: readonly WeldFieldKey[]) {
  return [
    ...new Set(
      rows
        .flatMap((row) => fieldKeys.map((fieldKey) => String(row[fieldKey] ?? '').trim()))
        .filter((value) => value.length > 0),
    ),
  ].sort((left, right) => left.localeCompare(right, 'ru'))
}

function withCurrentOption(options: string[], value: string) {
  const current = value.trim()
  if (!current || options.includes(current)) return options
  return [current, ...options]
}

function getRequestNameFromNaming(naming: RequestNamingState, systemName: string) {
  return naming.mode === 'system' ? systemName.trim() : naming.customName.trim()
}

function createDefaultLnkResultDraft(): LnkResultDraftState {
  return {
    requestName: '',
    methodKey: '',
    rowIds: new Set(),
    rowResults: {},
    controlDate: formatDateInputValue(new Date()),
    result: '',
    conclusionNaming: defaultRequestNamingState,
    search: '',
  }
}

function createDefaultPstoResultDraft(): PstoResultDraftState {
  return {
    requestName: '',
    rowIds: new Set(),
    pstoDate: formatDateInputValue(new Date()),
    result: '',
    diagramNaming: defaultRequestNamingState,
    search: '',
  }
}

function formatPstoDiagramName(rows: WeldInput[], pstoDate: string) {
  const date = formatPstoDiagramLongDate(pstoDate) ?? formatLongDate(new Date())
  const prefix = `ПСТО-Д-${formatPstoDiagramShortDateFromLong(date)}-`
  const maxNumber = rows
    .map((row) => String(row.heatTreatmentDiagram ?? '').trim())
    .map((value) => value.match(new RegExp(`^${escapeRegExp(prefix)}(\\d{3})$`))?.[1])
    .reduce((max, value) => (value ? Math.max(max, Number(value)) : max), 0)
  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`
}

function formatLnkConclusionName(rows: WeldInput[], controlDate: string, methodKey: WeldFieldKey | '') {
  const date = formatLongDate(controlDate ? new Date(`${controlDate}T00:00:00`) : new Date())
  const method = methodKey ? getLnkMethodByRequestKey(methodKey) : null
  const methodCode = method?.code ?? 'ЛНК'
  const prefix = `Заключение-${methodCode}-${date}-`
  const maxNumber = rows
    .flatMap((row) => LNK_METHODS.map((method) => String(row[method.conclusionKey] ?? '').trim()))
    .map((value) => value.match(new RegExp(`^(?:(?:Закл\\.|Заключение)-)?[^-]+-${escapeRegExp(date)}-(\\d{3})$`))?.[1])
    .reduce((max, value) => (value ? Math.max(max, Number(value)) : max), 0)
  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`
}

function collectLnkResultRequestNames(rows: WeldInput[]) {
  return sortLnkRequestNamesNewestFirst(collectRequestNames(rows, lnkRequestFieldKeys))
}

function sortPstoRequestNamesNewestFirst(requestNames: string[]) {
  return [...requestNames].sort((left, right) => {
    const leftParsed = parsePstoRequestName(left)
    const rightParsed = parsePstoRequestName(right)
    if (leftParsed && rightParsed) {
      if (leftParsed.dateValue !== rightParsed.dateValue) return rightParsed.dateValue - leftParsed.dateValue
      if (leftParsed.number !== rightParsed.number) return rightParsed.number - leftParsed.number
      return right.localeCompare(left, 'ru', { numeric: true })
    }
    if (leftParsed) return -1
    if (rightParsed) return 1
    return right.localeCompare(left, 'ru', { numeric: true })
  })
}

function sortLnkRequestNamesNewestFirst(requestNames: string[]) {
  return [...requestNames].sort((left, right) => {
    const leftParsed = parseLnkRequestName(left)
    const rightParsed = parseLnkRequestName(right)
    if (leftParsed && rightParsed) {
      if (leftParsed.dateValue !== rightParsed.dateValue) return rightParsed.dateValue - leftParsed.dateValue
      if (leftParsed.number !== rightParsed.number) return rightParsed.number - leftParsed.number
      return right.localeCompare(left, 'ru', { numeric: true })
    }
    if (leftParsed) return -1
    if (rightParsed) return 1
    return right.localeCompare(left, 'ru', { numeric: true })
  })
}

function parseLnkRequestName(value: string) {
  const match = value.trim().match(/^(?:ЛНК|Заявка)-(\d{2})\.(\d{2})\.(\d{2}|\d{4})-(\d{3})$/)
  if (!match) return null
  const [, day, month, year, number] = match
  const fullYear = year.length === 2 ? `20${year}` : year
  return {
    dateValue: Number(`${fullYear}${month}${day}`),
    number: Number(number),
  }
}

function parsePstoRequestName(value: string) {
  const match = value.trim().match(/^ПСТО-(\d{2})\.(\d{2})\.(\d{2})-(\d{3})$/)
  if (!match) return null
  const [, day, month, year, number] = match
  return {
    dateValue: Number(`20${year}${month}${day}`),
    number: Number(number),
  }
}

function filterPstoRowsByRequestName(rows: WeldRow[], requestName: string) {
  const name = requestName.trim()
  if (!name) return []
  return rows.filter((row) => String(row.pstoRequest ?? '').trim() === name)
}

function filterLnkRowsByRequestName(rows: WeldRow[], requestName: string) {
  const name = requestName.trim()
  if (!name) return []
  return rows.filter((row) => LNK_METHODS.some((method) => String(row[method.requestKey] ?? '').trim() === name))
}

function getLnkRequestMethodsForRows(rows: WeldInput[], requestName: string) {
  const name = requestName.trim()
  if (!name) return []
  return LNK_METHODS.filter((method) => rows.some((row) => String(row[method.requestKey] ?? '').trim() === name))
}

function getLnkInputMethodsForRows(rows: WeldInput[], requestName: string) {
  const name = requestName.trim()
  return LNK_METHODS.filter((method) =>
    rows.some((row) => {
      const rowRequestName = String(row[method.requestKey] ?? '').trim()
      if (!rowRequestName) return false
      if (name && rowRequestName !== name) return false
      if (isLnkMethodNoNeed(row, method)) return false
      return !isFinalLnkResultValue(row[method.resultKey])
    }),
  )
}

function getLnkRowRequestNames(row: WeldInput) {
  return [
    ...new Set(
      LNK_METHODS.map((method) => String(row[method.requestKey] ?? '').trim()).filter((requestName) => requestName.length > 0),
    ),
  ]
}

function getLnkRowRequestMethods(row: WeldInput, requestName: string) {
  const name = requestName.trim()
  return LNK_METHODS.filter((method) => {
    const rowRequestName = String(row[method.requestKey] ?? '').trim()
    return name ? rowRequestName === name : rowRequestName.length > 0
  })
}

function filterLnkResultRows(rows: WeldRow[], search: string, methodKey: WeldFieldKey | '' = '') {
  const query = normalizeSearchText(search)
  const compactQuery = compactSearchText(query)
  return rows
    .filter((row) => {
      if (!query) return true
      const values = [row.projectTitle, row.subtitleCode, row.line, row.spool, row.joint]
      const haystack = normalizeSearchText(values.map((value) => String(value ?? '')).join(' '))
      return haystack.includes(query) || compactSearchText(haystack).includes(compactQuery)
    })
    .sort((left, right) => compareLnkResultEntryRows(left, right, methodKey))
}

function compareLnkResultEntryRows(left: WeldRow, right: WeldRow, methodKey: WeldFieldKey | '') {
  const leftPriority = getLnkResultEntryPriority(left, methodKey)
  const rightPriority = getLnkResultEntryPriority(right, methodKey)
  if (leftPriority !== rightPriority) return leftPriority - rightPriority
  return compareLnkRequestRows(left, right)
}

function getLnkResultEntryPriority(row: WeldInput, methodKey: WeldFieldKey | '') {
  const method = getLnkMethodByRequestKey(methodKey)
  if (!hasRejectedLnkResult(row)) {
    if (method && hasText(row[method.requestKey]) && !isFinalLnkResultValue(row[method.resultKey])) return 0
    if (hasPendingLnkRequestResult(row)) return 0
  }

  const finalStatus = String(row.finalStatus ?? '').trim().toLowerCase()
  if (finalStatus === 'годен') return 1
  if (finalStatus === 'не годен') return 2
  return 3
}

function hasPendingLnkRequestResult(row: WeldInput) {
  return LNK_METHODS.some((method) => hasText(row[method.requestKey]) && !isFinalLnkResultValue(row[method.resultKey]) && !isLnkMethodNoNeed(row, method))
}

function hasRejectedLnkResult(row: WeldInput) {
  return LNK_METHODS.some((method) => {
    const result = String(row[method.resultKey] ?? '').trim().toLowerCase()
    return result === 'ремонт' || result === 'вырез'
  })
}

function filterPstoResultRows(rows: WeldRow[], search: string) {
  return filterPstoRows(rows, search).sort(compareHeatTreatmentReportRows)
}

function filterPstoRequestRows(rows: WeldRow[], search: string) {
  return sortPstoRequestRows(filterPstoRows(rows, search))
}

function filterPstoRows(rows: WeldRow[], search: string) {
  const query = normalizeSearchText(search)
  const compactQuery = compactSearchText(query)
  return rows.filter((row) => {
    if (!query) return true
    const values = [row.projectTitle, row.subtitleCode, row.line, row.spool, row.joint]
    const haystack = normalizeSearchText(values.map((value) => String(value ?? '')).join(' '))
    return haystack.includes(query) || compactSearchText(haystack).includes(compactQuery)
  })
}

function normalizeSearchText(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
}

function compactSearchText(value: string) {
  return value.replace(/[^\p{L}\p{N}]+/gu, '')
}

function formatLnkResultSummaryItems(row: WeldInput) {
  return LNK_METHODS.filter((method) => hasText(row[method.requestKey]) || isEnabledControlValue(row[method.enabledKey])).map((method) => {
    const hasRequest = hasText(row[method.requestKey])
    const result = isLnkMethodNoNeed(row, method)
      ? 'нет потребности'
      : String(row[method.resultKey] ?? '').trim() || (hasRequest ? 'ожидает НК' : 'ожидает заявку')
    return {
      method: method.code,
      result,
      inactive: isLnkMethodNoNeed(row, method),
    }
  })
}

function getLnkRequestMethodBadgeClass(row: WeldInput, method: (typeof LNK_METHODS)[number]) {
  if (isLnkMethodNoNeed(row, method)) {
    return getInactiveLnkRequestBadgeClass()
  }
  return getLnkResultBadgeClass(row[method.resultKey])
}

function getInactiveLnkRequestBadgeClass() {
  return 'border-slate-300 bg-slate-100 text-slate-600'
}

function getLnkResultBadgeClass(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  if (result === LNK_EMPTY_RESULT_VALUE) return 'border-slate-300 bg-slate-100 text-slate-700'
  if (result === 'годен') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (result === 'ремонт') return 'border-rose-200 bg-rose-50 text-rose-800'
  if (result === 'вырез') return 'border-red-300 bg-red-100 text-red-900'
  if (result === 'ожидает' || result === 'ожидает нк') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (result === 'нет потребности') return getInactiveLnkRequestBadgeClass()
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function getLnkDisplayValue(row: WeldInput, fieldKey: WeldFieldKey) {
  const method = getLnkMethodByResultKey(fieldKey)
  if (method && isLnkMethodNoNeed(row, method)) return 'нет потребности'
  return row[fieldKey]
}

function isLnkMethodNoNeed(row: WeldInput, method: (typeof LNK_METHODS)[number]) {
  if (!hasRejectedLnkResult(row)) return false
  if (isFinalLnkResultValue(row[method.resultKey])) return false
  return hasText(row[method.requestKey]) || isEnabledControlValue(row[method.enabledKey])
}

function getPstoResultBadgeClass(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  if (result === 'проведено') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return 'border-amber-200 bg-amber-50 text-amber-800'
}

function isLnkResultRowApplicable(row: WeldInput, requestName: string, methodKey: WeldFieldKey | '') {
  const method = methodKey ? getLnkMethodByRequestKey(methodKey) : null
  if (!method) return false
  const rowRequestName = String(row[method.requestKey] ?? '').trim()
  if (!rowRequestName) return false
  const name = requestName.trim()
  return !name || rowRequestName === name
}

function isFinalLnkResultValue(value: unknown) {
  return LNK_RESULT_OPTIONS.includes(String(value ?? '').trim().toLowerCase() as never)
}

function getLnkResultMethodsForRows(rows: WeldInput[], requestName: string) {
  const name = requestName.trim()
  return LNK_METHODS.filter((method) =>
    rows.some((row) => {
      const rowRequestName = String(row[method.requestKey] ?? '').trim()
      if (!rowRequestName) return false
      if (name && rowRequestName !== name) return false
      return isFinalLnkResultValue(row[method.resultKey])
    }),
  )
}

function rowBelongsToLnkRequest(row: WeldInput, requestName: string) {
  const name = requestName.trim()
  return Boolean(name && LNK_METHODS.some((method) => String(row[method.requestKey] ?? '').trim() === name))
}

function canSelectLnkResultRow(row: WeldInput, requestName: string, methodKey: WeldFieldKey | '') {
  if (methodKey) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method || !isLnkResultRowApplicable(row, requestName, methodKey)) return false
    if (isLnkMethodNoNeed(row, method)) return false
    return !isFinalLnkResultValue(row[method.resultKey])
  }
  if (requestName.trim()) return rowBelongsToLnkRequest(row, requestName)
  return getLnkRowRequestNames(row).length > 0
}

function getEffectiveLnkResultDraftValue(rowId: number, draft: LnkResultDraftState) {
  return draft.rowResults[rowId] || (draft.result === LNK_CUSTOM_RESULT_VALUE ? '' : draft.result)
}

function getManagedLnkResultChangeKey(rowId: number, methodKey: WeldFieldKey) {
  return `${rowId}:${methodKey}`
}

function buildLnkResultDraftById(rows: WeldRow[], draft: LnkResultDraftState) {
  return Object.fromEntries(rows.map((row) => [row.id, getEffectiveLnkResultDraftValue(row.id, draft)]))
}

function filterLnkResultDraftRowResults(rowResults: Record<number, string>, rowIds: ReadonlySet<number>) {
  return Object.fromEntries(Object.entries(rowResults).filter(([rowId]) => rowIds.has(Number(rowId))))
}

function isValidLnkResultDraftValue(value: string) {
  return value === LNK_EMPTY_RESULT_VALUE || LNK_RESULT_OPTIONS.includes(value as never)
}

function areLnkResultDraftRowsReady(rows: WeldRow[], draft: LnkResultDraftState) {
  return rows.length > 0 && rows.every((row) => isValidLnkResultDraftValue(getEffectiveLnkResultDraftValue(row.id, draft)))
}

function hasNonEmptyLnkResultDraftRows(rows: WeldRow[], draft: LnkResultDraftState) {
  return rows.some((row) => getEffectiveLnkResultDraftValue(row.id, draft) !== LNK_EMPTY_RESULT_VALUE)
}

function rowBelongsToPstoRequest(row: WeldInput, requestName: string) {
  const name = requestName.trim()
  return Boolean(name && String(row.pstoRequest ?? '').trim() === name)
}

function canSelectPstoResultRow(row: WeldInput, requestName: string) {
  if (requestName.trim()) return rowBelongsToPstoRequest(row, requestName)
  return hasText(row.pstoRequest)
}

function RequestNamingControls({
  naming,
  systemName,
  label,
  placeholder = 'Введите наименование заявки',
  disabled = false,
  onChange,
}: {
  naming: RequestNamingState
  systemName: string
  label: string
  placeholder?: string
  disabled?: boolean
  onChange: (value: RequestNamingState) => void
}) {
  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
        {(['system', 'custom'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChange({ ...naming, mode })}
            disabled={disabled}
            className={`h-8 rounded px-3 text-sm font-medium transition-colors ${
              naming.mode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {mode === 'system' ? 'Системное' : 'Пользовательское'}
          </button>
        ))}
      </div>

      <label className="block space-y-1.5 text-sm">
        <span className="text-[13px] font-medium leading-none text-slate-700">{label}</span>
        {naming.mode === 'system' ? (
          <Input value={systemName} readOnly disabled={disabled} className="bg-slate-50 text-slate-600" />
        ) : (
          <Input
            autoFocus
            value={naming.customName}
            onChange={(event) => onChange({ ...naming, customName: event.target.value })}
            placeholder={placeholder}
            disabled={disabled}
          />
        )}
      </label>
    </div>
  )
}

function filterLnkRequestRows(rows: WeldRow[], search: string) {
  const query = search.trim().toLowerCase()
  const sortedRows = sortLnkRequestRows(rows)
  if (!query) return sortedRows

  return sortedRows.filter((row) => {
    const values = [row.line, row.spool, row.joint]
    return values.some((value) => String(value ?? '').toLowerCase().includes(query))
  })
}

function sortLnkRequestRows(rows: WeldRow[]) {
  return [...rows].sort((left, right) => {
    const leftAvailable = canCreateLnkRequest(left)
    const rightAvailable = canCreateLnkRequest(right)
    if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1
    return compareLnkRequestRows(left, right)
  })
}

function sortPstoRequestRows(rows: WeldRow[]) {
  return [...rows].sort((left, right) => {
    const leftAvailable = canCreatePstoRequest(left)
    const rightAvailable = canCreatePstoRequest(right)
    if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1
    return compareHeatTreatmentReportRows(left, right)
  })
}

function compareHeatTreatmentReportRows(left: WeldRow, right: WeldRow) {
  const leftTime = parseReportTimestamp(left.pstoCreatedAt)
  const rightTime = parseReportTimestamp(right.pstoCreatedAt)
  if (leftTime !== rightTime) return rightTime - leftTime
  return compareReportRows(left, right)
}

function sortRowsByPreservedOrder(rows: WeldRow[], preservedIds: number[]) {
  const orderById = new Map(preservedIds.map((id, index) => [id, index]))
  return [...rows].sort((left, right) => {
    const leftOrder = orderById.get(left.id)
    const rightOrder = orderById.get(right.id)
    if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder
    if (leftOrder !== undefined) return -1
    if (rightOrder !== undefined) return 1
    return compareLnkReportRows(left, right)
  })
}

function compareLnkReportRows(left: WeldRow, right: WeldRow) {
  const leftTime = parseReportTimestamp(left.lnkCreatedAt)
  const rightTime = parseReportTimestamp(right.lnkCreatedAt)
  if (leftTime !== rightTime) return rightTime - leftTime
  return compareReportRows(left, right)
}

function compareLnkRequestRows(left: WeldRow, right: WeldRow) {
  return compareReportRows(left, right)
}

function compareReportRows(left: WeldRow, right: WeldRow) {
  const leftValue = [left.line, left.spool, left.joint].map((value) => String(value ?? '')).join(' ')
  const rightValue = [right.line, right.spool, right.joint].map((value) => String(value ?? '')).join(' ')
  return leftValue.localeCompare(rightValue, 'ru', { numeric: true })
}

function parseReportTimestamp(value: unknown) {
  const time = new Date(String(value ?? '')).getTime()
  return Number.isFinite(time) ? time : 0
}

function isEveryFilteredLnkRequestRowSelected(selectedIds: ReadonlySet<number>, rows: WeldRow[]) {
  return rows.length > 0 && rows.every((row) => selectedIds.has(row.id))
}

function countLnkRequestTargets(rows: WeldInput[], methodKeys: WeldFieldKey[]) {
  if (rows.length === 0 || methodKeys.length === 0) return 0
  return rows.reduce((total, row) => {
    return (
      total +
      methodKeys.filter((requestKey) => {
        const method = getLnkMethodByRequestKey(requestKey)
        return method && isEnabledControlValue(row[method.enabledKey]) && !hasText(row[method.requestKey])
      }).length
    )
  }, 0)
}

function isLnkResultField(fieldKey: WeldFieldKey) {
  return LNK_METHODS.some((method) => method.resultKey === fieldKey)
}

function isLnkRequestField(fieldKey: WeldFieldKey) {
  return lnkRequestFieldKeys.includes(fieldKey)
}

function getLnkMethodByRequestKey(fieldKey: WeldFieldKey) {
  return LNK_METHODS.find((method) => method.requestKey === fieldKey)
}

function getLnkMethodByResultKey(fieldKey: WeldFieldKey) {
  return LNK_METHODS.find((method) => method.resultKey === fieldKey)
}

function isLnkRequestAllowedForRow(row: WeldInput, fieldKey: WeldFieldKey) {
  const method = getLnkMethodByRequestKey(fieldKey)
  return !method || isEnabledControlValue(row[method.enabledKey])
}

function applyLnkFieldUpdate<T extends WeldInput>(record: T, fieldKey: WeldFieldKey, value: string | null): T {
  const nextRecord = { ...record, [fieldKey]: value } as T & Record<string, unknown>
  const requestMethod = getLnkMethodByRequestKey(fieldKey)
  if (requestMethod && !hasText(value)) {
    nextRecord[requestMethod.resultKey] = null
    nextRecord[requestMethod.conclusionDateKey] = null
    nextRecord[requestMethod.conclusionKey] = null
  }
  return nextRecord as T
}

function clearLnkGeneratedData<T extends WeldInput>(row: T): T {
  const nextRow = { ...row } as T & Record<string, unknown>
  for (const fieldKey of lnkGeneratedFieldKeys) {
    nextRow[fieldKey] = null
  }
  return nextRow as T
}

function hasLnkGeneratedDataChanged(left: WeldInput, right: WeldInput) {
  return [...lnkGeneratedFieldKeys].some((fieldKey) => !isSameImportValue(left[fieldKey], right[fieldKey]))
}

function clearDisabledLnkRequests<T extends WeldInput>(row: T): T {
  let nextRow: (T & Record<string, unknown>) | null = null
  for (const method of LNK_METHODS) {
    if (isEnabledControlValue(row[method.enabledKey]) || hasLnkMethodReportHistory(row, method) || !hasText(row[method.requestKey])) continue
    nextRow = nextRow ?? ({ ...row } as T & Record<string, unknown>)
    nextRow[method.requestKey] = null
  }
  return (nextRow ?? row) as T
}

function normalizeLnkResultValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return RESULT_STATUS_OPTIONS.includes(text as never) ? text : null
}

function isEnabledControlValue(value: unknown) {
  if (value === true) return true
  return String(value ?? '').trim().toLowerCase() === 'да'
}

function withAutoHeatTreatmentDiagram<T extends WeldInput & { id: number }>(record: T, rows: Array<WeldInput & { id: number }>) {
  if (getPstoResultValue(record.pstoResult) !== 'проведено') {
    return { ...record, heatTreatmentDiagram: null }
  }

  const date = formatPstoDiagramDate(record.pstoDate)
  if (!date) return record

  const prefix = `ПСТО-Д-${date}-`
  const currentDiagram = String(record.heatTreatmentDiagram ?? '').trim()
  if (currentDiagram) return record
  const diagramPattern = new RegExp(`^${escapeRegExp(prefix)}(\\d{3})$`)

  const maxNumber = rows
    .filter((row) => row.id !== record.id)
    .map((row) => String(row.heatTreatmentDiagram ?? '').trim().match(diagramPattern)?.[1])
    .reduce((max, value) => (value ? Math.max(max, Number(value)) : max), 0)
  const nextNumber = maxNumber + 1

  return { ...record, heatTreatmentDiagram: `${prefix}${String(nextNumber).padStart(3, '0')}` }
}

function formatPstoDiagramDate(value: unknown) {
  const text = String(value ?? '').trim()
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1].slice(2)}`
  const shortMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{2})$/)
  if (shortMatch) return text
  const longMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (longMatch) return `${longMatch[1]}.${longMatch[2]}.${longMatch[3].slice(2)}`
  return null
}

function formatDateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatShortDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${pad(date.getFullYear() % 100)}`
}

function formatLongDate(date: Date) {
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(validDate.getDate())}.${pad(validDate.getMonth() + 1)}.${validDate.getFullYear()}`
}

function parseLongDateValue(value: string) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return match ? Number(`${match[3]}${match[2]}${match[1]}`) : 0
}

function formatPstoDiagramLongDate(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`
  const longMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (longMatch) return text
  const shortMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{2})$/)
  if (shortMatch) return `${shortMatch[1]}.${shortMatch[2]}.20${shortMatch[3]}`
  return null
}

function formatPstoDiagramShortDateFromLong(value: string) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return match ? `${match[1]}.${match[2]}.${match[3].slice(2)}` : formatShortDate(new Date())
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getJointTitle(value: WeldInput) {
  const project = String(value.projectTitle ?? '').trim()
  const subtitle = String(value.subtitleCode ?? '').trim()
  const line = String(value.line ?? '').trim()
  const joint = String(value.joint ?? '').trim()

  if (!project && !subtitle && !line && !joint) return 'Проект, шифр, линия и стык не заполнены.'
  return `${project || '-'} · ${subtitle || '-'} · ${line || '-'} · ${joint || '-'}`
}

function expandHighlightFieldKeys(fieldKeys: WeldFieldKey[]) {
  const expanded = new Set<WeldFieldKey>(fieldKeys)
  if (expanded.has('weldDate')) {
    expanded.add('hasVik')
  }
  if (
    expanded.has('pstoRequired') ||
    expanded.has('pstoRequest') ||
    expanded.has('pstoDate') ||
    expanded.has('pstoResult') ||
    expanded.has('heatTreatmentDiagram')
  ) {
    expanded.add('pstoCreatedAt')
  }
  if (
    LNK_METHODS.some(
      (method) =>
        expanded.has(method.enabledKey) ||
        expanded.has(method.requestKey) ||
        expanded.has(method.resultKey) ||
        expanded.has(method.conclusionDateKey) ||
        expanded.has(method.conclusionKey),
    )
  ) {
    expanded.add('lnkCreatedAt')
    expanded.add('finalStatus')
  }
  return [...expanded]
}

function getCellKey(rowId: number, fieldKey: WeldFieldKey) {
  return `${rowId}:${fieldKey}`
}

function canCreatePstoRequest(row: WeldInput) {
  return !hasText(row.pstoRequest)
}

function normalizePstoRequest(value: unknown) {
  const text = String(value ?? '').trim()
  return text || null
}

function normalizeRowPstoRequest<T extends WeldInput>(row: T) {
  const pstoRequest = normalizePstoRequest(row.pstoRequest)
  return row.pstoRequest === pstoRequest ? row : { ...row, pstoRequest }
}

function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}

function getPstoResultValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return PSTO_RESULT_STATUS_OPTIONS.includes(text as never) ? text : ''
}

function isYesText(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'да'
}

function readLocalWelds() {
  if (typeof window === 'undefined') return seedRows

  const stored = window.localStorage.getItem(localStorageKey)
  if (!stored) {
    const initializedRows = withCreatedAt(seedRows.map((row) => clearLnkResultAndConclusionFields(clearLnkRequestsFromRow(row))))
    window.localStorage.setItem(clearedLnkRequestsStorageKey, '1')
    window.localStorage.setItem(clearedLnkResultsAndConclusionsStorageKey, '1')
    writeLocalWelds(initializedRows)
    return initializedRows
  }

  try {
    const parsed = JSON.parse(stored) as Array<WeldInput & { id: number }>
    const shouldClearLegacyLnkRequests = window.localStorage.getItem(clearedLnkRequestsStorageKey) !== '1'
    const shouldClearLnkResultsAndConclusions = window.localStorage.getItem(clearedLnkResultsAndConclusionsStorageKey) !== '1'
    const normalizedRows = parsed.map((row) => {
      const withoutNoPsto = String(row.pstoRequired ?? '').toLowerCase() === 'нет' ? { ...row, pstoRequired: null } : row
      const withoutLegacyLnkRequest = clearLegacyLnkRequestField(withoutNoPsto)
      const withClearedLnkRequests = shouldClearLegacyLnkRequests
        ? clearLnkRequestsFromRow(withoutLegacyLnkRequest)
        : withoutLegacyLnkRequest
      const withValidLnkRequests = clearDisabledLnkRequests(withClearedLnkRequests)
      const withClearedLnkResultsAndConclusions = shouldClearLnkResultsAndConclusions
        ? clearLnkResultAndConclusionFields(withValidLnkRequests)
        : withValidLnkRequests
      const withPendingLnk = withPendingLnkResults(withClearedLnkResultsAndConclusions)
      const withActualPstoRequest =
        withPendingLnk.pstoRequest === normalizePstoRequest(withPendingLnk.pstoRequest)
          ? withPendingLnk
          : { ...withPendingLnk, pstoRequest: normalizePstoRequest(withPendingLnk.pstoRequest) }
      const withTimestamp = withActualPstoRequest.createdAt
        ? withActualPstoRequest
        : { ...withActualPstoRequest, createdAt: new Date().toISOString() }
      return { ...withTimestamp, finalStatus: calculateFinalStatus(withTimestamp) }
    })
    const meaningfulRows = withAutoHeatTreatmentDiagrams(
      withLnkCreatedAt(withPstoCreatedAt(normalizedRows.filter((row) => isMeaningfulRecord(row)))),
    )
    if (meaningfulRows.length !== parsed.length || meaningfulRows.some((row, index) => row !== parsed[index])) {
      writeLocalWelds(meaningfulRows)
    }
    if (shouldClearLegacyLnkRequests) {
      window.localStorage.setItem(clearedLnkRequestsStorageKey, '1')
    }
    if (shouldClearLnkResultsAndConclusions) {
      window.localStorage.setItem(clearedLnkResultsAndConclusionsStorageKey, '1')
    }
    return meaningfulRows
  } catch {
    const initializedRows = seedRows.map((row) => clearLnkResultAndConclusionFields(clearLnkRequestsFromRow(row)))
    window.localStorage.setItem(clearedLnkRequestsStorageKey, '1')
    window.localStorage.setItem(clearedLnkResultsAndConclusionsStorageKey, '1')
    writeLocalWelds(initializedRows)
    return initializedRows
  }
}

function clearLegacyLnkRequestField<T extends WeldInput>(row: T): T {
  if (!('lnkRequest' in (row as Record<string, unknown>))) return row
  const nextRow = { ...row } as WeldInput & Record<string, unknown>
  delete nextRow.lnkRequest
  return nextRow as T
}

function clearLnkRequestsFromRow<T extends WeldInput>(row: T): T {
  const hasLnkRequest = lnkRequestFieldKeys.some((fieldKey) => hasText(row[fieldKey]))
  const hasLegacyRequest = 'lnkRequest' in (row as Record<string, unknown>)
  if (!hasLnkRequest && !hasLegacyRequest) return row

  const nextRow = { ...row } as WeldInput & Record<string, unknown>
  delete nextRow.lnkRequest
  for (const fieldKey of lnkRequestFieldKeys) {
    nextRow[fieldKey] = null
  }
  return nextRow as T
}

function clearLnkResultAndConclusionFields<T extends WeldInput>(row: T): T {
  const lnkResultFieldKeys = LNK_METHODS.map((method) => method.resultKey)
  const shouldClear = [...lnkResultFieldKeys, ...lnkConclusionFieldKeys].some((fieldKey) => hasText(row[fieldKey]))
  if (!shouldClear) return row

  const nextRow = { ...row } as T & Record<string, unknown>
  for (const fieldKey of lnkResultFieldKeys) {
    nextRow[fieldKey] = null
  }
  for (const fieldKey of lnkConclusionFieldKeys) {
    nextRow[fieldKey] = null
  }
  return nextRow as T
}

function withCreatedAt(rows: Array<WeldInput & { id: number }>) {
  const createdAt = new Date().toISOString()
  return rows.map((row) => (row.createdAt ? row : { ...row, createdAt }))
}

function withPstoCreatedAt<T extends WeldInput>(rows: T[]) {
  const pstoCreatedAt = new Date().toISOString()
  return rows.map((row) => (isYesText(row.pstoRequired) && !row.pstoCreatedAt ? { ...row, pstoCreatedAt } : row))
}

function withLnkCreatedAt<T extends WeldInput>(rows: T[]) {
  const lnkCreatedAt = new Date().toISOString()
  return rows.map((row) => (hasAnyLnkGeneratedData(row) && !row.lnkCreatedAt ? { ...row, lnkCreatedAt } : row))
}

function withTouchedLnkTimestamp<T extends WeldInput>(row: T): T {
  return { ...row, lnkCreatedAt: new Date().toISOString() }
}

function withAutoHeatTreatmentDiagrams<T extends WeldInput & { id: number }>(rows: T[]) {
  const nextRows = [...rows]
  for (let index = 0; index < nextRows.length; index += 1) {
    nextRows[index] = withAutoHeatTreatmentDiagram(nextRows[index], nextRows) as T
  }
  return nextRows
}

function writeLocalWelds(rows: Array<WeldInput & { id: number }>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(localStorageKey, JSON.stringify(rows))
}

function clearLocalLnkGeneratedData() {
  const rows = readLocalWelds()
  const cleanedRows = rows.map((row) => {
    const cleanedRow = clearLnkGeneratedData(row)
    return { ...cleanedRow, finalStatus: calculateFinalStatus(cleanedRow) }
  })
  writeLocalWelds(cleanedRows)
  return cleanedRows.filter((row, index) => hasLnkGeneratedDataChanged(rows[index], row))
}

function saveLocalWeld(value: WeldInput & { id?: number }) {
  const rows = readLocalWelds()
  const normalized = normalizeWeldInput(value)
  const normalizedWithActualPstoRequest = clearDisabledLnkRequests({
    ...normalized,
    pstoRequest: normalizePstoRequest(normalized.pstoRequest),
  })

  if (!isMeaningfulRecord(normalizedWithActualPstoRequest)) {
    throw new Error('Заполните хотя бы Стык, Линию или Изометрию')
  }

	if (value.id) {
	  const updated = withAutoHeatTreatmentDiagrams(
	    rows.map((row) =>
	      row.id === value.id ? withLnkCreatedAt(withPstoCreatedAt([{ ...row, ...normalizedWithActualPstoRequest, id: value.id }]))[0] : row,
	    ),
	  )
    writeLocalWelds(updated)
    return updated.find((row) => row.id === value.id)!
  }

	const nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
	const created = withLnkCreatedAt(withPstoCreatedAt([{ id: nextId, ...normalizedWithActualPstoRequest, createdAt: new Date().toISOString() }]))[0]
  const nextRows = withAutoHeatTreatmentDiagrams([created, ...rows])
  writeLocalWelds(nextRows)
  return nextRows[0]
}

function deleteLocalWeld(id: number) {
  writeLocalWelds(readLocalWelds().filter((row) => row.id !== id))
}

function updateLocalWelds(updatedRows: Array<WeldInput & { id: number }>) {
  const updatedById = new Map(
    updatedRows.map((row) => [
      row.id,
      withLnkCreatedAt(withPstoCreatedAt([withPendingLnkResults(clearDisabledLnkRequests({ ...row, pstoRequest: normalizePstoRequest(row.pstoRequest) }))]))[0],
    ]),
  )
  const rows = withAutoHeatTreatmentDiagrams(readLocalWelds().map((row) => updatedById.get(row.id) ?? row))
  writeLocalWelds(rows)
}

function importLocalWelds(records: WeldInput[]) {
  const existingRows = readLocalWelds()
  let nextId = existingRows.reduce((max, row) => Math.max(max, row.id), 0) + 1
  const importedAt = new Date().toISOString()
  const importedRows = records.map((record) => {
    const normalized = normalizeWeldInput(record)
    return withLnkCreatedAt(withPstoCreatedAt([
      withPendingLnkResults(
        clearDisabledLnkRequests({ id: nextId++, ...normalized, pstoRequest: normalizePstoRequest(normalized.pstoRequest), createdAt: importedAt }),
      ),
    ]))[0]
  })
  const nextRows = withAutoHeatTreatmentDiagrams([...importedRows, ...existingRows])
  writeLocalWelds(nextRows)
  return nextRows.slice(0, importedRows.length)
}
