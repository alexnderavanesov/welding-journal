import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ClipboardCheck, FileSpreadsheet, Flame, NotebookTabs, PanelLeftClose, PanelLeftOpen, Plus, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { WeldForm } from '@/components/weld-form'
import { WeldTable } from '@/components/weld-table'
import seedWelds from '@/data/seed-welds.json'
import {
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
const collapsedSectionsStoragePrefix = 'welding-tracker-collapsed-sections'
const heatTreatmentEditableFieldKeys = new Set<WeldFieldKey>([
  'pstoRequest',
  'pstoDate',
  'pstoResult',
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
])
const heatTreatmentImportMatchFieldKeys = new Set<WeldFieldKey>(['line', 'joint'])
const LNK_METHODS = [
  { code: 'ВИК', enabledKey: 'hasVik', requestKey: 'vikRequest', resultKey: 'vikResult', conclusionKey: 'vikConclusion' },
  { code: 'РК', enabledKey: 'hasRk', requestKey: 'rkRequest', resultKey: 'rkResult', conclusionKey: 'rkConclusion' },
  { code: 'ПВК', enabledKey: 'hasPvk', requestKey: 'pvkRequest', resultKey: 'pvkResult', conclusionKey: 'pvkConclusion' },
  { code: 'УЗК', enabledKey: 'hasUzk', requestKey: 'uzkRequest', resultKey: 'uzkResult', conclusionKey: 'uzkConclusion' },
  { code: 'ТВМТ', enabledKey: 'hasTvmt', requestKey: 'tvmtRequest', resultKey: 'tvmtResult', conclusionKey: 'tvmtConclusion' },
  { code: 'РФА', enabledKey: 'hasRfa', requestKey: 'rfaRequest', resultKey: 'rfaResult', conclusionKey: 'rfaConclusion' },
  { code: 'СТЛС', enabledKey: 'hasStls', requestKey: 'stlsRequest', resultKey: 'stlsResult', conclusionKey: 'stlsConclusion' },
  { code: 'МКК', enabledKey: 'hasMkk', requestKey: 'mkkRequest', resultKey: 'mkkResult', conclusionKey: 'mkkConclusion' },
] as const satisfies ReadonlyArray<{
  code: string
  enabledKey: WeldFieldKey
  requestKey: WeldFieldKey
  resultKey: WeldFieldKey
  conclusionKey: WeldFieldKey
}>
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
  'vikConclusion',
  'rkConclusion',
  'pvkConclusion',
  'uzkConclusion',
  'tvmtConclusion',
  'rfaConclusion',
  'stlsConclusion',
  'mkkConclusion',
  'lnkDefectDescription',
  'lnkNote',
])
const lnkEditableReportFieldKeys = new Set<WeldFieldKey>([
  ...[...lnkReportFieldKeys].filter((fieldKey) => fieldKey !== 'lnkCreatedAt'),
  ...lnkConclusionFieldKeys,
])
const lnkRequestFieldKeys = LNK_METHODS.map((method) => method.requestKey)
const lnkEditableFieldKeys = new Set<WeldFieldKey>([
  ...LNK_METHODS.flatMap((method) => [method.requestKey, method.resultKey]),
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
type PstoRequestEditingState = {
  record: WeldInput & { id: number }
  value: string
}
type PstoResultEditingState = {
  record: WeldInput & { id: number }
  value: string
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
type ActiveReport = 'weldingJournal' | 'heatTreatment' | 'lnk'
type WeldRow = WeldInput & { id: number }

function Home() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const importHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousReportRef = useRef<ActiveReport>('weldingJournal')
  const [activeReport, setActiveReport] = useState<ActiveReport>('weldingJournal')
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [heatTreatmentFilters, setHeatTreatmentFilters] = useState<Record<string, string>>({})
  const [lnkFilters, setLnkFilters] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [pstoRequestEditing, setPstoRequestEditing] = useState<PstoRequestEditingState | null>(null)
  const [pstoResultEditing, setPstoResultEditing] = useState<PstoResultEditingState | null>(null)
  const [heatTreatmentFieldEditing, setHeatTreatmentFieldEditing] = useState<HeatTreatmentFieldEditingState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [highlightedRowIds, setHighlightedRowIds] = useState<Set<number>>(new Set())
  const [highlightedCellKeys, setHighlightedCellKeys] = useState<Set<string>>(new Set())
  const [selectedHeatTreatmentIds, setSelectedHeatTreatmentIds] = useState<Set<number>>(new Set())
  const [selectedLnkIds, setSelectedLnkIds] = useState<Set<number>>(new Set())
  const [lnkRequestDraft, setLnkRequestDraft] = useState<LnkRequestDraftState>(() => ({ methods: new Set() }))
  const [isLnkRequestModalOpen, setIsLnkRequestModalOpen] = useState(false)
  const [lnkRequestSearch, setLnkRequestSearch] = useState('')

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
    }

    if (activeReport !== 'heatTreatment') {
      setSelectedHeatTreatmentIds(new Set())
      setPstoRequestEditing(null)
      setPstoResultEditing(null)
      setHeatTreatmentFieldEditing(null)
    }
    if (activeReport !== 'lnk') {
      setSelectedLnkIds(new Set())
      setLnkRequestDraft({ methods: new Set() })
      setIsLnkRequestModalOpen(false)
      setLnkRequestSearch('')
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
      highlightChangedRows(saved ? [saved] : [], variables.id && editing?.focusField ? [editing.focusField] : [])
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
          return { ...cleanedRow, finalStatus: calculateFinalStatus(cleanedRow) }
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
      highlightChangedRows(result.rows, result.changedFieldKeys)
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
      const updatedRecords = records.map((record) => ({ ...record, pstoRequest: requestName }))
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
      highlightChangedRows(variables.records, ['pstoRequest'])
      setMessage(
        variables.mode === 'edit'
          ? 'Заявка ПСТО обновлена'
          : `Заявка ${variables.requestName} создана для стыков: ${variables.records.length}`,
      )
      setSelectedHeatTreatmentIds(new Set())
      setPstoRequestEditing(null)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const pstoResultMutation = useMutation({
    mutationFn: async ({
      record,
      value,
      rows,
    }: {
      record: WeldInput & { id: number }
      value: string | null
      rows: Array<WeldInput & { id: number }>
    }) => {
      if (value === 'проведено' && !hasText(record.pstoRequest)) {
        throw new Error('Сначала укажите заявку ПСТО')
      }

      const updatedRecord = withAutoHeatTreatmentDiagram({ ...record, pstoResult: value }, rows)
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
    onSuccess: async (saved) => {
      highlightChangedRows(saved ? [saved] : [], ['pstoResult'])
      setMessage('Результат ПСТО обновлен')
      setPstoResultEditing(null)
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
          if (hasText(record[method.requestKey])) continue
          nextRecord[requestKey] = requestName
          changed = true
        }
        return changed ? [nextRecord] : []
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
      highlightChangedRows(savedRows, variables.methodKeys)
      setMessage(`Заявка ${variables.requestName} создана для стыков: ${savedRows.length}`)
      setSelectedLnkIds(new Set())
      setLnkRequestDraft({ methods: new Set() })
      setIsLnkRequestModalOpen(false)
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

      const proposedRecord = clearDisabledLnkRequests({ ...record, [fieldKey]: value })
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
      highlightChangedRows(saved ? [saved] : [], [variables.fieldKey, 'finalStatus'])
      setMessage('Поле ЛНК обновлено')
      setHeatTreatmentFieldEditing(null)
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
        const withTimestamps = withLnkCreatedAt(withPstoCreatedAt([normalizedRow]))[0]
        const withCancellationState = toControlCancellationReportRow(withTimestamps)
        return { ...withCancellationState, finalStatus: calculateFinalStatus(withCancellationState) }
      }),
    [weldsQuery.data],
  )

  const heatTreatmentRows = useMemo(
    () => rows.filter(hasHeatTreatmentReportState).map(toHeatTreatmentReportRow),
    [rows],
  )
  const lnkRows = useMemo(() => rows.filter(hasAnyLnkReportControl).map(toLnkReportRow), [rows])
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
    () => heatTreatmentRows.filter((row) => selectedHeatTreatmentIds.has(row.id) && canCreatePstoRequest(row)),
    [heatTreatmentRows, selectedHeatTreatmentIds],
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
  const nextLnkRequestName = useMemo(() => formatLnkRequestName(rows), [rows])
  const pstoRequestOptions = useMemo(() => collectRequestNames(rows, ['pstoRequest']), [rows])
  const lnkRequestOptions = useMemo(() => collectRequestNames(rows, lnkRequestFieldKeys), [rows])
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
      const selectableIds = new Set(heatTreatmentRows.filter(canCreatePstoRequest).map((row) => row.id))
      const next = new Set([...current].filter((id) => selectableIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [heatTreatmentRows])

  useEffect(() => {
    setSelectedLnkIds((current) => {
      const ids = new Set(availableLnkRequestRows.map((row) => row.id))
      const next = new Set([...current].filter((id) => ids.has(id)))
      return next.size === current.size ? current : next
    })
  }, [availableLnkRequestRows])

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

  function handleCreatePstoRequest() {
    if (selectedHeatTreatmentRows.length === 0) {
      setMessage('Выберите один или несколько стыков для заявки ПСТО')
      return
    }

    const requestName = formatPstoRequestName(heatTreatmentRows)
    pstoRequestMutation.mutate({ records: selectedHeatTreatmentRows, requestName, mode: 'create' })
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

    lnkRequestMutation.mutate({ records: selectedLnkRows, methodKeys, requestName: nextLnkRequestName })
  }

  function openCreateLnkRequestModal() {
    setSelectedLnkIds(new Set())
    setLnkRequestDraft({ methods: new Set() })
    setLnkRequestSearch('')
    setIsLnkRequestModalOpen(true)
  }

  function closeCreateLnkRequestModal() {
    if (lnkRequestMutation.isPending) return
    setIsLnkRequestModalOpen(false)
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
      if (focusField === 'pstoRequest') {
        setPstoRequestEditing({ record, value: String(record.pstoRequest ?? '') })
      } else if (focusField === 'pstoResult') {
        setPstoResultEditing({ record, value: getPstoResultValue(record.pstoResult) })
      } else if (focusField && heatTreatmentEditableFieldKeys.has(focusField)) {
        const field = FIELD_BY_KEY.get(focusField)
        const fieldValue =
          focusField === 'pstoDate' && !hasText(record[focusField])
            ? formatDateInputValue(new Date())
            : String(record[focusField] ?? '')
        setHeatTreatmentFieldEditing({
          record,
          fieldKey: focusField,
          label: field?.label ?? 'Поле ПСТО',
          kind: field?.kind === 'date' ? 'date' : 'text',
          value: fieldValue,
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
          kind: 'text',
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

  function saveEditedPstoRequest() {
    if (!pstoRequestEditing) return
    const value = pstoRequestEditing.value.trim()
    if (value && !pstoRequestOptions.includes(value)) {
      setMessage('Можно выбрать только существующую заявку ПСТО или очистить поле')
      return
    }
    pstoRequestMutation.mutate({
      records: [pstoRequestEditing.record],
      requestName: value,
      mode: 'edit',
    })
  }

  function saveEditedPstoResult() {
    if (!pstoResultEditing) return
    const value = getPstoResultValue(pstoResultEditing.value) || null
    if (value === 'проведено' && !hasText(pstoResultEditing.record.pstoRequest)) {
      setMessage('Сначала укажите заявку ПСТО')
      setPstoResultEditing(null)
      return
    }

    pstoResultMutation.mutate({
      record: pstoResultEditing.record,
      value,
      rows,
    })
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
    const ids = new Set(
      (rows ?? [])
        .map((row) => row.id)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
    )
    if (ids.size === 0) return

    const cellKeys = new Set<string>()
    for (const id of ids) {
      for (const fieldKey of cellFieldKeys) {
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
    }, 10000)
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
            className="sticky z-20 flex w-full items-start gap-4 bg-white pb-1"
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
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={importMutation.isPending || heatTreatmentImportMutation.isPending || lnkImportMutation.isPending}
              >
                <Upload className="mr-2 h-4 w-4" />
                Импорт
              </Button>
              <Button variant="outline" onClick={exportXlsx}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Excel
              </Button>
              {activeReport === 'heatTreatment' ? (
                <Button onClick={handleCreatePstoRequest} disabled={pstoRequestMutation.isPending}>
                  <Plus className="mr-2 h-4 w-4" />
                  Создать заявку ПСТО
                </Button>
              ) : null}
              {activeReport === 'lnk' ? (
                <Button onClick={openCreateLnkRequestModal} disabled={lnkRequestMutation.isPending}>
                  <Plus className="mr-2 h-4 w-4" />
                  Создать заявку ЛНК
                </Button>
              ) : null}
              {activeReport === 'weldingJournal' ? (
                <Button onClick={() => setEditing({ record: {} })}>
                  <Plus className="mr-2 h-4 w-4" />
                  Новый стык
                </Button>
              ) : null}
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
            selectable={activeReport === 'heatTreatment'}
            selectedRowIds={selectedHeatTreatmentIds}
            onSelectedRowIdsChange={setSelectedHeatTreatmentIds}
            isRowSelectable={activeReport === 'heatTreatment' ? canCreatePstoRequest : () => true}
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

      {pstoRequestEditing ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="w-full max-w-xl rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
            <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Заявка ПСТО</h2>
                <p className="text-sm text-muted-foreground">{getJointTitle(pstoRequestEditing.record)}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setPstoRequestEditing(null)} aria-label="Закрыть">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2 px-5 py-5">
              <label className="space-y-1.5 text-sm">
                <span className="text-[13px] font-medium leading-none text-slate-700">Заявка ПСТО</span>
                <Select
                  autoFocus
                  value={pstoRequestEditing.value}
                  onChange={(event) =>
                    setPstoRequestEditing((current) =>
                      current ? { ...current, value: event.target.value } : current,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setPstoRequestEditing(null)
                    if (event.key === 'Enter') saveEditedPstoRequest()
                  }}
                >
                  <option value="">пусто</option>
                  {withCurrentOption(pstoRequestOptions, pstoRequestEditing.value).map((requestName) => (
                    <option key={requestName} value={requestName}>
                      {requestName}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
              <Button variant="outline" onClick={() => setPstoRequestEditing(null)}>
                Отмена
              </Button>
              <Button onClick={saveEditedPstoRequest} disabled={pstoRequestMutation.isPending}>
                <Check className="mr-2 h-4 w-4" />
                Сохранить
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {pstoResultEditing ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="w-full max-w-xl rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
            <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Результат ПСТО</h2>
                <p className="text-sm text-muted-foreground">{getJointTitle(pstoResultEditing.record)}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setPstoResultEditing(null)} aria-label="Закрыть">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2 px-5 py-5">
              <label className="space-y-1.5 text-sm">
                <span className="text-[13px] font-medium leading-none text-slate-700">Результат ПСТО</span>
                <Select
                  autoFocus
                  value={pstoResultEditing.value}
                  onChange={(event) =>
                    setPstoResultEditing((current) =>
                      current ? { ...current, value: event.target.value } : current,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setPstoResultEditing(null)
                    if (event.key === 'Enter') saveEditedPstoResult()
                  }}
                >
                  <option value="">пусто</option>
                  {PSTO_RESULT_STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option} disabled={!hasText(pstoResultEditing.record.pstoRequest)}>
                      {option}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
              <Button variant="outline" onClick={() => setPstoResultEditing(null)}>
                Отмена
              </Button>
              <Button onClick={saveEditedPstoResult} disabled={pstoResultMutation.isPending}>
                <Check className="mr-2 h-4 w-4" />
                Сохранить
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isLnkRequestModalOpen ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="flex max-h-[86vh] w-full max-w-6xl flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
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

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-5 py-5 lg:grid-cols-[280px_minmax(0,1fr)]">
              <section className="space-y-3">
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
                          ? 'border-slate-800 bg-slate-900 text-white'
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
                  <Button variant="outline" size="sm" onClick={toggleAllLnkRequestRows}>
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
                  {filteredLnkRequestRows.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">
                      {lnkRows.length === 0 ? 'Нет стыков для отчета ЛНК.' : 'По фильтру ничего не найдено.'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredLnkRequestRows.map((row) => {
                        const availableMethods = getAvailableLnkRequestMethods(row)
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
                                availableMethods.map((method) => (
                                  <span
                                    key={method.requestKey}
                                    className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600"
                                  >
                                    {method.code}
                                  </span>
                                ))
                              ) : (
                                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
                                  Все заявки уже созданы
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

      {heatTreatmentFieldEditing ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
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
  if (isLnkResultField(fieldKey)) return normalizeLnkResultValue(value)
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
  const date = formatShortDate(new Date())
  const prefix = `ЛНК-${date}-`
  const requestNames = [
    ...new Set(
      rows
        .flatMap((row) => LNK_METHODS.map((method) => String(row[method.requestKey] ?? '').trim()))
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

function hasAnyLnkControl(row: WeldInput) {
  return LNK_METHODS.some((method) => isEnabledControlValue(row[method.enabledKey]))
}

function hasAnyLnkReportControl(row: WeldInput) {
  return LNK_METHODS.some((method) => isEnabledControlValue(row[method.enabledKey]) || isCancelledLnkControl(row, method))
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
  return LNK_METHODS.some((method) => isEnabledControlValue(row[method.enabledKey]) && !hasText(row[method.requestKey]))
}

function getAvailableLnkRequestMethods(row: WeldInput) {
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

function compareLnkRequestRows(left: WeldRow, right: WeldRow) {
  const leftValue = [left.line, left.spool, left.joint].map((value) => String(value ?? '')).join(' ')
  const rightValue = [right.line, right.spool, right.joint].map((value) => String(value ?? '')).join(' ')
  return leftValue.localeCompare(rightValue, 'ru', { numeric: true })
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
  const diagramPattern = new RegExp(`^${escapeRegExp(prefix)}(\\d{3})$`)
  if (diagramPattern.test(currentDiagram)) return record

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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getJointTitle(value: WeldInput) {
  const line = String(value.line ?? '').trim()
  const joint = String(value.joint ?? '').trim()

  if (!line && !joint) return 'Линия и номер стыка не заполнены.'
  return `Линия: ${line || '-'} · Стык: ${joint || '-'}`
}

function getCellKey(rowId: number, fieldKey: WeldFieldKey) {
  return `${rowId}:${fieldKey}`
}

function canCreatePstoRequest(row: WeldInput) {
  return !hasText(row.pstoRequest)
}

function normalizePstoRequest(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return null
  return /^ПСТО-\d{2}\.\d{2}\.\d{2}-/.test(text) ? text : null
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
    const initializedRows = withCreatedAt(seedRows.map(clearLnkRequestsFromRow))
    window.localStorage.setItem(clearedLnkRequestsStorageKey, '1')
    writeLocalWelds(initializedRows)
    return initializedRows
  }

  try {
    const parsed = JSON.parse(stored) as Array<WeldInput & { id: number }>
    const shouldClearLegacyLnkRequests = window.localStorage.getItem(clearedLnkRequestsStorageKey) !== '1'
    const normalizedRows = parsed.map((row) => {
      const withoutNoPsto = String(row.pstoRequired ?? '').toLowerCase() === 'нет' ? { ...row, pstoRequired: null } : row
      const withoutLegacyLnkRequest = clearLegacyLnkRequestField(withoutNoPsto)
      const withClearedLnkRequests = shouldClearLegacyLnkRequests
        ? clearLnkRequestsFromRow(withoutLegacyLnkRequest)
        : withoutLegacyLnkRequest
      const withValidLnkRequests = clearDisabledLnkRequests(withClearedLnkRequests)
      const withActualPstoRequest =
        withValidLnkRequests.pstoRequest === normalizePstoRequest(withValidLnkRequests.pstoRequest)
          ? withValidLnkRequests
          : { ...withValidLnkRequests, pstoRequest: normalizePstoRequest(withValidLnkRequests.pstoRequest) }
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
    return meaningfulRows
  } catch {
    const initializedRows = seedRows.map(clearLnkRequestsFromRow)
    window.localStorage.setItem(clearedLnkRequestsStorageKey, '1')
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
  return rows.map((row) => (hasAnyLnkControl(row) && !row.lnkCreatedAt ? { ...row, lnkCreatedAt } : row))
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
      withLnkCreatedAt(withPstoCreatedAt([clearDisabledLnkRequests({ ...row, pstoRequest: normalizePstoRequest(row.pstoRequest) })]))[0],
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
      clearDisabledLnkRequests({ id: nextId++, ...normalized, pstoRequest: normalizePstoRequest(normalized.pstoRequest), createdAt: importedAt }),
    ]))[0]
  })
  const nextRows = withAutoHeatTreatmentDiagrams([...importedRows, ...existingRows])
  writeLocalWelds(nextRows)
  return nextRows.slice(0, importedRows.length)
}
