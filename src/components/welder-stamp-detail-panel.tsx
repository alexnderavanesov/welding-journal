import { Archive, CalendarClock, CheckCircle2, Pencil, RotateCcw, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ContextActionMenu, type ContextActionMenuState } from '@/components/context-action-menu'
import { Button } from '@/components/ui/button'
import { formatWelderStampDate } from '@/lib/welder-stamp-format'
import {
  getArchivedWelderStampDlsPermits,
  getArchivedWelderStampNaksPermits,
  getAllWelderStampDlsPermits,
  getAllWelderStampNaksPermits,
  getWelderStampDlsPermits,
  getWelderStampNaksPermits,
} from '@/lib/welder-stamp-permits'
import type { WelderStampDlsPermit, WelderStampNaksPermit, WelderStampRecord } from '@/lib/welder-stamp-types'

type WelderStampExpandedDetailsProps = {
  record: WelderStampRecord
  onEdit: (record: WelderStampRecord, focusPermitId?: string) => void
  onArchive: (id: number) => void
  onRestore: (id: number) => void
  onArchivePermit: (recordId: number, permitKind: 'naks' | 'dls', permitId: string) => void
  onRestorePermit: (recordId: number, permitKind: 'naks' | 'dls', permitId: string) => void
  onDelete: (id: number) => void
}

