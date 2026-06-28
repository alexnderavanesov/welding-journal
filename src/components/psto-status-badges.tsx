import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointStatusBadgeClass, getJointStatusLabel } from '@/lib/lnk-status'
import { getPstoResultBadgeClass, getPstoResultLabel } from '@/lib/report-badges'

type PstoStatusBadgeProps = {
  row: WeldRow
}

export function PstoJointStatusBadge({ row }: PstoStatusBadgeProps) {
  return (
    <span className={`rounded border px-1.5 py-0.5 font-semibold ${getJointStatusBadgeClass(row)}`}>
      Стык: {getJointStatusLabel(row)}
    </span>
  )
}

export function PstoResultStatusBadge({ row }: PstoStatusBadgeProps) {
  return (
    <span className={`rounded border px-1.5 py-0.5 font-semibold ${getPstoResultBadgeClass(row.pstoResult)}`}>
      ПСТО: {getPstoResultLabel(row.pstoResult)}
    </span>
  )
}

export function PstoManagerJointStatusBadge({ row }: PstoStatusBadgeProps) {
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getJointStatusBadgeClass(row)}`}>
      Стык: {getJointStatusLabel(row)}
    </span>
  )
}

export function PstoManagerResultStatusBadge({ row }: PstoStatusBadgeProps) {
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getPstoResultBadgeClass(row.pstoResult)}`}>
      ПСТО: {getPstoResultLabel(row.pstoResult)}
    </span>
  )
}

export function PstoCurrentResultBadge({ row }: PstoStatusBadgeProps) {
  return (
    <span className={`rounded border px-2 py-1 text-xs font-semibold ${getPstoResultBadgeClass(row.pstoResult)}`}>
      Сейчас: {getPstoResultLabel(row.pstoResult)}
    </span>
  )
}
