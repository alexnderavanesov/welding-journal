import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, NotebookTabs, PanelLeftClose, PanelLeftOpen, Plus, Upload } from 'lucide-react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
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
import { VISIBLE_FIELDS, calculateFinalStatus, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'

export const Route = createFileRoute('/')({
  component: Home,
})

const emptyFilters: WeldFilters = {}
const seedRows = seedWelds as Array<WeldInput & { id: number }>
const localStorageKey = 'welding-tracker-local-welds'
type EditingState = {
  record: WeldInput & { id?: number }
  focusField?: WeldFieldKey
}

function Home() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [navCollapsed, setNavCollapsed] = useState(false)

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

  const weldsQuery = useQuery({
    queryKey: ['weld-joints', emptyFilters],
    queryFn: async () => {
      try {
        return await listWeldJoints({ data: emptyFilters })
      } catch {
        return filterLocalWelds(emptyFilters)
      }
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (value: WeldInput & { id?: number }) => {
      try {
        return value.id ? await updateWeldJoint({ data: value }) : await createWeldJoint({ data: value })
      } catch {
        return saveLocalWeld(value)
      }
    },
    onSuccess: async () => {
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
        return await deleteWeldJoint({ data: { id } })
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
        return await importWeldJoints({ data: { records } })
      } catch {
        importLocalWelds(records)
        return { inserted: records.length }
      }
    },
    onSuccess: async (result) => {
      setMessage(`Импортировано записей: ${result.inserted}`)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const rows = useMemo(
    () => (weldsQuery.data ?? []).map((row) => ({ ...row, finalStatus: calculateFinalStatus(row) })),
    [weldsQuery.data],
  )
  const acceptedWdiTotal = useMemo(() => sumAcceptedWdi(rows), [rows])
  const registerMinWidth = getWeldTableWidth(VISIBLE_FIELDS)
  const stickyLeft = navCollapsed ? 80 : 288

  async function handleImport(file: File) {
    setMessage(null)
    const result = file.name.toLowerCase().endsWith('.csv')
      ? parseCsv(await file.text())
      : parseWorkbook(await file.arrayBuffer())
    await importMutation.mutateAsync(result.records)
    setMessage(`Импортировано ${result.records.length}, пропущено служебных строк: ${result.skippedRows}`)
  }

  function exportXlsx() {
    const workbook = buildExportWorkbook(rows)
    XLSX.writeFile(workbook, 'welding-register.xlsx')
  }

  return (
    <main className="relative min-h-screen bg-white">
      <aside
        className={`fixed left-0 top-0 z-30 h-screen border-r border-slate-100 bg-background px-3 py-5 transition-[width] duration-200 ${
          navCollapsed ? 'w-16' : 'w-48 lg:w-64 lg:px-4'
        }`}
      >
        <div
          className={`mb-6 flex items-start ${navCollapsed ? 'justify-center [&>div]:sr-only' : 'justify-between gap-3'}`}
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
        <nav>
          <button
            className={`flex w-full items-center gap-2 rounded-md bg-primary px-3 py-2 text-left text-sm font-medium text-primary-foreground ${
              navCollapsed ? 'justify-center px-0' : ''
            }`}
            title="Сварочный журнал"
          >
            <NotebookTabs className="h-4 w-4 shrink-0" />
            <span className={navCollapsed ? 'sr-only' : ''}>Сварочный журнал</span>
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
              <h1 className="text-2xl font-semibold tracking-tight">Сварочный журнал</h1>
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
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending}>
                <Upload className="mr-2 h-4 w-4" />
                Импорт
              </Button>
              <Button variant="outline" onClick={exportXlsx}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Excel
              </Button>
              <Button onClick={() => setEditing({ record: {} })}>
                <Plus className="mr-2 h-4 w-4" />
                Новый стык
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
                : `Записей: ${rows.length} · WDI годных: ${formatWdiTotal(acceptedWdiTotal)}`}
              {weldsQuery.error ? ` Ошибка: ${(weldsQuery.error as Error).message}` : null}
            </span>
            <span>{message}</span>
          </div>

          <WeldTable
            rows={rows as Array<WeldInput & { id: number }>}
            columnFilters={columnFilters}
            onColumnFiltersChange={setColumnFilters}
            onEdit={(record, focusField) => setEditing({ record, focusField })}
            onDelete={(id) => {
              if (confirm('Удалить запись стыка?')) deleteMutation.mutate(id)
            }}
            stickyLeft={stickyLeft}
          />
        </div>
      </div>

      {editing ? (
        <WeldForm
          value={editing.record}
          focusField={editing.focusField}
          busy={saveMutation.isPending}
          onCancel={() => setEditing(null)}
          onSave={(value) => saveMutation.mutate({ ...value, id: editing.record.id })}
        />
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

function readLocalWelds() {
  if (typeof window === 'undefined') return seedRows

  const stored = window.localStorage.getItem(localStorageKey)
  if (!stored) {
    writeLocalWelds(seedRows)
    return seedRows
  }

  try {
    const parsed = JSON.parse(stored) as Array<WeldInput & { id: number }>
    const normalizedRows = parsed.map((row) => {
      const withoutNoPsto = String(row.pstoRequired ?? '').toLowerCase() === 'нет' ? { ...row, pstoRequired: null } : row
      return { ...withoutNoPsto, finalStatus: calculateFinalStatus(withoutNoPsto) }
    })
    const meaningfulRows = normalizedRows.filter((row) => isMeaningfulRecord(row))
    if (meaningfulRows.length !== parsed.length || normalizedRows.some((row, index) => row !== parsed[index])) {
      writeLocalWelds(meaningfulRows)
    }
    return meaningfulRows
  } catch {
    writeLocalWelds(seedRows)
    return seedRows
  }
}

function writeLocalWelds(rows: Array<WeldInput & { id: number }>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(localStorageKey, JSON.stringify(rows))
}

function saveLocalWeld(value: WeldInput & { id?: number }) {
  const rows = readLocalWelds()
  const normalized = normalizeWeldInput(value)

  if (!isMeaningfulRecord(normalized)) {
    throw new Error('Заполните хотя бы Стык, Линию или Изометрию')
  }

  if (value.id) {
    const updated = rows.map((row) => (row.id === value.id ? { ...row, ...normalized, id: value.id } : row))
    writeLocalWelds(updated)
    return updated.find((row) => row.id === value.id)!
  }

  const nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
  const created = { id: nextId, ...normalized }
  writeLocalWelds([created, ...rows])
  return created
}

function deleteLocalWeld(id: number) {
  writeLocalWelds(readLocalWelds().filter((row) => row.id !== id))
}

function importLocalWelds(records: WeldInput[]) {
  const rows = readLocalWelds()
  let nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
  const imported = records.map((record) => ({ id: nextId++, ...normalizeWeldInput(record) }))
  writeLocalWelds([...imported, ...rows])
}