export function WelderStampExpandedDetails({
  record,
  onEdit,
  onArchive,
  onRestore,
  onArchivePermit,
  onRestorePermit,
  onDelete,
}: WelderStampExpandedDetailsProps) {
  const naksPermits = getWelderStampNaksPermits(record)
  const dlsPermits = getWelderStampDlsPermits(record)
  const archivedNaksPermits = getArchivedWelderStampNaksPermits(record)
  const archivedDlsPermits = getArchivedWelderStampDlsPermits(record)
  const allNaksPermits = getAllWelderStampNaksPermits(record)
  const allDlsPermits = getAllWelderStampDlsPermits(record)
  const permitRows = [
    ...naksPermits.map((permit) => ({
      key: `naks-${permit.id}`,
      title: `НАКС ${allNaksPermits.findIndex((candidate) => candidate.id === permit.id) + 1}`,
      kind: 'naks' as const,
      permit,
    })),
    ...dlsPermits.map((permit) => ({
      key: `dls-${permit.id}`,
      title: formatDlsTitle(permit.number, allDlsPermits.findIndex((candidate) => candidate.id === permit.id)),
      kind: 'dls' as const,
      permit,
    })),
  ]
  const archivedPermitRows = [
    ...archivedNaksPermits.map((permit) => ({
      key: `archived-naks-${permit.id}`,
      title: `НАКС ${allNaksPermits.findIndex((candidate) => candidate.id === permit.id) + 1}`,
      kind: 'naks' as const,
      permit,
    })),
    ...archivedDlsPermits.map((permit) => ({
      key: `archived-dls-${permit.id}`,
      title: formatDlsTitle(permit.number, allDlsPermits.findIndex((candidate) => candidate.id === permit.id)),
      kind: 'dls' as const,
      permit,
    })),
  ]

  return (
    <div className="rounded-lg border-2 border-sky-200 bg-sky-50/70 shadow-md shadow-sky-100/70">
      <div className="border-b-2 border-sky-200 bg-white/85 px-3 py-2.5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold text-slate-900">{record.welderName || 'Без ФИО'}</h3>
            <StatusBadge state={record.archived ? 'archived' : 'active'} />
            <span className="rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[11px] font-bold text-indigo-800 shadow-sm shadow-indigo-100">
              {record.naksStamp || '-'}
            </span>
            <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
              Внутреннее: {record.internalStamp || '-'}
            </span>
            <span className="rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800">
              Группа: {record.materialGroups || '-'}
            </span>
            <span className="rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800">
              Способ: {record.weldType || '-'}
            </span>
          </div>
          <div className="inline-flex w-fit shrink-0 flex-nowrap items-center gap-1 rounded-lg border border-slate-200 bg-white/80 p-1 shadow-sm shadow-slate-100">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-md bg-slate-100 px-2.5 text-xs text-slate-700 hover:bg-slate-200 hover:text-slate-950"
              onClick={() => onEdit(record)}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Редактировать
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-md bg-sky-50 px-2.5 text-xs text-sky-800 hover:bg-sky-100 hover:text-sky-900"
              onClick={() => (record.archived ? onRestore(record.id) : onArchive(record.id))}
            >
              {record.archived ? <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> : <Archive className="mr-1.5 h-3.5 w-3.5" />}
              {record.archived ? 'Из архива' : 'В архив'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-md bg-rose-50 px-2.5 text-xs text-rose-700 hover:bg-rose-100 hover:text-rose-800"
              onClick={() => onDelete(record.id)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Удалить
            </Button>
          </div>
        </div>
        <p className="mt-0.5 truncate text-[11px] leading-4 text-slate-500">
          Официальное клеймо проверяется по реестру, архиву, сроку, способу сварки, группе материалов, D/T и ДЛС. Фактические клейма используются для фактической статистики и не заменяют официальный допуск.
        </p>
      </div>

      <div className="space-y-3 px-4 py-4">
        <section className="overflow-hidden rounded-md border-2 border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50/90 px-4 py-2.5">
            <h4 className="text-sm font-semibold text-slate-900">Допуски НАКС и ДЛС</h4>
          </div>
          {permitRows.length ? (
            <div className="divide-y divide-slate-200">
              {permitRows.map((row) => (
                <PermitLine
                  key={row.key}
                  title={row.title}
                  permit={row.permit}
                  archived={false}
                  onArchive={() => onArchivePermit(record.id, row.kind, row.permit.id)}
                  onRestore={() => onRestorePermit(record.id, row.kind, row.permit.id)}
                  onEdit={() => onEdit(record, row.permit.id)}
                />
              ))}
            </div>
          ) : (
            <div className="px-4 py-4 text-sm text-slate-500">Допуски НАКС и ДЛС пока не заполнены.</div>
          )}
        </section>
        {archivedPermitRows.length > 0 ? (
          <section className="overflow-hidden rounded-md border border-slate-200 bg-slate-50/80 shadow-sm shadow-slate-100">
            <div className="border-b border-slate-200 bg-slate-100 px-4 py-2.5">
              <h4 className="text-sm font-semibold text-slate-600">Архив НАКС и ДЛС</h4>
            </div>
            <div className="divide-y divide-slate-200">
              {archivedPermitRows.map((row) => (
                <PermitLine
                  key={row.key}
                  title={row.title}
                  permit={row.permit}
                  archived
                  onArchive={() => onArchivePermit(record.id, row.kind, row.permit.id)}
                  onRestore={() => onRestorePermit(record.id, row.kind, row.permit.id)}
                  onEdit={() => onEdit(record, row.permit.id)}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function PermitLine({
  title,
  permit,
  archived,
  onArchive,
  onRestore,
  onEdit,
}: {
  title: string
  permit: WelderStampNaksPermit | WelderStampDlsPermit
  archived: boolean
  onArchive: () => void
  onRestore: () => void
  onEdit: () => void
}) {
  const [contextMenu, setContextMenu] = useState<ContextActionMenuState>(null)
  const state = getPermitState([permit.validTo])
  const note = permit.note.trim()
  return (
    <div
      className={`overflow-x-auto px-4 py-2.5 ${archived ? 'bg-slate-50/80 text-slate-500 hover:bg-slate-100/70' : 'hover:bg-sky-50/60'}`}
      onContextMenu={(event) => {
        event.preventDefault()
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          items: [
            {
              id: 'edit-permit',
              label: 'Редактировать допуск',
              icon: Pencil,
              onSelect: onEdit,
            },
            {
              id: archived ? 'restore-permit' : 'archive-permit',
              label: archived ? 'Из архива' : 'В архив',
              icon: archived ? RotateCcw : Archive,
              onSelect: archived ? onRestore : onArchive,
            },
          ],
        })
      }}
    >
      <div className="grid min-w-[1060px] w-full items-center gap-x-3 gap-y-1.5 text-sm leading-6 md:grid-cols-[112px_minmax(120px,1fr)_minmax(120px,1fr)_130px_130px_210px_120px_76px]">
        <span className={`font-semibold ${archived ? 'text-slate-600' : 'text-slate-900'}`}>{title}</span>
        <PermitInlineValue label="Способ" value={permit.weldType} archived={archived} />
        <PermitInlineValue label="Группа" value={permit.materialGroups} archived={archived} />
        <PermitInlineValue label="D" value={formatPermitRange(permit.diameterFrom, permit.diameterTo)} archived={archived} />
        <PermitInlineValue label="T" value={formatPermitRange(permit.thicknessFrom, permit.thicknessTo)} archived={archived} />
        <PermitInlineValue label="Срок" value={formatPermitValidity(permit.validFrom, permit.validTo)} archived={archived} />
        <PermitStateBadge state={state} archived={archived} />
        <div className="flex justify-end gap-1">
          <button
            type="button"
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
              archived
                ? 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                : 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-900'
            }`}
            title="Редактировать этот допуск"
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
              archived
                ? 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            }`}
            title={archived ? 'Вернуть допуск из архива' : 'Отправить допуск в архив'}
            onClick={archived ? onRestore : onArchive}
          >
            {archived ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {note ? (
        <div className={`mt-1 text-sm leading-6 ${archived ? 'text-slate-400' : 'text-slate-500'}`}>
          <span className="font-semibold text-slate-400">Примечание: </span>
          {note}
        </div>
      ) : null}
      <ContextActionMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  )
}

function PermitInlineValue({ label, value, archived = false }: { label: string; value: string; archived?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 font-semibold text-slate-400">{label}:</span>
      <span className={`break-words ${archived ? 'text-slate-500' : 'text-slate-700'}`}>{value || '-'}</span>
    </span>
  )
}

type PermitState = 'active' | 'soon' | 'expired'

function getPermitState(validToValues: string[]): PermitState {
  const values = validToValues.filter(Boolean).sort()
  const nearest = values[0]
  if (!nearest) return 'active'

  const today = new Date().toISOString().slice(0, 10)
  if (nearest < today) return 'expired'

  const todayDate = new Date(`${today}T00:00:00`)
  const nearestDate = new Date(`${nearest}T00:00:00`)
  const daysLeft = Math.ceil((nearestDate.getTime() - todayDate.getTime()) / 86_400_000)
  return daysLeft <= 30 ? 'soon' : 'active'
}

function PermitStateIcon({ state }: { state: PermitState }) {
  const className =
    state === 'expired'
      ? 'text-rose-600'
      : state === 'soon'
        ? 'text-amber-600'
        : 'text-emerald-600'
  const Icon = state === 'expired' ? ShieldAlert : state === 'soon' ? CalendarClock : ShieldCheck
  return <Icon className={`h-4 w-4 shrink-0 ${className}`} />
}

function PermitStateBadge({ state, archived = false }: { state: PermitState; archived?: boolean }) {
  if (archived) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
        <Archive className="h-4 w-4 shrink-0 text-slate-400" />
        в архиве
      </span>
    )
  }

  const label = state === 'expired' ? 'просрочен' : state === 'soon' ? 'истекает' : 'действует'
  const className =
    state === 'expired'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : state === 'soon'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${className}`}>
      <PermitStateIcon state={state} />
      {label}
    </span>
  )
}

function StatusBadge({ state }: { state: 'active' | 'archived' }) {
  return state === 'archived' ? (
    <span className="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">в архиве</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
      <CheckCircle2 className="h-3 w-3" />
      активен
    </span>
  )
}

function formatPermitRange(from: string, to: string) {
  if (from && to) return `${from} - ${to}`
  if (from) return `от ${from}`
  if (to) return `до ${to}`
  return '-'
}

function formatPermitValidity(from: string, to: string) {
  const formattedFrom = formatWelderStampDate(from)
  const formattedTo = formatWelderStampDate(to)
  if (formattedFrom && formattedTo) return `${formattedFrom} - ${formattedTo}`
  if (formattedFrom) return `с ${formattedFrom}`
  if (formattedTo) return `до ${formattedTo}`
  return '-'
}

function formatDlsTitle(number: string, index: number) {
  const value = number.trim()
  if (!value) return `ДЛС ${index + 1}`
  return value.toLocaleLowerCase('ru-RU').includes('длс') ? value : `ДЛС ${value}`
}
