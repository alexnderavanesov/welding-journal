import { normalizeDateLikeForStorage } from '@/lib/date-format'
import { getWelderStampDateInputValidationReason } from '@/lib/welder-stamp-date-limits'
import {
  normalizeDlsPermit,
  normalizeNaksPermit,
  validateDlsPermit,
  validateNaksPermit,
  withWelderStampPermitSummary,
} from '@/lib/welder-stamp-permits'
import { isValidNaksStamp, normalizeNaksStamp } from '@/lib/welder-stamp-registry'
import {
  normalizeWelderStampSuspensionRecord,
  validateWelderStampSuspensionRecord,
} from '@/lib/welder-stamp-suspensions'
import type {
  WelderStampDlsPermit,
  WelderStampNaksPermit,
  WelderStampRecord,
  WelderStampSuspensionRecord,
} from '@/lib/welder-stamp-types'

type UnknownRecord = Record<string, unknown>

export function prepareWelderStampRecordsForPersistence(value: unknown): WelderStampRecord[] {
  if (!Array.isArray(value)) throw new Error('Справочник клейм должен быть списком записей.')

  const ids = new Set<number>()
  return value.map((entry, index) => {
    const source = asRecord(entry, `Клеймо ${index + 1}`)
    const id = parsePositiveIntegerId(source.id, `Клеймо ${index + 1}`)
    assertUniqueId(ids, id, 'клейма')

    const naksPermits = prepareNaksPermits(source.naksPermits, index)
    const dlsPermits = prepareDlsPermits(source.dlsPermits, index)
    const naksStamp = normalizeNaksStamp(String(source.naksStamp ?? ''))
    const internalStamp = String(source.internalStamp ?? '').trim()
    if (!naksStamp && !internalStamp) {
      throw new Error(`Клеймо ${index + 1}: укажите Клеймо НАКС или Клеймо внутреннее.`)
    }
    if (naksStamp && !isValidNaksStamp(naksStamp)) {
      throw new Error(`Клеймо ${index + 1}: Клеймо НАКС должно состоять из 4 латинских букв или цифр.`)
    }
    if (naksStamp && naksPermits.length === 0) {
      throw new Error(`Клеймо ${index + 1}: добавьте хотя бы один допуск НАКС.`)
    }

    for (const [permitIndex, permit] of naksPermits.entries()) {
      const reason = validateNaksPermit(permit, permitIndex)
      if (reason) throw new Error(`Клеймо ${index + 1}: ${reason}.`)
    }
    for (const [permitIndex, permit] of dlsPermits.entries()) {
      const reason = validateDlsPermit(permit, permitIndex, naksPermits)
      if (reason) throw new Error(`Клеймо ${index + 1}: ${reason}.`)
    }

    const archived = Boolean(source.archived)
    const archivedAt = archived ? normalizeDateLikeForStorage(source.archivedAt) ?? '' : ''
    if (archived && !archivedAt) {
      throw new Error(`Клеймо ${index + 1}: укажите дату архивации клейма.`)
    }
    const archivedAtReason = archivedAt
      ? getWelderStampDateInputValidationReason(archivedAt, `Клеймо ${index + 1}: дата архивации`)
      : ''
    if (archivedAtReason) throw new Error(archivedAtReason)

    return withWelderStampPermitSummary({
      id,
      naksStamp,
      welderName: String(source.welderName ?? '').trim(),
      internalStamp,
      weldType: '',
      materialGroups: '',
      diameterFrom: '',
      diameterTo: '',
      thicknessFrom: '',
      thicknessTo: '',
      validFrom: '',
      validTo: '',
      naksPermits,
      dlsPermits,
      archived,
      archivedAt,
    })
  })
}

export function prepareWelderStampSuspensionsForPersistence(value: unknown): WelderStampSuspensionRecord[] {
  if (!Array.isArray(value)) throw new Error('История отстранений должна быть списком записей.')

  const ids = new Set<number>()
  return value.map((entry, index) => {
    const source = asRecord(entry, `Отстранение ${index + 1}`)
    const id = parsePositiveIntegerId(source.id, `Отстранение ${index + 1}`)
    assertUniqueId(ids, id, 'отстранения')
    const prepared = normalizeWelderStampSuspensionRecord({
      id,
      naksStamp: String(source.naksStamp ?? ''),
      suspendedFrom: String(source.suspendedFrom ?? ''),
      suspendedTo: String(source.suspendedTo ?? ''),
    })
    const reason = validateWelderStampSuspensionRecord(prepared)
    if (reason) throw new Error(`Отстранение ${index + 1}: ${reason}.`)
    return prepared
  })
}

