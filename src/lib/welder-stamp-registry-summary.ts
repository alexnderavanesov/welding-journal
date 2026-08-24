import { getTodayIsoDate } from '@/lib/date-format'
import { getWelderStampNaksPermits } from '@/lib/welder-stamp-permits'
import { validateWelderStampRecord } from '@/lib/welder-stamp-registry'
import { getSuspensionOverlapForStamp } from '@/lib/welder-stamp-suspensions'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export type WelderStampRegistryStatus =
  | 'all'
  | 'active'
  | 'soon'
  | 'expired'
  | 'archived'
  | 'suspended'
  | 'incomplete'

export type WelderStampRegistrySummary = Record<WelderStampRegistryStatus, number>

type WelderStampRegistryContext = {
  suspensions: readonly WelderStampSuspensionRecord[]
  today?: string
}

function getPermitStatus(record: WelderStampRecord, today: string) {
  const validToDates = getWelderStampNaksPermits(record)
    .map((permit) => permit.validTo)
    .filter(Boolean)
    .sort()
  const nearest = validToDates[0]
  if (!nearest) return 'active' as const
  if (nearest < today) return 'expired' as const

  const daysLeft = Math.ceil(
    (new Date(`${nearest}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000,
  )
  return daysLeft <= 30 ? 'soon' as const : 'active' as const
}

export function matchesWelderStampRegistryStatus(
  record: WelderStampRecord,
  status: WelderStampRegistryStatus,
  context: WelderStampRegistryContext,
) {
  if (status === 'all') return true
  if (status === 'archived') return record.archived

  const today = context.today ?? getTodayIsoDate()
  const incomplete = Boolean(validateWelderStampRecord(record))
  const suspended = Boolean(getSuspensionOverlapForStamp(context.suspensions, record.naksStamp, today))

  if (status === 'incomplete') return !record.archived && incomplete
  if (status === 'suspended') return !record.archived && suspended
  if (record.archived || incomplete || suspended) return false
  return getPermitStatus(record, today) === status
}

export function buildWelderStampRegistrySummary(
  records: readonly WelderStampRecord[],
  context: WelderStampRegistryContext,
): WelderStampRegistrySummary {
  const statuses: WelderStampRegistryStatus[] = [
    'active',
    'soon',
    'expired',
    'archived',
    'suspended',
    'incomplete',
  ]
  const summary: WelderStampRegistrySummary = {
    all: records.length,
    active: 0,
    soon: 0,
    expired: 0,
    archived: 0,
    suspended: 0,
    incomplete: 0,
  }
  statuses.forEach((status) => {
    summary[status] = records.filter((record) => matchesWelderStampRegistryStatus(record, status, context)).length
  })
  return summary
}
