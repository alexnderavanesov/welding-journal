import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileSpreadsheet, Flame, NotebookTabs, PanelLeftClose, PanelLeftOpen, Plus, Upload, X } from 'lucide-react'
import * as XLSX from 'xlsx'
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
  buildExportWorkbook,
  isMeaningfulRecord,
  normalizeWeldInput,
  parseCsv,
  parseWorkbook,
} from '@/lib/weld-import-export'
import { getWeldTableWidth } from '@/lib/weld-column-widths'
import {
  FIELD_BY_KEY,
  PSTO_RESULT_STATUS_OPTIONS,
  VISIBLE_FIELDS,
  calculateFinalStatus,
  type WeldFieldKey,
  type WeldInput,
} from '@/lib/weld-fields'

export const Route = createFileRoute('/')({
  component: Home,
})

const emptyFilters: WeldFilters = {}
const seedRows = seedWelds as Array<WeldInput & { id: number }>
const localStorageKey = 'welding-tracker-local-welds'
const heatTreatmentEditableFieldKeys = new Set<WeldFieldKey>([
  'pstoRequest',
  'pstoDate',
  'pstoResult',
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
])
const weldingJournalBlockedFieldKeys = new Set<WeldFieldKey>(['pstoRequest', 'pstoResult', 'createdAt', 'finalStatus'])
const weldingJournalHiddenFieldKeys = new Set<WeldFieldKey>([
  'pstoDate',
  'heatTreatmentDiagram',
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
  'pstoCreatedAt',
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
}
type ActiveReport = 'weldingJournal' | 'heatTreatment'
type WeldRow = WeldInput & { id: number }

function Home() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const importHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activeReport, setActiveReport] = useState<ActiveReport>('weldingJournal')
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [heatTreatmentFilters, setHeatTreatmentFilters] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [pstoRequestEditing, setPstoRequestEditing] = useState<PstoRequestEditingState | null>(null)
  const [pstoResultEditing, setPstoResultEditing] = useState<PstoResultEditingState | null>(null)
  const [heatTreatmentFieldEditing, setHeatTreatmentFieldEditing] = useState<HeatTreatmentFieldEditingState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [highlightedRowIds, setHighlightedRowIds] = useState<Set<number>>(new Set())
  const [highlightedCellKeys, setHighlightedCellKeys] = useState<Set<string>>(new Set())
  const [selectedHeatTreatmentIds, setSelectedHeatTreatmentIds] = useState<Set<number>>(new Set())

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
    if (activeReport !== 'heatTreatment') {
      setSelectedHeatTreatmentIds(new Set())
      setPstoRequestEditing(null)
      setPstoResultEditing(null)
      setHeatTreatmentFieldEditing(null)
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

  const rows = useMemo(
    () =>
      (weldsQuery.data ?? []).map((row): WeldRow => {
        const normalizedRow = normalizeRowPstoRequest(row as WeldRow)
        const withPstoTimestamp = withPstoCreatedAt([normalizedRow])[0]
        return { ...withPstoTimestamp, finalStatus: calculateFinalStatus(withPstoTimestamp) }
      }),
    [weldsQuery.data],
  )
  const heatTreatmentRows = useMemo(() => rows.filter((row) => isYesText(row.pstoRequired)), [rows])
  const visibleRows = activeReport === 'heatTreatment' ? heatTreatmentRows : rows
  const selectedHeatTreatmentRows = useMemo(
    () => heatTreatmentRows.filter((row) => selectedHeatTreatmentIds.has(row.id) && canCreatePstoRequest(row)),
    [heatTreatmentRows, selectedHeatTreatmentIds],
  )
  const activeColumnFilters = activeReport === 'heatTreatment' ? heatTreatmentFilters : columnFilters
  const activeFiltersSetter = activeReport === 'heatTreatment' ? setHeatTreatmentFilters : setColumnFilters
  const acceptedWdiTotal = useMemo(() => sumAcceptedWdi(rows), [rows])
  const registerMinWidth = getWeldTableWidth(VISIBLE_FIELDS)
  const stickyLeft = navCollapsed ? 80 : 288
  const activeTitle = activeReport === 'heatTreatment' ? 'Термообработка' : 'Сварочный журнал'

  useEffect(() => {
    setSelectedHeatTreatmentIds((current) => {
      const selectableIds = new Set(heatTreatmentRows.filter(canCreatePstoRequest).map((row) => row.id))
      const next = new Set([...current].filter((id) => selectableIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [heatTreatmentRows])

  async function handleImport(file: File) {
    setMessage(null)
    const result = file.name.toLowerCase().endsWith('.csv')
      ? parseCsv(await file.text())
      : parseWorkbook(await file.arrayBuffer())
    await importMutation.mutateAsync(result.records)
    setMessage(`Добавлено ${result.records.length}, пропущено служебных строк: ${result.skippedRows}`)
  }

  function exportXlsx() {
    const workbook = buildExportWorkbook(visibleRows)
    XLSX.writeFile(workbook, activeReport === 'heatTreatment' ? 'heat-treatment-register.xlsx' : 'welding-register.xlsx')
  }

  function handleCreatePstoRequest() {
    if (selectedHeatTreatmentRows.length === 0) {
      setMessage('Выберите один или несколько стыков для заявки ПСТО')
      return
    }

    const requestName = formatPstoRequestName(heatTreatmentRows)
    pstoRequestMutation.mutate({ records: selectedHeatTreatmentRows, requestName, mode: 'create' })
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

    if (focusField === 'pstoRequest' || focusField === 'pstoResult') {
      setMessage('Поля ПСТО редактируются только в отчете Термообработка')
      return
    }

    setEditing({ record, focusField })
  }

  function saveEditedPstoRequest() {
    if (!pstoRequestEditing) return
    pstoRequestMutation.mutate({
      records: [pstoRequestEditing.record],
      requestName: pstoRequestEditing.value.trim(),
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
              {activeReport === 'weldingJournal' ? (
                <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending}>
                  <Upload className="mr-2 h-4 w-4" />
                  Импорт
                </Button>
              ) : null}
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
            readOnly={activeReport === 'heatTreatment'}
            editableFieldKeys={activeReport === 'heatTreatment' ? heatTreatmentEditableFieldKeys : undefined}
            blockedFieldKeys={activeReport === 'weldingJournal' ? weldingJournalBlockedFieldKeys : undefined}
            selectable={activeReport === 'heatTreatment'}
            selectedRowIds={selectedHeatTreatmentIds}
            onSelectedRowIdsChange={setSelectedHeatTreatmentIds}
            isRowSelectable={canCreatePstoRequest}
            storageKey={activeReport}
            hiddenFieldKeys={activeReport === 'heatTreatment' ? heatTreatmentHiddenFieldKeys : weldingJournalHiddenFieldKeys}
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
                <Input
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
                />
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
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
              <Button variant="outline" onClick={() => setHeatTreatmentFieldEditing(null)}>
                Отмена
              </Button>
              <Button onClick={saveEditedHeatTreatmentField} disabled={heatTreatmentFieldMutation.isPending}>
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

function migrateLegacyLnkRequest<T extends WeldInput>(row: T): T {
  const legacyRequest = String((row as Record<string, unknown>).lnkRequest ?? '').trim()
  if (!legacyRequest) return row

  const migrated = { ...row } as WeldInput & Record<string, unknown>
  delete migrated.lnkRequest
  const requestTargets: Array<[WeldFieldKey, string]> = [
    ['vikRequest', 'ВИК'],
    ['rkRequest', 'РК'],
    ['pvkRequest', 'ПВК'],
    ['uzkRequest', 'УЗК'],
    ['tvmtRequest', 'ТВМТ'],
    ['rfaRequest', 'РФА'],
    ['stlsRequest', 'СТЛС'],
    ['mkkRequest', 'МКК'],
  ]

  for (const [fieldKey, marker] of requestTargets) {
    if (legacyRequest.includes(marker) && !hasText(migrated[fieldKey])) {
      migrated[fieldKey] = legacyRequest
    }
  }

  return migrated as T
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
    const initializedRows = withCreatedAt(seedRows)
    writeLocalWelds(initializedRows)
    return initializedRows
  }

  try {
    const parsed = JSON.parse(stored) as Array<WeldInput & { id: number }>
    const normalizedRows = parsed.map((row) => {
      const withoutNoPsto = String(row.pstoRequired ?? '').toLowerCase() === 'нет' ? { ...row, pstoRequired: null } : row
      const withRequestMigration = migrateLegacyLnkRequest(withoutNoPsto)
      const withActualPstoRequest =
        withRequestMigration.pstoRequest === normalizePstoRequest(withRequestMigration.pstoRequest)
          ? withRequestMigration
          : { ...withRequestMigration, pstoRequest: normalizePstoRequest(withRequestMigration.pstoRequest) }
      const withTimestamp = withActualPstoRequest.createdAt
        ? withActualPstoRequest
        : { ...withActualPstoRequest, createdAt: new Date().toISOString() }
      return { ...withTimestamp, finalStatus: calculateFinalStatus(withTimestamp) }
    })
    const meaningfulRows = withAutoHeatTreatmentDiagrams(withPstoCreatedAt(normalizedRows.filter((row) => isMeaningfulRecord(row))))
    if (meaningfulRows.length !== parsed.length || meaningfulRows.some((row, index) => row !== parsed[index])) {
      writeLocalWelds(meaningfulRows)
    }
    return meaningfulRows
  } catch {
    writeLocalWelds(seedRows)
    return seedRows
  }
}

function withCreatedAt(rows: Array<WeldInput & { id: number }>) {
  const createdAt = new Date().toISOString()
  return rows.map((row) => (row.createdAt ? row : { ...row, createdAt }))
}

function withPstoCreatedAt<T extends WeldInput>(rows: T[]) {
  const pstoCreatedAt = new Date().toISOString()
  return rows.map((row) => (isYesText(row.pstoRequired) && !row.pstoCreatedAt ? { ...row, pstoCreatedAt } : row))
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
  const normalizedWithActualPstoRequest = {
    ...normalized,
    pstoRequest: normalizePstoRequest(normalized.pstoRequest),
  }

  if (!isMeaningfulRecord(normalizedWithActualPstoRequest)) {
    throw new Error('Заполните хотя бы Стык, Линию или Изометрию')
  }

  if (value.id) {
    const updated = withAutoHeatTreatmentDiagrams(
      rows.map((row) =>
        row.id === value.id ? withPstoCreatedAt([{ ...row, ...normalizedWithActualPstoRequest, id: value.id }])[0] : row,
      ),
    )
    writeLocalWelds(updated)
    return updated.find((row) => row.id === value.id)!
  }

  const nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
  const created = withPstoCreatedAt([{ id: nextId, ...normalizedWithActualPstoRequest, createdAt: new Date().toISOString() }])[0]
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
      withPstoCreatedAt([{ ...row, pstoRequest: normalizePstoRequest(row.pstoRequest) }])[0],
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
    return withPstoCreatedAt([
      { id: nextId++, ...normalized, pstoRequest: normalizePstoRequest(normalized.pstoRequest), createdAt: importedAt },
    ])[0]
  })
  const nextRows = withAutoHeatTreatmentDiagrams([...importedRows, ...existingRows])
  writeLocalWelds(nextRows)
  return nextRows.slice(0, importedRows.length)
}
