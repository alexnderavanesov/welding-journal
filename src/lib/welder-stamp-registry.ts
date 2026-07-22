import {
  formatWelderStampDate,
  normalizeWelderStampMaterialGroups,
  normalizeWelderStampWeldType,
} from '@/lib/welder-stamp-format'
import { loadDataListSettings } from '@/lib/data-list-settings'
import { getDateInputValidationReason, normalizeDateLikeForStorage } from '@/lib/date-format'
import { parseWelderStampNumber } from '@/lib/welder-stamp-number'
import {
  createEmptyNaksPermit,
  getAllWelderStampDlsPermits,
  getAllWelderStampNaksPermits,
  getWelderStampDlsPermits,
  getWelderStampNaksPermits,
  normalizeDlsPermit,
  normalizeNaksPermit,
  validateDlsPermit,
  validateNaksPermit,
  withWelderStampPermitSummary,
} from '@/lib/welder-stamp-permits'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export function createEmptyWelderStampDraft(): WelderStampRecord {
  return {
    id: 0,
    naksStamp: '',
    welderName: '',
    internalStamp: '',
    weldType: '',
    materialGroups: '',
    diameterFrom: '',
    diameterTo: '',
    thicknessFrom: '',
    thicknessTo: '',
    validFrom: '',
    validTo: '',
    naksPermits: [createEmptyNaksPermit()],
    dlsPermits: [],
    archived: false,
  }
}

export function normalizeWelderStampRecord(record: WelderStampRecord): WelderStampRecord {
  const naksPermits = getAllWelderStampNaksPermits(record).map(normalizeNaksPermit)
  const dlsPermits = getAllWelderStampDlsPermits(record).map(normalizeDlsPermit)
  return withWelderStampPermitSummary({
    ...record,
    naksStamp: normalizeNaksStamp(record.naksStamp),
    welderName: String(record.welderName ?? '').trim(),
    internalStamp: record.internalStamp.trim(),
    weldType: normalizeWelderStampWeldType(record.weldType),
    materialGroups: normalizeWelderStampMaterialGroups(record.materialGroups),
    diameterFrom: record.diameterFrom.trim(),
    diameterTo: record.diameterTo.trim(),
    thicknessFrom: String(record.thicknessFrom ?? '').trim(),
    thicknessTo: String(record.thicknessTo ?? '').trim(),
    validFrom: normalizeDateLikeForStorage(record.validFrom) ?? '',
    validTo: normalizeDateLikeForStorage(record.validTo) ?? '',
    naksPermits,
    dlsPermits,
    archived: Boolean(record.archived),
  })
}

export function normalizeWelderStampRecordsForRegistry(records: WelderStampRecord[]) {
  const prepared = records.map(normalizeWelderStampRecord)
  const cards = new Map<string, WelderStampRecord>()
  const result: WelderStampRecord[] = []

  for (const record of prepared) {
    const key = record.naksStamp ? `naks:${record.naksStamp}` : `id:${record.id}`
    const existing = cards.get(key)
    if (!existing) {
      cards.set(key, record)
      result.push(record)
      continue
    }

    const merged = normalizeWelderStampRecord({
      ...existing,
      welderName: existing.welderName || record.welderName,
      internalStamp: joinUniqueText([existing.internalStamp, record.internalStamp]),
      naksPermits: [...existing.naksPermits, ...record.naksPermits],
      dlsPermits: [...existing.dlsPermits, ...record.dlsPermits],
      archived: existing.archived && record.archived,
    })
    cards.set(key, merged)
    const index = result.findIndex((candidate) => candidate.id === existing.id)
    if (index >= 0) result[index] = merged
  }

  return result
}

export function normalizeNaksStamp(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()
}

export function isValidNaksStamp(value: string) {
  return /^[A-Z0-9]{4}$/.test(value)
}

export function getWelderNameByNaks(records: WelderStampRecord[], naksStamp: string, excludedId: number | null = null) {
  const normalizedStamp = normalizeNaksStamp(naksStamp)
  if (!normalizedStamp) return ''

  return (
    records.find(
      (record) =>
        record.id !== excludedId &&
        normalizeNaksStamp(record.naksStamp) === normalizedStamp &&
        String(record.welderName ?? '').trim(),
    )?.welderName.trim() ?? ''
  )
}

export function getWelderStampNameSyncHint(records: WelderStampRecord[], record: WelderStampRecord, editingId: number | null) {
  const draft = normalizeWelderStampRecord(record)
  if (!draft.naksStamp) return ''

  const existingName = getWelderNameByNaks(records, draft.naksStamp, editingId)
  if (!existingName) return ''
  if (!draft.welderName) {
    return `Для клейма ${draft.naksStamp} уже указано ФИО: ${existingName}. Оно будет использовано при сохранении.`
  }
  if (draft.welderName !== existingName) {
    return `При сохранении ФИО для клейма ${draft.naksStamp} будет обновлено во всех строках этого клейма.`
  }

  return ''
}

