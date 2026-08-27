import { type ClipboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, Save, Trash2, X } from 'lucide-react'

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

      <div className="flex min-h-0 flex-1 flex-col bg-slate-50 p-4">
        <div className="mb-3 flex shrink-0 flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-3">
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
          <div className="ml-auto rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs text-slate-500">
            <div className="font-semibold text-slate-700">{normalizedGrid.length - 1} D × {columnCount - 1} T</div>
            <div>ячейки редактируются напрямую</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-300 bg-white shadow-sm">
          <table className="table-fixed border-separate border-spacing-0 text-sm" style={{ width: 112 + Math.max(1, columnCount - 1) * 72 }}>
            <colgroup>
              <col style={{ width: 112 }} />
              {normalizedGrid[0].slice(1).map((_, columnIndex) => <col key={columnIndex} style={{ width: 72 }} />)}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                {normalizedGrid[0].map((value, columnIndex) => (
                  <th
                    key={columnIndex}
                    className={`border-b border-r border-slate-300 bg-slate-100 p-0 align-top ${columnIndex === 0 ? 'sticky left-0 z-30' : ''}`}
                  >
                    {columnIndex === 0 ? (
                      <div className="flex h-[52px] items-center justify-center bg-slate-200 px-2 font-semibold text-slate-700">
                        D \ T
                      </div>
                    ) : (
                      <div className="flex h-[52px] flex-col bg-slate-100">
                        <input
                          value={value}
                          onChange={(event) => updateCell(0, columnIndex, event.target.value)}
                          onPaste={(event) => pasteCells(event, 0, columnIndex)}
                          inputMode="decimal"
                          aria-label={`Толщина ${columnIndex}`}
                          className="h-7 w-full border-0 bg-transparent px-1 text-center font-semibold outline-none focus:bg-sky-50 focus:ring-2 focus:ring-inset focus:ring-sky-400"
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
                const rowBackground = rowIndex % 2 === 0 ? 'bg-slate-50/40' : 'bg-white'
                const stickyCellBackground = rowIndex % 2 === 0 ? 'bg-slate-100/80' : 'bg-slate-50'
                return (
                  <tr key={rowIndex} className={rowBackground}>
                    {row.map((value, columnIndex) => columnIndex === 0 ? (
                      <td key={columnIndex} className={`sticky left-0 z-10 h-8 border-b border-r border-slate-300 p-0 ${stickyCellBackground}`}>
                        <div className="flex h-8 items-stretch">
                          <input
                            value={value}
                            onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
                            onPaste={(event) => pasteCells(event, rowIndex, columnIndex)}
                            inputMode="decimal"
                            aria-label={`Диаметр ${rowIndex}`}
                            className="w-12 min-w-0 flex-1 border-0 bg-transparent px-1 text-center font-semibold outline-none focus:bg-sky-50 focus:ring-2 focus:ring-inset focus:ring-sky-400"
                          />
                          <div className="flex w-[54px] shrink-0 items-center justify-center border-l border-slate-200 bg-white/70">
                            <CompactGridButton label={`Поднять диаметр ${rowIndex}`} disabled={rowIndex === 1} onClick={() => moveDiameterRow(rowIndex, -1)}><ArrowUp /></CompactGridButton>
                            <CompactGridButton label={`Опустить диаметр ${rowIndex}`} disabled={rowIndex === normalizedGrid.length - 1} onClick={() => moveDiameterRow(rowIndex, 1)}><ArrowDown /></CompactGridButton>
                            <CompactGridButton label={`Удалить строку ${rowIndex}`} disabled={normalizedGrid.length <= 2} tone="danger" onClick={() => removeDiameterRow(rowIndex)}><Trash2 /></CompactGridButton>
                          </div>
                        </div>
                      </td>
                    ) : (
                      <td key={columnIndex} className="h-8 border-b border-r border-slate-200 bg-transparent p-0">
                        <input
                          value={value}
                          onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
                          onPaste={(event) => pasteCells(event, rowIndex, columnIndex)}
                          inputMode="decimal"
                          aria-label={`WDI ${rowIndex}:${columnIndex}`}
                          className="h-8 w-full border-0 bg-transparent px-1 text-center outline-none focus:bg-sky-50 focus:ring-2 focus:ring-inset focus:ring-sky-400"
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

      <DialogFooter
        error={error}
        isSaving={isSaving}
        onCancel={() => void requestClose()}
        onSave={() => void save()}
        startActions={(
          <>
            <Button type="button" variant="outline" onClick={addDiameterRow}><Plus className="mr-2 h-4 w-4" />Добавить диаметр</Button>
            <Button type="button" variant="outline" onClick={addThicknessColumn}><Plus className="mr-2 h-4 w-4" />Добавить толщину</Button>
          </>
        )}
      />
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
  const [pendingDiameter, setPendingDiameter] = useState<string | null>(null)
  const [scrollTargetDiameterKey, setScrollTargetDiameterKey] = useState<string | null>(null)
  const matrixViewportRef = useRef<HTMLDivElement>(null)
  const isDirty = JSON.stringify(grid) !== JSON.stringify(initialGrid)
  const normalizedGrid = useMemo(() => normalizeGridWidth(grid, 4), [grid])
  const diameterGroups = useMemo(() => buildRkExposureMatrix(normalizedGrid), [normalizedGrid])
  const matrixOptionCount = diameterGroups.reduce((sum, group) => sum + group.options.length, 0)

  useEffect(() => {
    if (!scrollTargetDiameterKey) return
    const viewport = matrixViewportRef.current
    const target = Array.from(viewport?.querySelectorAll<HTMLElement>('[data-rk-diameter-key]') ?? [])
      .find((element) => element.dataset.rkDiameterKey === scrollTargetDiameterKey)
    if (!viewport || !target) return
    viewport.scrollLeft = Math.max(0, target.offsetLeft - 144)
    setScrollTargetDiameterKey(null)
  }, [diameterGroups, scrollTargetDiameterKey])

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

  function updateDefaultOption(group: RkExposureMatrixGroup, option: RkExposureMatrixOption, checked: boolean) {
    setGrid((current) => {
      const next = normalizeGridWidth(current, 4)
      if (checked) {
        group.options.forEach((groupOption) => {
          next[groupOption.startRowIndex][2] = ''
        })
      }
      next[option.startRowIndex][2] = checked ? '+' : ''
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

  function addDiameter() {
    const diameter = pendingDiameter?.trim() ?? ''
    if (!diameter) {
      setError('Укажите новый диаметр.')
      return
    }
    const numericDiameter = Number(diameter.replace(',', '.'))
    if (!Number.isFinite(numericDiameter)) {
      setError('Диаметр должен быть числом.')
      return
    }
    const diameterKey = normalizeRkExposureDiameterKey(diameter)
    setGrid((current) => {
      const next = normalizeGridWidth(current, 4)
      const hasValues = next.some((row) => row.some((cell) => cell.trim()))
      if (!hasValues) return [[diameter, '', '', '']]

      const groups = buildRkExposureMatrix(next)
      const existingGroup = groups.find((group) => group.diameter.trim() && group.key === diameterKey)
      if (existingGroup) {
        const insertAt = existingGroup.rowIndexes.at(-1) ?? next.length - 1
        next.splice(insertAt + 1, 0, [existingGroup.diameter, '', '', ''])
        return next
      }

      const nextGroup = groups.find((group) => {
        const groupDiameter = Number(group.diameter.replace(',', '.'))
        return group.diameter.trim() && Number.isFinite(groupDiameter) && groupDiameter > numericDiameter
      })
      const insertAt = nextGroup?.rowIndexes[0] ?? next.length
      next.splice(insertAt, 0, [diameter, '', '', ''])
      return next
    })
    setPendingDiameter(null)
    setError(null)
    setScrollTargetDiameterKey(diameterKey)
  }

  function addOption(group: RkExposureMatrixGroup) {
    if (!group.diameter.trim()) {
      setError('Сначала укажите диаметр, затем добавьте для него вариант.')
      return
    }
    setGrid((current) => {
      const next = normalizeGridWidth(current, 4)
      const insertAt = group.options.at(-1)?.rowIndexes.at(-1)
      if (insertAt === undefined) return next
      next.splice(insertAt + 1, 0, [group.diameter, '', '', ''])
      return next
    })
    setError(null)
    requestAnimationFrame(() => {
      const viewport = matrixViewportRef.current
      if (viewport) viewport.scrollLeft += 208
    })
  }

  function addInterval(option: RkExposureMatrixOption) {
    setGrid((current) => {
      const next = normalizeGridWidth(current, 4)
      const insertAt = option.rowIndexes.at(-1)
      if (insertAt === undefined) return next
      next.splice(insertAt + 1, 0, ['', '', '', ''])
      return next
    })
    setError(null)
  }

  function moveInterval(option: RkExposureMatrixOption, valueIndex: number, direction: -1 | 1) {
    const targetIndex = valueIndex + direction
    if (targetIndex < 0 || targetIndex >= option.rowIndexes.length) return
    setGrid((current) => {
      const next = normalizeGridWidth(current, 4)
      const rowIndex = option.rowIndexes[valueIndex]
      const targetRowIndex = option.rowIndexes[targetIndex]
      ;[next[rowIndex][1], next[targetRowIndex][1]] = [next[targetRowIndex][1], next[rowIndex][1]]
      return next
    })
    setError(null)
  }

  function removeInterval(option: RkExposureMatrixOption, valueIndex: number) {
    const rowIndex = option.rowIndexes[valueIndex]
    setGrid((current) => {
      const next = normalizeGridWidth(current, 4)
      if (option.rowIndexes.length === 1) {
        next[rowIndex][1] = ''
        return next
      }
      if (valueIndex === 0) {
        const [, , isDefault, note] = next[rowIndex]
        next.splice(rowIndex, 1)
        next[rowIndex][0] = option.diameter
        next[rowIndex][2] = isDefault
        next[rowIndex][3] = note
        return next
      }
      next.splice(rowIndex, 1)
      return next
    })
    setError(null)
  }

  function moveOption(group: RkExposureMatrixGroup, optionIndex: number, direction: -1 | 1) {
    const targetIndex = optionIndex + direction
    if (targetIndex < 0 || targetIndex >= group.options.length) return
    setGrid((current) => {
      const groups = buildRkExposureMatrix(normalizeGridWidth(current, 4))
      const currentGroup = groups.find((candidate) => candidate.options.some((option) => option.startRowIndex === group.options[optionIndex].startRowIndex))
      if (!currentGroup) return normalizeGridWidth(current, 4)
      const optionBlocks = currentGroup.options.map((option) => option.rowIndexes.map((rowIndex) => [...current[rowIndex]]))
      ;[optionBlocks[optionIndex], optionBlocks[targetIndex]] = [optionBlocks[targetIndex], optionBlocks[optionIndex]]
      return replaceRkExposureRows(current, currentGroup.rowIndexes, optionBlocks.flat())
    })
    setError(null)
  }

  function removeOption(group: RkExposureMatrixGroup, optionIndex: number) {
    const option = group.options[optionIndex]
    setGrid((current) => removeRkExposureRows(current, option.rowIndexes))
    setError(null)
  }

  function removeGroup(group: RkExposureMatrixGroup) {
    setGrid((current) => removeRkExposureRows(current, group.rowIndexes))
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
    <LargeDialogShell maxWidthClassName="max-w-[1800px]" maxHeightClassName="max-h-[92vh]" panelClassName="overflow-hidden">
      <DialogHeader
        title="Экспозиции по диаметрам"
        subtitle="Каждый диаметр образует группу столбцов, а каждый столбец — отдельный вариант экспозиции. Данные из Excel можно вставить через Ctrl+V, начиная с поля диаметра."
        onClose={() => void requestClose()}
      />

      <div className="flex min-h-0 flex-1 flex-col bg-slate-50 p-4">
        <div className="mb-3 flex shrink-0 flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Проверить диаметр</span>
            <Input value={testDiameter} onChange={(event) => setTestDiameter(event.target.value)} inputMode="decimal" className="w-44" placeholder="Например, 89" />
          </label>
          <div className={`min-w-80 max-w-2xl rounded-md border px-3 py-2 text-sm ${testResult.kind === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-sky-200 bg-sky-50 text-sky-800'}`}>
            {testResult.text}
          </div>
          <div className="ml-auto rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs text-slate-500">
            <div className="font-semibold text-slate-700">{diameterGroups.filter((group) => group.diameter.trim()).length} диаметров</div>
            <div>{diameterGroups.filter((group) => group.diameter.trim()).reduce((sum, group) => sum + group.options.length, 0)} вариантов</div>
          </div>
        </div>

        <div ref={matrixViewportRef} className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-300 bg-white shadow-sm">
          <table
            className="table-fixed border-separate border-spacing-0 text-sm"
            style={{ width: 144 + Math.max(1, matrixOptionCount) * 208 }}
          >
            <colgroup>
              <col className="w-36" />
              {diameterGroups.flatMap((group) => group.options).map((option) => <col key={option.startRowIndex} className="w-52" />)}
            </colgroup>
            <thead className="sticky top-0 z-20 bg-slate-100 text-xs font-semibold text-slate-600">
              <tr>
                <th className="sticky left-0 z-30 h-12 border-b border-r border-slate-300 bg-slate-100 px-3 py-0 text-left uppercase">Диаметр от</th>
                {diameterGroups.map((group, groupIndex) => (
                  <th
                    key={`${group.key}-${group.options[0]?.startRowIndex}`}
                    colSpan={group.options.length}
                    data-rk-diameter-key={group.key}
                    className="border-b border-r-2 border-slate-300 bg-slate-100 p-0"
                  >
                    <div className="flex min-h-12 items-center gap-1 px-1.5 py-1.5">
                      <input
                        value={group.diameter}
                        onPaste={(event) => pasteCells(event, group.options[0].startRowIndex, 0)}
                        readOnly
                        inputMode="decimal"
                        aria-label={`Диаметр группы ${groupIndex + 1}`}
                        title="Чтобы изменить диаметр, удалите эту группу и создайте новую"
                        placeholder="Укажите диаметр"
                        className="h-8 min-w-0 max-w-40 flex-1 cursor-default rounded border border-slate-300 bg-slate-50 px-2 text-center text-sm font-semibold text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                      />
                      <button
                        type="button"
                        title="Добавить вариант для диаметра"
                        aria-label={`Добавить вариант для диаметра ${group.diameter || groupIndex + 1}`}
                        onClick={() => addOption(group)}
                        disabled={!group.diameter.trim()}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <CompactGridButton label="Удалить диаметр" tone="danger" onClick={() => removeGroup(group)}><Trash2 /></CompactGridButton>
                    </div>
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 z-30 h-12 border-b border-r border-slate-300 bg-slate-100 px-3 py-0 text-left uppercase">Варианты</th>
                {diameterGroups.flatMap((group) => group.options.map((option, optionIndex) => (
                  <th key={option.startRowIndex} className={`h-12 border-b border-slate-300 bg-slate-50 p-0 ${optionIndex === group.options.length - 1 ? 'border-r-2' : 'border-r'}`}>
                    <div className="flex h-12 items-center justify-between gap-2 px-2">
                      <span>Вариант {optionIndex + 1}</span>
                      <div className="flex items-center">
                        <CompactGridButton label="Переместить вариант влево" disabled={optionIndex === 0} onClick={() => moveOption(group, optionIndex, -1)}><ArrowLeft /></CompactGridButton>
                        <CompactGridButton label="Переместить вариант вправо" disabled={optionIndex === group.options.length - 1} onClick={() => moveOption(group, optionIndex, 1)}><ArrowRight /></CompactGridButton>
                        <CompactGridButton label="Удалить вариант" disabled={group.options.length === 1} tone="danger" onClick={() => removeOption(group, optionIndex)}><Trash2 /></CompactGridButton>
                      </div>
                    </div>
                  </th>
                )))}
              </tr>
            </thead>
            <tbody className="text-slate-700">
              <tr>
                <MatrixRowHeading>По умолчанию</MatrixRowHeading>
                {diameterGroups.flatMap((group) => group.options.map((option, optionIndex) => (
                  <td key={option.startRowIndex} className={`h-12 border-b border-slate-200 bg-white p-0 text-center ${optionIndex === group.options.length - 1 ? 'border-r-2 border-r-slate-300' : 'border-r'}`}>
                    <label className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 text-xs text-slate-500">
                      <input
                        type="checkbox"
                        checked={normalizedGrid[option.startRowIndex][2]?.trim() === '+'}
                        onChange={(event) => updateDefaultOption(group, option, event.target.checked)}
                        aria-label={`Вариант по умолчанию ${group.diameter || 'без диаметра'}:${optionIndex + 1}`}
                        className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-500"
                      />
                      <span>{normalizedGrid[option.startRowIndex][2]?.trim() === '+' ? 'Основной' : 'Не выбран'}</span>
                    </label>
                  </td>
                )))}
              </tr>
              <tr>
                <MatrixRowHeading>Примечание</MatrixRowHeading>
                {diameterGroups.flatMap((group) => group.options.map((option, optionIndex) => (
                  <td key={option.startRowIndex} className={`h-12 border-b border-slate-200 bg-slate-50/40 p-1.5 ${optionIndex === group.options.length - 1 ? 'border-r-2 border-r-slate-300' : 'border-r'}`}>
                    <input
                      value={normalizedGrid[option.startRowIndex][3]}
                      onChange={(event) => updateCell(option.startRowIndex, 3, event.target.value)}
                      onPaste={(event) => pasteCells(event, option.startRowIndex, 3)}
                      aria-label={`Примечание варианта ${group.diameter || 'без диаметра'}:${optionIndex + 1}`}
                      placeholder="Необязательно"
                      className="h-9 w-full rounded border border-slate-200 bg-white px-2 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                    />
                  </td>
                )))}
              </tr>
              <tr>
                <MatrixRowHeading align="top">Интервалы</MatrixRowHeading>
                {diameterGroups.flatMap((group) => group.options.map((option, optionIndex) => (
                  <td key={option.startRowIndex} className={`align-top bg-white p-0 ${optionIndex === group.options.length - 1 ? 'border-r-2 border-r-slate-300' : 'border-r'}`}>
                    <div className="divide-y divide-slate-100">
                      {option.rowIndexes.map((rowIndex, valueIndex) => (
                        <div key={rowIndex} className="flex h-10 items-center gap-1 px-1.5">
                          <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-slate-400">{valueIndex + 1}</span>
                          <input
                            value={normalizedGrid[rowIndex][1]}
                            onChange={(event) => updateCell(rowIndex, 1, event.target.value)}
                            onPaste={(event) => pasteCells(event, rowIndex, 1)}
                            aria-label={`Интервал варианта ${group.diameter || 'без диаметра'}:${optionIndex + 1}, строка ${valueIndex + 1}`}
                            placeholder="Снимок / координата"
                            className="h-8 min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 outline-none hover:border-slate-200 focus:border-sky-400 focus:bg-sky-50 focus:ring-2 focus:ring-sky-100"
                          />
                          <div className="flex shrink-0 items-center">
                            <CompactGridButton label="Поднять интервал" disabled={valueIndex === 0} onClick={() => moveInterval(option, valueIndex, -1)}><ArrowUp /></CompactGridButton>
                            <CompactGridButton label="Опустить интервал" disabled={valueIndex === option.rowIndexes.length - 1} onClick={() => moveInterval(option, valueIndex, 1)}><ArrowDown /></CompactGridButton>
                            <CompactGridButton label="Удалить интервал" tone="danger" onClick={() => removeInterval(option, valueIndex)}><Trash2 /></CompactGridButton>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => addInterval(option)}
                      className="flex h-9 w-full items-center justify-center gap-1 border-t border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 hover:bg-sky-50 hover:text-sky-700"
                    >
                      <Plus className="h-3.5 w-3.5" />Добавить интервал
                    </button>
                  </td>
                )))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <DialogFooter
        error={error}
        isSaving={isSaving}
        onCancel={() => void requestClose()}
        onSave={() => void save()}
        startActions={pendingDiameter === null ? (
          <Button type="button" variant="outline" onClick={() => { setPendingDiameter(''); setError(null) }}><Plus className="mr-2 h-4 w-4" />Добавить диаметр</Button>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              value={pendingDiameter}
              onChange={(event) => setPendingDiameter(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') addDiameter() }}
              inputMode="decimal"
              autoFocus
              aria-label="Новый диаметр"
              placeholder="Диаметр от"
              className="w-36"
            />
            <Button type="button" variant="outline" onClick={addDiameter}>Создать столбец</Button>
            <button
              type="button"
              title="Отменить добавление диаметра"
              aria-label="Отменить добавление диаметра"
              onClick={() => setPendingDiameter(null)}
              className="inline-flex h-9 w-9 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      />
    </LargeDialogShell>
  )
}

function MatrixRowHeading({ children, align = 'middle' }: { children: React.ReactNode; align?: 'middle' | 'top' }) {
  return (
    <th className={`sticky left-0 z-10 h-12 border-b border-r border-slate-300 bg-slate-100 px-3 py-0 text-left text-xs font-semibold uppercase text-slate-600 ${align === 'top' ? 'align-top pt-3' : 'align-middle'}`}>
      {children}
    </th>
  )
}

type RkExposureMatrixOption = {
  diameter: string
  startRowIndex: number
  rowIndexes: number[]
}

type RkExposureMatrixGroup = {
  diameter: string
  key: string
  options: RkExposureMatrixOption[]
  rowIndexes: number[]
}

function buildRkExposureMatrix(source: EditableGrid): RkExposureMatrixGroup[] {
  const options: RkExposureMatrixOption[] = []
  source.forEach((row, rowIndex) => {
    const diameter = row[0]?.trim() ?? ''
    const current = options.at(-1)
    if (!current || diameter) {
      options.push({ diameter, startRowIndex: rowIndex, rowIndexes: [rowIndex] })
      return
    }
    current.rowIndexes.push(rowIndex)
  })

  const groups: RkExposureMatrixGroup[] = []
  options.forEach((option) => {
    const key = normalizeRkExposureDiameterKey(option.diameter)
    const current = groups.at(-1)
    if (current?.key === key) {
      current.options.push(option)
      current.rowIndexes.push(...option.rowIndexes)
      return
    }
    groups.push({
      diameter: option.diameter,
      key,
      options: [option],
      rowIndexes: [...option.rowIndexes],
    })
  })
  return groups
}

function normalizeRkExposureDiameterKey(value: string) {
  const parsed = Number(value.replace(',', '.'))
  return value.trim() && Number.isFinite(parsed) ? `number:${parsed}` : `text:${value.trim()}`
}

function removeRkExposureRows(source: EditableGrid, rowIndexes: number[]) {
  const indexes = new Set(rowIndexes)
  const next = normalizeGridWidth(source, 4).filter((_, rowIndex) => !indexes.has(rowIndex))
  return next.length > 0 ? next : [['', '', '', '']]
}

function replaceRkExposureRows(source: EditableGrid, rowIndexes: number[], replacement: EditableGrid) {
  const firstRowIndex = Math.min(...rowIndexes)
  const indexes = new Set(rowIndexes)
  const next = normalizeGridWidth(source, 4).filter((_, rowIndex) => !indexes.has(rowIndex))
  next.splice(firstRowIndex, 0, ...replacement.map((row) => normalizeGridWidth([row], 4)[0]))
  return next
}

function DialogFooter({
  error,
  isSaving,
  onCancel,
  onSave,
  startActions,
}: {
  error: string | null
  isSaving: boolean
  onCancel: () => void
  onSave: () => void
  startActions?: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-slate-200 bg-white px-5 py-3">
      {startActions ? <div className="flex flex-wrap items-center gap-2">{startActions}</div> : null}
      <div className="min-w-0 flex-1 text-sm text-red-600">{error}</div>
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
