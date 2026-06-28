import type { WelderStampExpiryTask } from '@/lib/dispatcher-types'
import {
  DAY_IN_MS as dayInMs,
  WELDER_STAMP_EXPIRY_REMINDER_DAYS as welderStampExpiryReminderDays,
} from '@/lib/report-config'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export function buildWelderStampExpiryTasks(records: WelderStampRecord[]): WelderStampExpiryTask[] {
  const today = parseIsoDateStart(getTodayIsoDate())
  if (!today) return []

  return records.flatMap((record) => {
    const naksStamp = record.naksStamp.trim()
    const validTo = record.validTo.trim()
    const validToDate = parseIsoDateStart(validTo)
    if (record.archived || !naksStamp || !validToDate) return []

    const daysLeft = Math.ceil((validToDate.getTime() - today.getTime()) / dayInMs)
    if (daysLeft > welderStampExpiryReminderDays) return []

    return [
      {
        kind: 'welder-stamp-expiry' as const,
        key: `welder-stamp-expiry:${record.id}:${naksStamp}:${validTo}`,
        stamp: record,
        naksStamp,
        validTo,
        daysLeft,
        expired: daysLeft < 0,
      },
    ]
  })
}

function parseIsoDateStart(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}