export function validateWelderStampRecord(record: WelderStampRecord) {
  const hasNaksStamp = Boolean(record.naksStamp)
  const naksPermits = getWelderStampNaksPermits(record)
  const dlsPermits = getWelderStampDlsPermits(record)

  if (hasNaksStamp && naksPermits.length === 0) return 'Добавьте хотя бы один допуск НАКС'
  for (const [index, permit] of naksPermits.entries()) {
    const validationError = validateNaksPermit(permit, index)
    if (validationError) return validationError
  }
  for (const [index, permit] of dlsPermits.entries()) {
    const validationError = validateDlsPermit(permit, index, naksPermits)
    if (validationError) return validationError
  }

  const diameterFrom = record.diameterFrom ? parseWelderStampNumber(record.diameterFrom) : null
  const diameterTo = record.diameterTo ? parseWelderStampNumber(record.diameterTo) : null

  if (diameterFrom === null && record.diameterFrom) return 'Диаметр от должен быть числом'
  if (diameterTo === null && record.diameterTo) return 'Диаметр до должен быть числом'
  const validFromReason = record.validFrom ? getDateInputValidationReason(record.validFrom, 'Срок действия от') : ''
  if (validFromReason) return validFromReason
  const validToReason = record.validTo ? getDateInputValidationReason(record.validTo, 'Срок действия до') : ''
  if (validToReason) return validToReason
  if (diameterFrom !== null && diameterTo !== null && diameterFrom > diameterTo) {
    return 'Диапазон диаметра заполнен некорректно: значение «от» больше значения «до»'
  }
  if (record.validFrom && record.validTo && record.validFrom > record.validTo) {
    return 'Срок действия заполнен некорректно: дата «от» позже даты «до»'
  }

  return ''
}

export function prepareWelderStampSave(
  records: WelderStampRecord[],
  record: WelderStampRecord,
  editingId: number | null,
) {
  const draft = normalizeWelderStampRecord(record)
  const existingWelderName = getWelderNameByNaks(records, draft.naksStamp, editingId)
  if (draft.naksStamp && !draft.welderName && existingWelderName) {
    draft.welderName = existingWelderName
  }

  if (!draft.naksStamp && !draft.internalStamp) {
    return { ok: false as const, message: 'Укажите Клеймо НАКС или Клеймо внутреннее' }
  }
  if (draft.naksStamp && !isValidNaksStamp(draft.naksStamp)) {
    return { ok: false as const, message: 'Клеймо НАКС должно состоять из 4 латинских букв или цифр' }
  }

  const validationError = validateWelderStampRecord(draft)
  if (validationError) return { ok: false as const, message: validationError }

  const nextRecords =
    editingId !== null
      ? records.map((current) => (current.id === editingId ? { ...draft, id: editingId } : current))
      : [{ ...draft, id: Math.max(0, ...records.map((current) => current.id)) + 1 }, ...records]

  const syncedRecords = syncWelderNameForNaks(nextRecords, draft.naksStamp, draft.welderName)
  const hasSyncedNames =
    Boolean(draft.naksStamp && draft.welderName) &&
    records.some(
      (current) =>
        normalizeNaksStamp(current.naksStamp) === draft.naksStamp &&
        current.id !== editingId &&
        String(current.welderName ?? '').trim() !== draft.welderName,
    )

  return {
    ok: true as const,
    nextRecords: syncedRecords,
    message: `${editingId !== null ? 'Клеймо обновлено' : 'Клеймо добавлено'}${
      hasSyncedNames ? `. ФИО синхронизировано по всем строкам ${draft.naksStamp}` : ''
    }`,
  }
}

function syncWelderNameForNaks(records: WelderStampRecord[], naksStamp: string, welderName: string) {
  const normalizedStamp = normalizeNaksStamp(naksStamp)
  if (!normalizedStamp) return records

  return records.map((record) =>
    normalizeNaksStamp(record.naksStamp) === normalizedStamp ? { ...record, welderName } : record,
  )
}

function joinUniqueText(values: string[]) {
  return [...new Set(values.flatMap((value) => String(value ?? '').split(/[;,]+/).map((part) => part.trim())).filter(Boolean))].join(', ')
}

export function setWelderStampRecordArchived(records: WelderStampRecord[], id: number, archived: boolean) {
  return records.map((record) => (record.id === id ? { ...record, archived } : record))
}

export function removeWelderStampRecord(records: WelderStampRecord[], id: number) {
  return records.filter((record) => record.id !== id)
}

export function getWelderStampFormHint(record: WelderStampRecord) {
  const draft = normalizeWelderStampRecord(record)
  const defaultHint =
    'Клеймо НАКС: 4 знака, только латинские буквы и цифры. ФИО синхронизируется по Клеймо НАКС. В карточке можно вести несколько допусков НАКС и ДЛС; ДЛС не может выходить за границы НАКС. Если заполнено только внутреннее клеймо, допуски можно не указывать.'

  if (!draft.naksStamp && !draft.internalStamp) return { kind: 'info' as const, text: defaultHint }
  if (draft.naksStamp && !isValidNaksStamp(draft.naksStamp)) {
    return { kind: 'error' as const, text: 'Клеймо НАКС должно состоять из 4 латинских букв или цифр' }
  }

  const validationError = validateWelderStampRecord(draft)
  return validationError ? { kind: 'error' as const, text: validationError } : { kind: 'info' as const, text: defaultHint }
}
