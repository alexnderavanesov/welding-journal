import type { WelderStampExpiryTask } from '@/lib/dispatcher-types'
import {
  DAY_IN_MS as dayInMs,
  WELDER_STAMP_EXPIRY_REMINDER_DAYS as welderStampExpiryReminderDays,
} from '@/lib/report-config'
import { normalizeDispatcherReminderDays, type DispatcherReminderSettings } from '@/lib/dispatcher-settings'
import { getWelderStampDlsPermits, getWelderStampNaksPermits } from '@/lib/welder-stamp-permits'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export function buildWelderStampExpiryTasks(records: WelderStampRecord[], reminderSettings?: Partial<DispatcherReminderSettings>): WelderStampExpiryTask[] {
  const today = parseIsoDateStart(getTodayIsoDate())
  if (!today) return []
  const naksReminderDays = normalizeDispatcherReminderDays(reminderSettings?.['welder-stamp-expiry'], welderStampExpiryReminderDays)
  const dlsReminderDays = normalizeDispatcherReminderDays(reminderSettings?.['welder-dls-expiry'], welderStampExpiryReminderDays)

  return records.flatMap((record) => {
    const naksStamp = record.naksStamp.trim()
    if (record.archived || !naksStamp) return []

    const naksTasks = getWelderStampNaksPermits(record).flatMap((permit, index) =>
      buildExpiryTask({
        record,
        today,
        permitKind: 'naks',
        permitId: permit.id,
        permitNumber: String(index + 1),
        naksStamp,
        validTo: permit.validTo,
        reminderDays: naksReminderDays,
      }),
    )
    const dlsTasks = getWelderStampDlsPermits(record).flatMap((permit) =>
      buildExpiryTask({
        record,
        today,
        permitKind: 'dls',
        permitId: permit.id,
        permitNumber: permit.number,
        naksStamp,
        validTo: permit.validTo,
        reminderDays: dlsReminderDays,
      }),
    )

    return [...naksTasks, ...dlsTasks]
  }).sort((left, right) => left.daysLeft - right.daysLeft || left.naksStamp.localeCompare(right.naksStamp, 'ru'))
}

function buildExpiryTask({
  record,
  today,
  permitKind,
  permitId,
  permitNumber,
  naksStamp,
  validTo,
  reminderDays,
}: {
  record: WelderStampRecord
  today: Date
  permitKind: 'naks' | 'dls'
  permitId: string
  permitNumber?: string
  naksStamp: string
  validTo: string
  reminderDays: number
}): WelderStampExpiryTask[] {
  const preparedValidTo = validTo.trim()
  const validToDate = parseIsoDateStart(preparedValidTo)
  if (!validToDate) return []

  const daysLeft = Math.ceil((validToDate.getTime() - today.getTime()) / dayInMs)
  if (daysLeft > reminderDays) return []

  return [
    {
      kind: 'welder-stamp-expiry',
      key: `welder-stamp-expiry:${permitKind}:${record.id}:${naksStamp}:${permitId}:${preparedValidTo}`,
      stamp: record,
      permitKind,
      permitNumber: permitNumber?.trim() || undefined,
      naksStamp,
      validTo: preparedValidTo,
      daysLeft,
      expired: daysLeft < 0,
    },
  ]
}

function parseIsoDateStart(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}
