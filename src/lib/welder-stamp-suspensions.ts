import { formatDisplayDate, getDateInputValidationReason, getTodayIsoDate, normalizeDateLikeForStorage } from '@/lib/date-format'
import { normalizeNaksStamp } from '@/lib/welder-stamp-registry'
import type { WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export function createEmptyWelderStampSuspensionDraft(): WelderStampSuspensionRecord {
  return {
    id: 0,
    naksStamp: '',
    suspendedFrom: '',
    suspendedTo: '',
  }
}

export function normalizeWelderStampSuspensionRecord(record: WelderStampSuspensionRecord): WelderStampSuspensionRecord {
  return {
    ...record,
    naksStamp: normalizeNaksStamp(record.naksStamp),
    suspendedFrom: normalizeDateLikeForStorage(record.suspendedFrom) ?? '',
    suspendedTo: normalizeDateLikeForStorage(record.suspendedTo) ?? '',
  }
}

export function validateWelderStampSuspensionRecord(record: WelderStampSuspensionRecord) {
  const draft = normalizeWelderStampSuspensionRecord(record)
  if (!draft.naksStamp) return 'Укажите Клеймо НАКС'
  if (draft.naksStamp.length !== 4) return 'Клеймо НАКС должно состоять из 4 латинских букв или цифр'
  if (!draft.suspendedFrom) return 'Укажите дату отстранения от'

  const fromReason = getDateInputValidationReason(draft.suspendedFrom, 'Дата отстранения от')
  if (fromReason) return fromReason
  const toReason = draft.suspendedTo ? getDateInputValidationReason(draft.suspendedTo, 'Дата отстранения до') : ''
  if (toReason) return toReason
  if (draft.suspendedTo && draft.suspendedFrom > draft.suspendedTo) {
    return 'Период отстранения заполнен некорректно: дата «от» позже даты «до»'
  }

  return ''
}

export function prepareWelderStampSuspensionSave(
  records: WelderStampSuspensionRecord[],
  record: WelderStampSuspensionRecord,
) {
  const draft = normalizeWelderStampSuspensionRecord(record)
  const validationError = validateWelderStampSuspensionRecord(draft)
  if (validationError) return { ok: false as const, message: validationError }

  const isExistingRecord = draft.id > 0 && records.some((current) => current.id === draft.id)
  if (isExistingRecord) {
    return {
      ok: true as const,
      nextRecords: records.map((current) => (current.id === draft.id ? draft : current)),
      message: 'Запись отстранения обновлена',
    }
  }

  const nextId = Math.max(0, ...records.map((current) => current.id)) + 1
  return {
    ok: true as const,
    nextRecords: [{ ...draft, id: nextId }, ...records],
    message: 'Запись отстранения добавлена',
  }
}

export function removeWelderStampSuspensionRecord(records: WelderStampSuspensionRecord[], id: number) {
  return records.filter((record) => record.id !== id)
}

export function getSuspensionOverlapForStamp(
  suspensions: readonly WelderStampSuspensionRecord[],
  stamp: unknown,
  weldDate: unknown,
) {
  const normalizedStamp = normalizeNaksStamp(String(stamp ?? ''))
  const normalizedWeldDate = normalizeDateLikeForStorage(weldDate) ?? ''
  if (!normalizedStamp || !normalizedWeldDate) return null

  return suspensions.find((record) => {
    const suspension = normalizeWelderStampSuspensionRecord(record)
    if (suspension.naksStamp !== normalizedStamp) return false
    const suspendedTo = suspension.suspendedTo || getTodayIsoDate()
    return suspension.suspendedFrom <= normalizedWeldDate && normalizedWeldDate <= suspendedTo
  }) ?? null
}

export function formatWelderStampSuspensionPeriod(record: WelderStampSuspensionRecord) {
  const from = formatDisplayDate(record.suspendedFrom) || '-'
  const to = record.suspendedTo ? formatDisplayDate(record.suspendedTo) : 'срок не указан'
  return `${from} - ${to}`
}

export function formatWelderStampSuspensionBlockReason(record: WelderStampSuspensionRecord) {
  return `клеймо отстранено с ${formatDisplayDate(record.suspendedFrom) || '-'} по ${
    record.suspendedTo ? formatDisplayDate(record.suspendedTo) : 'сегодня'
  }`
}