export function assertWelderStampSuspensionsReferenceRegistry(
  suspensions: readonly WelderStampSuspensionRecord[],
  stamps: readonly Pick<WelderStampRecord, 'naksStamp'>[],
) {
  const availableStamps = new Set(
    stamps
      .map((record) => normalizeNaksStamp(record.naksStamp))
      .filter(Boolean),
  )

  for (const [index, suspension] of suspensions.entries()) {
    if (!availableStamps.has(normalizeNaksStamp(suspension.naksStamp))) {
      throw new Error(
        `Отстранение ${index + 1}: официальное клеймо ${suspension.naksStamp} отсутствует в справочнике клейм.`,
      )
    }
  }
}

function prepareNaksPermits(value: unknown, recordIndex: number) {
  if (!Array.isArray(value)) throw new Error(`Клеймо ${recordIndex + 1}: допуски НАКС должны быть списком.`)
  const ids = new Set<string>()
  return value.map((entry, permitIndex) => {
    const permit = normalizeNaksPermit(toNaksPermit(entry, recordIndex, permitIndex))
    assertUniquePermitId(ids, permit.id, `Клеймо ${recordIndex + 1}: НАКС`)
    return permit
  })
}

function prepareDlsPermits(value: unknown, recordIndex: number) {
  if (!Array.isArray(value)) throw new Error(`Клеймо ${recordIndex + 1}: допуски ДЛС должны быть списком.`)
  const ids = new Set<string>()
  return value.map((entry, permitIndex) => {
    const permit = normalizeDlsPermit(toDlsPermit(entry, recordIndex, permitIndex))
    assertUniquePermitId(ids, permit.id, `Клеймо ${recordIndex + 1}: ДЛС`)
    return permit
  })
}

function toNaksPermit(value: unknown, recordIndex: number, permitIndex: number): WelderStampNaksPermit {
  const source = asRecord(value, `Клеймо ${recordIndex + 1}: НАКС ${permitIndex + 1}`)
  const id = String(source.id ?? '').trim()
  if (!id) throw new Error(`Клеймо ${recordIndex + 1}: НАКС ${permitIndex + 1}: отсутствует системный ID допуска.`)
  return {
    id,
    weldType: String(source.weldType ?? ''),
    materialGroups: String(source.materialGroups ?? ''),
    diameterFrom: String(source.diameterFrom ?? ''),
    diameterTo: String(source.diameterTo ?? ''),
    thicknessFrom: String(source.thicknessFrom ?? ''),
    thicknessTo: String(source.thicknessTo ?? ''),
    validFrom: String(source.validFrom ?? ''),
    validTo: String(source.validTo ?? ''),
    note: String(source.note ?? ''),
    archived: Boolean(source.archived),
  }
}

function toDlsPermit(value: unknown, recordIndex: number, permitIndex: number): WelderStampDlsPermit {
  const source = asRecord(value, `Клеймо ${recordIndex + 1}: ДЛС ${permitIndex + 1}`)
  const id = String(source.id ?? '').trim()
  if (!id) throw new Error(`Клеймо ${recordIndex + 1}: ДЛС ${permitIndex + 1}: отсутствует системный ID допуска.`)
  return {
    ...toNaksPermit({ ...source, id }, recordIndex, permitIndex),
    number: String(source.number ?? ''),
  }
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: запись имеет неверный формат.`)
  }
  return value as UnknownRecord
}

function parsePositiveIntegerId(value: unknown, label: string) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label}: неверный системный ID.`)
  return id
}

function assertUniqueId(ids: Set<number>, id: number, label: string) {
  if (ids.has(id)) throw new Error(`В списке ${label} повторяется системный ID ${id}.`)
  ids.add(id)
}

function assertUniquePermitId(ids: Set<string>, id: string, label: string) {
  if (ids.has(id)) throw new Error(`${label}: повторяется системный ID допуска ${id}.`)
  ids.add(id)
}
