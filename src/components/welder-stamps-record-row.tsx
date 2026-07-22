import { Archive, CalendarClock, CheckCircle2, ChevronDown, Pencil, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { ContextActionMenu, type ContextActionMenuState } from '@/components/context-action-menu'
import { WelderStampExpandedDetails } from '@/components/welder-stamp-detail-panel'
import { formatWelderStampDlsSummary } from '@/lib/welder-stamp-format'
import { getWelderStampNaksPermits } from '@/lib/welder-stamp-permits'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type WelderStampsRecordRowProps = {
  record: WelderStampRecord
  editingId?: number | null
  selectedId?: number | null
  onSelect?: (record: WelderStampRecord) => void
  onEdit?: (record: WelderStampRecord, focusPermitId?: string) => void
  onArchive?: (id: number) => void
  onRestore?: (id: number) => void
  onArchivePermit?: (recordId: number, permitKind: 'naks' | 'dls', permitId: string) => void
  onRestorePermit?: (recordId: number, permitKind: 'naks' | 'dls', permitId: string) => void
  onDelete: (id: number) => void
}

export function WelderStampsRecordRow({
  record,
  editingId = null,
  selectedId = null,
  onSelect,
  onEdit,
  onArchive,
  onRestore,
  onArchivePermit,
  onRestorePermit,
  onDelete,
}: WelderStampsRecordRowProps) {
  const [contextMenu, setContextMenu] = useState<ContextActionMenuState>(null)
  const isSelected = selectedId === record.id
  const isArchived = record.archived
  const rowClassName = isArchived
    ? 'bg-slate-50 text-slate-500'
    : record.id === editingId
      ? 'bg-sky-50'
      : isSelected
        ? 'bg-sky-50/80'
        : 'odd:bg-white even:bg-slate-50/60'

  const textClassName = isArchived ? '' : 'text-slate-700'
  const naksCount = getWelderStampNaksPermits(record).length
  const naksState = getRecordPermitState(record)
  const toggleRow = () => onSelect?.(record)
  const cellBorderClassName = isSelected ? 'border-t-2 border-b border-sky-200 border-t-sky-300 bg-sky-50/80' : 'border-t border-slate-200'
  const firstCellBorderClassName = isSelected ? 'border-l-2 border-l-sky-300' : ''
  const lastCellBorderClassName = isSelected ? 'border-r-2 border-r-sky-300' : ''

  return (
    <>
      <tr
        key={record.id}
        className={`${rowClassName} cursor-pointer transition-colors hover:bg-sky-50/50`}
        onClick={toggleRow}
        onContextMenu={(event) => {
          event.preventDefault()
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            items: [
              {
                id: 'open-card',
                label: isSelected ? 'Скрыть карточку' : 'Открыть карточку',
                icon: ChevronDown,
                onSelect: toggleRow,
              },
              {
                id: 'edit-stamp',
                label: 'Редактировать',
                icon: Pencil,
                onSelect: () => onEdit?.(record),
              },
              {
                id: record.archived ? 'restore-stamp' : 'archive-stamp',
                label: record.archived ? 'Из архива' : 'В архив',
                icon: record.archived ? RotateCcw : Archive,
                disabled: record.archived ? !onRestore : !onArchive,
                onSelect: () => (record.archived ? onRestore?.(record.id) : onArchive?.(record.id)),
              },
            ],
          })
        }}
        title={isSelected ? 'Скрыть карточку' : 'Открыть карточку'}
      >
        <td className={`${cellBorderClassName} ${firstCellBorderClassName} px-3 py-3 text-center font-semibold ${isArchived ? '' : 'text-slate-900'}`}>
          <span className="inline-flex max-w-full items-center justify-center gap-1.5 rounded-md px-2 py-1 text-left">
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isSelected ? 'rotate-180' : ''}`} />
            <span className="break-words">{record.naksStamp || '-'}</span>
          </span>
        </td>
        <td className={`${cellBorderClassName} px-3 py-3 text-center ${textClassName}`}>
          <span className="inline-block max-w-full break-words rounded-md px-2 py-1 text-center">
            {record.welderName || '-'}
          </span>
        </td>
        <td className={`break-words ${cellBorderClassName} px-3 py-3 text-center ${textClassName}`}>{record.internalStamp || '-'}</td>
        <td className={`${cellBorderClassName} px-3 py-3 text-center`}>
          <RecordStatusBadge archived={isArchived} />
        </td>
        <td className={`break-words ${cellBorderClassName} px-3 py-3 text-center ${textClassName}`}>{record.weldType || '-'}</td>
        <td className={`break-words ${cellBorderClassName} px-3 py-3 text-center ${textClassName}`}>{record.materialGroups || '-'}</td>
        <td className={`break-words ${cellBorderClassName} px-3 py-3 text-center ${textClassName}`}>
          <span className="inline-flex items-center justify-center gap-1.5">
            <PermitStateIcon state={naksState} />
            {naksCount ? `${naksCount} доп.` : '-'}
          </span>
        </td>
        <td className={`break-words ${cellBorderClassName} ${lastCellBorderClassName} px-3 py-3 text-center ${textClassName}`}>
          {formatWelderStampDlsSummary(record)}
        </td>
      </tr>
      {isSelected ? (
        <tr className="bg-sky-50/40">
          <td colSpan={8} className="border-x-2 border-b-2 border-sky-300 bg-sky-50/40 px-4 pb-4 pt-3">
            <WelderStampExpandedDetails
              record={record}
              onEdit={onEdit ?? (() => undefined)}
              onArchive={onArchive ?? (() => undefined)}
              onRestore={onRestore ?? (() => undefined)}
              onArchivePermit={onArchivePermit ?? (() => undefined)}
              onRestorePermit={onRestorePermit ?? (() => undefined)}
              onDelete={onDelete}
            />
          </td>
        </tr>
      ) : null}
      <ContextActionMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </>
  )
}

type PermitState = 'active' | 'soon' | 'expired'

function getRecordPermitState(record: WelderStampRecord): PermitState {
  const values = getWelderStampNaksPermits(record)
    .map((permit) => permit.validTo)
    .filter(Boolean)
    .sort()
  const nearest = values[0]
  if (!nearest) return 'active'

  const today = new Date().toISOString().slice(0, 10)
  if (nearest < today) return 'expired'

  const daysLeft = Math.ceil((new Date(`${nearest}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000)
  return daysLeft <= 30 ? 'soon' : 'active'
}

function PermitStateIcon({ state }: { state: PermitState }) {
  const Icon = state === 'expired' ? ShieldAlert : state === 'soon' ? CalendarClock : ShieldCheck
  const className = state === 'expired' ? 'text-rose-600' : state === 'soon' ? 'text-amber-600' : 'text-emerald-600'
  return <Icon className={`h-4 w-4 ${className}`} />
}

function RecordStatusBadge({ archived }: { archived: boolean }) {
  if (archived) {
    return <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-500">в архиве</span>
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" />
      активен
    </span>
  )
}
