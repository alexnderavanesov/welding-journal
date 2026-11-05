import { useMemo } from 'react'
import type { ColDef } from 'ag-grid-community'
import { ReadOnlyGrid } from './read-only-grid'
import { formatSupportLength, SUPPORT_STATISTICS_NOTE, SUPPORT_WELDER_STATISTICS_NOTE, type SupportWelderStatisticsRow, type SupportStatisticsMonth, type SupportStatisticsSummary } from '@/lib/support-statistics'

const countFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const percentFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const welderRowId = ({ data }: { data: SupportWelderStatisticsRow }) => data.stamp

type Props = { summary: SupportStatisticsSummary; onOpenRows?: (ids: number[], message?: string) => void }
export function SupportStatisticsPanel({ summary, onOpenRows }: Props) {
  const open = (ids: number[], label: string) => { if (ids.length) onOpenRows?.(ids, `Статистика опор · ${label}`) }
  const columns = useMemo<ColDef<SupportStatisticsMonth>[]>(() => [
    { field: 'month', headerName: 'Месяц', minWidth: 115, flex: 1 },
    ...([['physical', 'Физические ОП'], ['produced', 'Основной объём'], ['rejected', 'Текущие негодные'], ['repairs', 'Ремонты']] as const).map(([field, headerName]) => ({ field, headerName: `${headerName}, шт.`, minWidth: 145, flex: 1,
      cellRenderer: ({ data }: { data?: SupportStatisticsMonth }) => data ? <button type="button" disabled={!data[field] || !onOpenRows} className="rounded text-sky-700 underline decoration-dotted underline-offset-4 disabled:text-slate-600 disabled:no-underline" aria-label={`${headerName} · ${data.month}: ${data[field]}`} onClick={() => onOpenRows?.(data.rowIds[field], `Статистика опор · ${headerName} · ${data.month}`)}>{data[field]}</button> : null })),
    { colId: 'length', headerName: 'Длина основного объёма, мм', minWidth: 200, flex: 1.5, valueGetter: ({ data }) => data ? formatSupportLength(data.lengthMm, data.missingLength, { unit: 'mm', decimals: 0 }) : '' },
    { field: 'missingLength', headerName: 'Основной объём без L, шт.', minWidth: 155, flex: 1 },
    { colId: 'repairLength', headerName: 'Длина ремонтов, мм', minWidth: 180, flex: 1.5, valueGetter: ({ data }) => data ? formatSupportLength(data.repairLengthMm, data.repairMissingLength, { unit: 'mm', decimals: 0 }) : '' },
    { field: 'repairMissingLength', headerName: 'Ремонты без L, шт.', minWidth: 140, flex: 1 },
  ], [onOpenRows])
  const welderColumns = useMemo<ColDef<SupportWelderStatisticsRow>[]>(() => [
    { field: 'stamp', headerName: 'Клеймо', pinned: 'left', minWidth: 190, flex: 1.4, cellClass: 'statistics-cell',
      cellRenderer: ({ data }: { data?: SupportWelderStatisticsRow }) => data ? <div className="flex h-full flex-col justify-center leading-5"><span className="font-semibold text-slate-900">{data.stamp}</span><span className="truncate text-xs text-slate-500">{data.welderName}</span></div> : null },
    ...([['total', 'Всего'], ['good', 'Годен'], ['waitingRequest', 'Ожидает заявку'], ['waitingControl', 'Ожидает НК'], ['rejected', 'Не годен']] as const).map(([field, headerName]) => ({
      field, headerName, minWidth: 125, flex: 1, cellClass: `statistics-cell statistics-number ${field === 'good' ? 'text-emerald-700' : field === 'rejected' ? 'text-rose-700' : ''}`,
      valueFormatter: ({ value }: { value: number }) => countFormat.format(value),
    })),
    { field: 'defectPercent', headerName: '% брака', minWidth: 135, flex: 1, cellClass: 'statistics-cell statistics-number',
      cellRenderer: ({ data }: { data?: SupportWelderStatisticsRow }) => data ? <span>{percentFormat.format(data.defectPercent)}% <span className="text-xs text-slate-400">из {countFormat.format(data.good + data.rejected)}</span></span> : null },
  ], [])
  return <div className="space-y-4" data-testid="support-statistics">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {([['physical', 'Физические опоры'], ['produced', 'Основной объём'], ['rejected', 'Текущие негодные'], ['repairs', 'Ремонтные записи']] as const).map(([key, label]) => <button type="button" key={key} disabled={!summary[key] || !onOpenRows} onClick={() => open(summary.rowIds[key], label)} className="rounded-md border border-slate-200 bg-white p-4 text-left enabled:hover:border-sky-300 enabled:hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"><span className="text-xs text-slate-500">{label}</span><strong className="mt-2 block text-2xl font-semibold tabular-nums text-slate-800">{summary[key]} <span className="text-sm font-normal">шт.</span></strong></button>)}
    </div>
    <div className="grid gap-3 sm:grid-cols-2">{([
      ['Длина основного объёма', summary.lengthMm, summary.missingLength], ['Длина ремонтов', summary.repairLengthMm, summary.repairMissingLength],
    ] as const).map(([label, value, missing]) => <section key={label} className="rounded-md border border-slate-200 bg-white p-4"><h3 className="text-sm text-slate-600">{label}</h3><p className="mt-2 text-xl font-semibold tabular-nums text-slate-800">{formatSupportLength(value, missing, { unit: 'm', decimals: 2 })}{value !== null ? ' м' : ''}</p>{missing ? <p role="status" className="mt-1 text-xs text-amber-800">Без длины: {missing}. Показатели в штуках сохранены; сумма длины неполна.</p> : null}</section>)}</div>
    <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">{SUPPORT_STATISTICS_NOTE}</p>
    <section className="rounded-md border border-slate-200 bg-white"><h3 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">Объём по месяцам</h3>{summary.months.length ? <ReadOnlyGrid label="Статистика опор по месяцам" pageScroll rowData={summary.months} columnDefs={columns} getRowId={({ data }) => data.month} /> : <p className="p-6 text-sm text-slate-500">В выбранном периоде и срезе сваренных опор и ремонтных записей нет.</p>}</section>
    <section className="rounded-md border border-slate-200 bg-white" data-testid="support-welder-statistics">
      <h3 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">Сварщики — опоры</h3>
      <p className="px-4 py-3 text-xs leading-relaxed text-slate-500">{SUPPORT_WELDER_STATISTICS_NOTE}</p>
      {summary.welders?.length ? <ReadOnlyGrid label="Статистика сварщиков по опорам" pageScroll rowData={summary.welders} columnDefs={welderColumns} getRowId={welderRowId} rowHeight={54} />
        : <p className="p-6 text-sm text-slate-500">В выбранном периоде и срезе нет сваренных опор с фактическим клеймом.</p>}
    </section>
  </div>
}
