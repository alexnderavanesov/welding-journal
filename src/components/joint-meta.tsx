import { formatDisplayDate } from '@/lib/date-format'
import { formatJointDiameterLabel, isUnofficialJoint } from '@/lib/joint-display'
import { getJointTitle } from '@/lib/report-ui-state'
import { cn } from '@/lib/utils'
import type { WeldInput } from '@/lib/weld-fields'

export function MetaSeparator() {
  return <span className="mx-1 text-sm font-semibold leading-none text-slate-400">·</span>
}

export function JointSpoolDiameterMeta({ row }: { row: WeldInput }) {
  const spool = String(row.spool ?? '').trim()
  return (
    <>
      {spool ? (
        <>
          <span className="font-semibold text-slate-700">{spool}</span>
          <MetaSeparator />
        </>
      ) : null}
      <span>Диаметр - </span>
      <span className="font-semibold text-slate-700">{formatJointDiameterLabel(row)}</span>
    </>
  )
}

export function JointWeldDateMeta({ row }: { row: WeldInput }) {
  return (
    <>
      Дата сварки: <span className="font-semibold text-slate-700">{formatDisplayDate(row.weldDate) || '-'}</span>
    </>
  )
}

export function JointProjectSubtitleMeta({ row }: { row: WeldInput }) {
  return (
    <>
      Проект: <span className="font-semibold text-slate-700">{String(row.projectTitle ?? '-') || '-'}</span>
      <MetaSeparator />
      Шифр:{' '}
      <span className="font-semibold text-slate-700">{String(row.subtitleCode ?? '-') || '-'}</span>
    </>
  )
}

export function JointTitleLine({
  row,
  className,
  truncate = false,
}: {
  row: WeldInput
  className?: string
  truncate?: boolean
}) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className={cn(truncate && 'truncate', className ?? 'font-medium text-slate-900')}>
        {getJointTitle(row)}
      </span>
      <OfficialityBadge row={row} compact />
    </span>
  )
}

export function OfficialityBadge({ row, compact = false }: { row: WeldInput; compact?: boolean }) {
  if (!isUnofficialJoint(row)) return null
  return (
    <span
      className={`inline-flex items-center rounded border border-slate-300 bg-slate-100 font-semibold text-slate-700 ${
        compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs'
      }`}
    >
      неофициальный
    </span>
  )
}
