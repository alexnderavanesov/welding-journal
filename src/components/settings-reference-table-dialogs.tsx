import { type ClipboardEvent, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, Save, Trash2 } from 'lucide-react'

import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConfirmAction } from '@/lib/confirm-action-context'
import type { RkExposureTableSettings, WdiTableSettings } from '@/lib/other-settings'
import { getRkExposureDiameterEntry } from '@/lib/rk-exposure'
import {
  buildRkExposureTableFromEditorGrid,
  buildWdiTableFromEditorGrid,
  getRkExposureEditorGrid,
  getWdiEditorGrid,
  moveGridColumn,
  moveGridRow,
  pasteIntoGrid,
  type EditableGrid,
} from '@/lib/settings-reference-table-editor'
import { calculateWdi } from '@/lib/wdi'

type SaveHandler<T> = (table: T) => Promise<boolean>

export function WdiTableEditorDialog({
  table,
  onClose,
  onSave,
}: {
  table: WdiTableSettings | null
  onClose: () => void
  onSave: SaveHandler<WdiTableSettings>
}) {
  const confirmAction = useConfirmAction()
  const initialGrid = useMemo(() => getWdiEditorGrid(table), [table])
  const [grid, setGrid] = useState<EditableGrid>(initialGrid)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [testDiameter, setTestDiameter] = useState('')
  const [testThickness, setTestThickness] = useState('')
  const isDirty = JSON.stringify(grid) !== JSON.stringify(initialGrid)
  const columnCount = Math.max(2, ...grid.map((row) => row.length))
  const normalizedGrid = normalizeGridWidth(grid, columnCount)

  async function requestClose() {
    if (!isDirty) {
      onClose()
      return
    }
    const confirmed = await confirmAction({
      title: 'Закрыть редактор WDI?',
      itemName: 'Несохраненные изменения будут потеряны.',
      description: 'Сохраненный справочник и расчет WDI останутся без изменений.',
      confirmLabel: 'Закрыть без сохранения',
      tone: 'warning',
    })
    if (confirmed) onClose()
  }

  useDialogEscape(() => void requestClose())

  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    setGrid((current) => {
      const next = normalizeGridWidth(current, Math.max(columnCount, columnIndex + 1))
      next[rowIndex][columnIndex] = value
      return next
    })
    setError(null)
  }

  function pasteCells(event: ClipboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) {
    const value = event.clipboardData.getData('text/plain')
    if (!value) return
    event.preventDefault()
    setGrid((current) => pasteIntoGrid(current, rowIndex, columnIndex, value))
    setError(null)
  }

  function addDiameterRow() {
    setGrid((current) => [...normalizeGridWidth(current, columnCount), Array.from({ length: columnCount }, () => '')])
  }

  function addThicknessColumn() {
    setGrid((current) => current.map((row) => [...row, '']))
  }

  function removeDiameterRow(rowIndex: number) {
    setGrid((current) => current.filter((_, index) => index !== rowIndex))
    setError(null)
  }

  function removeThicknessColumn(columnIndex: number) {
    setGrid((current) => current.map((row) => row.filter((_, index) => index !== columnIndex)))
    setError(null)
  }

  function moveDiameterRow(rowIndex: number, direction: -1 | 1) {
    setGrid((current) => moveGridRow(current, rowIndex, direction, 1))
    setError(null)
  }

  function moveThicknessColumn(columnIndex: number, direction: -1 | 1) {
    setGrid((current) => moveGridColumn(current, columnIndex, direction))
    setError(null)
  }

  async function save() {
    setError(null)
    try {
      const nextTable = buildWdiTableFromEditorGrid(grid, {
        fileName: table?.fileName,
        uploadedAt: new Date().toISOString(),
      })
      setIsSaving(true)
      if (await onSave(nextTable)) onClose()
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  const testResult = getWdiTestResult(grid, testDiameter, testThickness)

  return (
    <LargeDialogShell maxWidthClassName="max-w-[1500px]" maxHeightClassName="max-h-[92vh]" panelClassName="overflow-hidden">
      <DialogHeader
        title="Таблица расчета WDI"
        subtitle="Диаметры находятся по строкам, толщины по столбцам. Диапазон из Excel можно вставить в выбранную ячейку через Ctrl+V."
        onClose={() => void requestClose()}
      />

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4">
        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Проверить диаметр</span>
            <Input value={testDiameter} onChange={(event) => setTestDiameter(event.target.value)} inputMode="decimal" className="w-40" placeholder="Например, 57" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Проверить толщину</span>
            <Input value={testThickness} onChange={(event) => setTestThickness(event.target.value)} inputMode="decimal" className="w-40" placeholder="Например, 6" />
          </label>
          <div className={`min-w-52 rounded-md border px-3 py-2 text-sm ${testResult.kind === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-sky-200 bg-sky-50 text-sky-800'}`}>
            {testResult.text}
          </div>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={addDiameterRow}><Plus className="mr-2 h-4 w-4" />Диаметр</Button>
            <Button type="button" variant="outline" onClick={addThicknessColumn}><Plus className="mr-2 h-4 w-4" />Толщина</Button>
          </div>
        </div>

        <div className="overflow-auto rounded-md border border-slate-300 bg-white shadow-sm">
          <table className="min-w-max border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20">
              <tr>
                {normalizedGrid[0].map((value, columnIndex) => (
                  <th
                    key={columnIndex}
                    className={`border-b border-r border-slate-300 bg-slate-100 p-0 align-top ${columnIndex === 0 ? 'sticky left-0 z-30 w-36 min-w-36' : 'w-24 min-w-24'}`}
                  >
                    {columnIndex === 0 ? (
                      <div className="flex h-[58px] items-center justify-center bg-slate-200 px-2 font-semibold text-slate-700">
                        D \ T
                      </div>
                    ) : (
                      <div className="flex h-[58px] flex-col bg-slate-100">
                        <input
                          value={value}
                          onChange={(event) => updateCell(0, columnIndex, event.target.value)}
                          onPaste={(event) => pasteCells(event, 0, columnIndex)}
                          inputMode="decimal"
                          aria-label={`Толщина ${columnIndex}`}
                          className="h-8 w-full border-0 bg-transparent px-2 text-center font-semibold outline-none focus:bg-sky-50 focus:ring-2 focus:ring-inset focus:ring-sky-400"
                        />
                        <div className="flex h-6 items-center justify-center border-t border-slate-200 bg-slate-50/80">
                          <CompactGridButton label={`Переместить толщину ${columnIndex} влево`} disabled={columnIndex === 1} onClick={() => moveThicknessColumn(columnIndex, -1)}><ArrowLeft /></CompactGridButton>
                          <CompactGridButton label={`Переместить толщину ${columnIndex} вправо`} disabled={columnIndex === columnCount - 1} onClick={() => moveThicknessColumn(columnIndex, 1)}><ArrowRight /></CompactGridButton>
                          <CompactGridButton label={`Удалить толщину ${columnIndex}`} disabled={columnCount <= 2} tone="danger" onClick={() => removeThicknessColumn(columnIndex)}><Trash2 /></CompactGridButton>
                        </div>
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {normalizedGrid.slice(1).map((row, offset) => {
                const rowIndex = offset + 1
                return (
                  <tr key={rowIndex}>
                    {row.map((value, columnIndex) => columnIndex === 0 ? (
                      <td key={columnIndex} className="sticky left-0 z-10 h-9 border-b border-r border-slate-300 bg-slate-50 p-0">
                        <div className="flex h-9 items-stretch">
                          <input
                            value={value}
                            onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
                            onPaste={(event) => pasteCells(event, rowIndex, columnIndex)}
                            inputMode="decimal"
                            aria-label={`Диаметр ${rowIndex}`}
                            className="min-w-0 flex-1 border-0 bg-transparent px-2 text-center font-semibold outline-none focus:bg-sky-50 focus:ring-2 focus:ring-inset focus:ring-sky-400"
                          />
                          <div className="flex w-[60px] shrink-0 items-center justify-center border-l border-slate-200 bg-white/70">
                            <CompactGridButton label={`Поднять диаметр ${rowIndex}`} disabled={rowIndex === 1} onClick={() => moveDiameterRow(rowIndex, -1)}><ArrowUp /></CompactGridButton>
                            <CompactGridButton label={`Опустить диаметр ${rowIndex}`} disabled={rowIndex === normalizedGrid.length - 1} onClick={() => moveDiameterRow(rowIndex, 1)}><ArrowDown /></CompactGridButton>
                            <CompactGridButton label={`Удалить строку ${rowIndex}`} disabled={normalizedGrid.length <= 2} tone="danger" onClick={() => removeDiameterRow(rowIndex)}><Trash2 /></CompactGridButton>
                          </div>
                        </div>
                      </td>
                    ) : (
                      <td key={columnIndex} className="h-9 border-b border-r border-slate-200 bg-white p-0">
                        <input
                          value={value}
                          onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
                          onPaste={(event) => pasteCells(event, rowIndex, columnIndex)}
                          inputMode="decimal"
                          aria-label={`WDI ${rowIndex}:${columnIndex}`}
                          className="h-9 w-full border-0 bg-transparent px-2 text-center outline-none focus:bg-sky-50 focus:ring-2 focus:ring-inset focus:ring-sky-400"
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <DialogFooter error={error} isSaving={isSaving} onCancel={() => void requestClose()} onSave={() => void save()} />
    </LargeDialogShell>
  )
}

export function RkExposureTableEditorDialog({
  table,
  onClose,
  onSave,
}: {
  table: RkExposureTableSettings | null
  onClose: () => void
  onSave: SaveHandler<RkExposureTableSettings>
}) {
  const confirmAction = useConfirmAction()
  const initialGrid = useMemo(() => getRkExposureEditorGrid(table), [table])
  const [grid, setGrid] = useState<EditableGrid>(initialGrid)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [testDiameter, setTestDiameter] = useState('')
  const isDirty = JSON.stringify(grid) !== JSON.stringify(initialGrid)
  const normalizedGrid = normalizeGridWidth(grid, 4)

  async function requestClose() {
    if (!isDirty) {
      onClose()
      return
    }
    const confirmed = await confirmAction({
      title: 'Закрыть справочник РК?',
      itemName: 'Несохраненные изменения будут потеряны.',
      description: 'Сохраненные диапазоны и схемы снимков останутся без изменений.',
      confirmLabel: 'Закрыть без сохранения',
      tone: 'warning',
    })
    if (confirmed) onClose()
  }

  useDialogEscape(() => void requestClose())

  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    setGrid((current) => {
      const next = normalizeGridWidth(current, 4)
      next[rowIndex][columnIndex] = value
      return next
    })
    setError(null)
  }

  function pasteCells(event: ClipboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) {
    const value = event.clipboardData.getData('text/plain')
    if (!value) return
    event.preventDefault()
    setGrid((current) => normalizeGridWidth(pasteIntoGrid(current, rowIndex, columnIndex, value), 4).map((row) => row.slice(0, 4)))
    setError(null)
  }

  function addRow() {
    setGrid((current) => [...normalizeGridWidth(current, 4), ['', '', '', '']])
  }

  function moveRow(rowIndex: number, direction: -1 | 1) {
    setGrid((current) => moveGridRow(current, rowIndex, direction))
    setError(null)
  }

  function removeRow(rowIndex: number) {
    setGrid((current) => current.length <= 1 ? [['', '', '', '']] : current.filter((_, index) => index !== rowIndex))
    setError(null)
  }

  async function save() {
    setError(null)
    try {
      const nextTable = buildRkExposureTableFromEditorGrid(grid, {
        fileName: table?.fileName,
        uploadedAt: new Date().toISOString(),
      })
      setIsSaving(true)
      if (await onSave(nextTable)) onClose()
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  const testResult = getRkTestResult(grid, testDiameter)

  return (
    <LargeDialogShell maxWidthClassName="max-w-[1500px]" maxHeightClassName="max-h-[92vh]" panelClassName="overflow-hidden">
      <DialogHeader
        title="Экспозиции по диаметрам"
        subtitle="Повторите диаметр в первой строке каждого варианта. Следующие строки с пустым диаметром продолжают этот вариант. Данные из Excel можно вставить через Ctrl+V."
        onClose={() => void requestClose()}
      />

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4">
        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Проверить диаметр</span>
            <Input value={testDiameter} onChange={(event) => setTestDiameter(event.target.value)} inputMode="decimal" className="w-44" placeholder="Например, 89" />
          </label>
          <div className={`min-w-80 max-w-2xl rounded-md border px-3 py-2 text-sm ${testResult.kind === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-sky-200 bg-sky-50 text-sky-800'}`}>
            {testResult.text}
          </div>
          <Button type="button" variant="outline" onClick={addRow} className="ml-auto"><Plus className="mr-2 h-4 w-4" />Добавить строку</Button>
        </div>

        <div className="overflow-auto rounded-md border border-slate-300 bg-white shadow-sm">
          <table className="w-full min-w-[840px] border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20 bg-slate-100 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="w-36 border-b border-r border-slate-300 px-2 py-2 text-left">Диаметр от</th>
                <th className="border-b border-r border-slate-300 px-2 py-2 text-left">Снимок / координата</th>
                <th className="w-36 border-b border-r border-slate-300 px-2 py-2 text-center">Основной</th>
                <th className="w-64 border-b border-r border-slate-300 px-2 py-2 text-left">Примечание</th>
                <th className="w-24 border-b border-slate-300 px-2 py-2 text-center">Порядок</th>
              </tr>
            </thead>
            <tbody>
              {normalizedGrid.map((row, rowIndex) => {
                const startsOption = Boolean(row[0]?.trim())
                return (
                  <tr key={rowIndex} className={startsOption ? 'bg-sky-50/40' : 'bg-white'}>
                    {[0, 1].map((columnIndex) => (
                      <td key={columnIndex} className="h-9 border-b border-r border-slate-200 p-0">
                        <input
                          value={row[columnIndex]}
                          onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
                          onPaste={(event) => pasteCells(event, rowIndex, columnIndex)}
                          inputMode={columnIndex === 0 ? 'decimal' : undefined}
                          aria-label={columnIndex === 0 ? `Диаметр строки ${rowIndex + 1}` : `Снимок строки ${rowIndex + 1}`}
                          placeholder={columnIndex === 0 && !startsOption ? 'продолжение' : undefined}
                          className={`h-9 w-full border-0 bg-transparent px-2 outline-none focus:bg-sky-50 focus:ring-2 focus:ring-inset focus:ring-sky-400 ${columnIndex === 0 ? 'font-semibold placeholder:font-normal placeholder:text-slate-300' : ''}`}
                        />
                      </td>
                    ))}
                    <td className="h-9 border-b border-r border-slate-200 p-0 text-center">
                      <label className="inline-flex h-9 w-full items-center justify-center text-slate-600">
                        <input
                          type="checkbox"
                          checked={row[2]?.trim() === '+'}
                          onChange={(event) => updateCell(rowIndex, 2, event.target.checked ? '+' : '')}
                          disabled={!startsOption}
                          aria-label={`Основная схема строки ${rowIndex + 1}`}
                          className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-500"
                        />
                      </label>
                    </td>
                    <td className="h-9 border-b border-r border-slate-200 p-0">
                      <input
                        value={row[3]}
                        onChange={(event) => updateCell(rowIndex, 3, event.target.value)}
                        onPaste={(event) => pasteCells(event, rowIndex, 3)}
                        disabled={!startsOption}
                        aria-label={`Примечание строки ${rowIndex + 1}`}
                        className="h-9 w-full border-0 bg-transparent px-2 outline-none focus:bg-sky-50 focus:ring-2 focus:ring-inset focus:ring-sky-400 disabled:bg-slate-50/60 disabled:text-slate-400"
                      />
                    </td>
                    <td className="h-9 border-b border-slate-200 p-0">
                      <div className="flex h-9 items-center justify-center">
                        <CompactGridButton label="Поднять строку" disabled={rowIndex === 0} onClick={() => moveRow(rowIndex, -1)}><ArrowUp /></CompactGridButton>
                        <CompactGridButton label="Опустить строку" disabled={rowIndex === normalizedGrid.length - 1} onClick={() => moveRow(rowIndex, 1)}><ArrowDown /></CompactGridButton>
                        <CompactGridButton label="Удалить строку" tone="danger" onClick={() => removeRow(rowIndex)}><Trash2 /></CompactGridButton>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <DialogFooter error={error} isSaving={isSaving} onCancel={() => void requestClose()} onSave={() => void save()} />
    </LargeDialogShell>
  )
}

function DialogFooter({
  error,
  isSaving,
  onCancel,
  onSave,
}: {
  error: string | null
  isSaving: boolean
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-slate-200 bg-white px-5 py-4">
      <div className="min-w-0 text-sm text-red-600">{error}</div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Отмена</Button>
        <Button type="button" onClick={onSave} disabled={isSaving}>
          {isSaving ? null : <Save className="mr-2 h-4 w-4" />}
          {isSaving ? 'Сохраняем...' : 'Сохранить справочник'}
        </Button>
      </div>
    </div>
  )
}

function CompactGridButton({
  label,
  disabled = false,
  tone = 'default',
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  tone?: 'default' | 'danger'
  onClick: () => void
  children: React.ReactElement<{ className?: string }>
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-6 w-5 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-25 ${tone === 'danger' ? 'text-red-500 hover:bg-red-50 hover:text-red-700' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`}
    >
      <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{children}</span>
    </button>
  )
}

function normalizeGridWidth(source: EditableGrid, width: number) {
  return source.map((row) => Array.from({ length: width }, (_, columnIndex) => row[columnIndex] ?? ''))
}

function getWdiTestResult(grid: EditableGrid, diameterValue: string, thicknessValue: string) {
  if (!diameterValue.trim() || !thicknessValue.trim()) return { kind: 'info' as const, text: 'Введите D и T, чтобы проверить результат.' }
  try {
    const table = buildWdiTableFromEditorGrid(grid)
    const diameter = parseTestNumber(diameterValue)
    const thickness = parseTestNumber(thicknessValue)
    const result = calculateWdi(
      { d1: diameter, d2: diameter, t1: thickness, t2: thickness },
      { wdiCalculationMode: 'table', wdiTable: table },
    )
    return result === null
      ? { kind: 'error' as const, text: 'Для указанных D и T значение WDI не найдено.' }
      : { kind: 'info' as const, text: `Расчетное WDI: ${String(result).replace('.', ',')}` }
  } catch (error) {
    return { kind: 'error' as const, text: (error as Error).message }
  }
}

function getRkTestResult(grid: EditableGrid, diameterValue: string) {
  if (!diameterValue.trim()) return { kind: 'info' as const, text: 'Введите диаметр, чтобы увидеть выбранную системой схему.' }
  try {
    const table = buildRkExposureTableFromEditorGrid(grid)
    const diameter = parseTestNumber(diameterValue)
    const entry = getRkExposureDiameterEntry(table, diameter)
    const option = entry?.options.find((item) => item.isDefault) ?? entry?.options[0]
    return option
      ? { kind: 'info' as const, text: `Для D ${diameter}: ${option.label}. Значения: ${option.values.join(', ')}.` }
      : { kind: 'error' as const, text: `Для D ${diameter} схема не найдена.` }
  } catch (error) {
    return { kind: 'error' as const, text: (error as Error).message }
  }
}

function parseTestNumber(value: string) {
  const parsed = Number(value.trim().replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Проверочное значение должно быть неотрицательным числом.')
  return parsed
}

function useDialogEscape(onClose: () => void) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || document.querySelector('[data-confirm-action-dialog="true"]')) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])
}
