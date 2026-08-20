import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import {
  collectRequestDocumentIdentities,
  createRequestDocumentIdentity,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type LnkRequestNavigationEntry = RequestDocumentIdentity & {
  methodCodes: string[]
}

export function getLnkRequestIdentityForField(
  row: WeldRow,
  fieldKey?: WeldFieldKey,
): LnkRequestNavigationEntry | null {
  if (!fieldKey) return null
  const method = LNK_METHODS.find((candidate) =>
    candidate.requestKey === fieldKey || candidate.requestDateKey === fieldKey,
  )
  if (!method) return null
  const identity = createRequestDocumentIdentity(row[method.requestKey], row[method.requestDateKey])
  return identity ? { ...identity, methodCodes: [method.code] } : null
}

export function getLnkRequestNavigationEntries(rows: WeldRow[]): LnkRequestNavigationEntry[] {
  const methodCodesByKey = new Map<string, Set<string>>()
  const identities: RequestDocumentIdentity[] = []

  for (const row of rows) {
    for (const method of LNK_METHODS) {
      const identity = createRequestDocumentIdentity(row[method.requestKey], row[method.requestDateKey])
      if (!identity) continue
      identities.push(identity)
      const methodCodes = methodCodesByKey.get(identity.key) ?? new Set<string>()
      methodCodes.add(method.code)
      methodCodesByKey.set(identity.key, methodCodes)
    }
  }

  return collectRequestDocumentIdentities(identities).map((identity) => ({
    ...identity,
    methodCodes: [...(methodCodesByKey.get(identity.key) ?? [])],
  }))
}

export function formatLnkRequestNavigationLabel(entry: LnkRequestNavigationEntry) {
  const methodLabel = entry.methodCodes.join('/')
  return methodLabel ? `${methodLabel} · ${entry.label}` : entry.label
}
