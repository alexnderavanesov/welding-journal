import type { RequestDocumentIdentity } from './request-document-identity'

export type ResultRequestSource = RequestDocumentIdentity & { rowIds: Set<number> }

export function collectResultRequestSources<T extends { id: number }>(
  rows: readonly T[], getRequests: (rows: T[]) => RequestDocumentIdentity[],
): ResultRequestSource[] {
  const sources = new Map<string, ResultRequestSource>()
  for (const row of rows) for (const request of getRequests([row])) {
    const source = sources.get(request.key) ?? { ...request, rowIds: new Set<number>() }
    source.rowIds.add(row.id)
    sources.set(request.key, source)
  }
  return [...sources.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }))
}
