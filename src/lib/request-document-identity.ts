import { formatDisplayDate } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/report-config'

export type RequestDocumentIdentity = {
  key: string
  name: string
  date: string
  label: string
}

export function createRequestDocumentIdentity(nameValue: unknown, dateValue: unknown): RequestDocumentIdentity | null {
  const name = String(nameValue ?? '').trim()
  if (!name) return null
  const date = String(dateValue ?? '').trim()
  return {
    key: JSON.stringify([name, date]),
    name,
    date,
    label: date ? `${name} · ${formatDisplayDate(date)}` : name,
  }
}

export function getLnkRequestDocumentIdentities(rows: WeldRow[]) {
  return collectRequestDocumentIdentities(
    rows.flatMap((row) =>
      LNK_METHODS.flatMap((method) => {
        const identity = createRequestDocumentIdentity(row[method.requestKey], row[method.requestDateKey])
        return identity ? [identity] : []
      }),
    ),
  )
}

export function getPstoRequestDocumentIdentities(rows: WeldRow[]) {
  return collectRequestDocumentIdentities(
    rows.flatMap((row) => {
      const identity = createRequestDocumentIdentity(row.pstoRequest, row.pstoRequestDate)
      return identity ? [identity] : []
    }),
  )
}

export function findRequestDocumentIdentity(
  options: RequestDocumentIdentity[],
  nameValue?: string,
  dateValue?: string,
) {
  const name = String(nameValue ?? '').trim()
  const date = String(dateValue ?? '').trim()
  if (name && date) {
    const exact = options.find((option) => option.name === name && option.date === date)
    if (exact) return exact
    return options[0] ?? null
  }
  if (name) {
    const byName = options.find((option) => option.name === name)
    if (byName) return byName
  }
  return options[0] ?? null
}

export function filterRequestDocumentIdentitiesBySearch(
  options: RequestDocumentIdentity[],
  searchValue: string,
) {
  const search = searchValue.trim().toLocaleLowerCase('ru')
  if (!search) return options
  return options.filter((option) => option.label.toLocaleLowerCase('ru').includes(search))
}

export function withCurrentRequestDocumentIdentity(
  options: RequestDocumentIdentity[],
  current: Pick<RequestDocumentIdentity, 'name' | 'date'>,
) {
  const identity = createRequestDocumentIdentity(current.name, current.date)
  if (!identity || options.some((option) => option.key === identity.key)) return options
  return [identity, ...options]
}

export function isSameRequestDocument(
  nameValue: unknown,
  dateValue: unknown,
  identity: Pick<RequestDocumentIdentity, 'name' | 'date'>,
) {
  return (
    String(nameValue ?? '').trim() === identity.name &&
    String(dateValue ?? '').trim() === identity.date
  )
}

export function collectRequestDocumentIdentities(identities: RequestDocumentIdentity[]) {
  const unique = new Map(identities.map((identity) => [identity.key, identity]))
  return [...unique.values()].sort((left, right) => {
    const dateOrder = right.date.localeCompare(left.date, 'ru', { numeric: true })
    if (dateOrder !== 0) return dateOrder
    return left.name.localeCompare(right.name, 'ru', { numeric: true })
  })
}
