import { useEffect, useMemo, useRef } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'

export type WorkflowRowPage = WeldRow[] | { scope: string; rows: WeldRow[]; includedRowIds: number[] }

export async function readWorkflowRowPage<Request extends { scope: string; includeRowIds?: number[] | null }>(
  request: Request,
  read: (request: Request) => Promise<WeldRow[]>,
): Promise<WorkflowRowPage> {
  const rows = await read(request)
  return request.scope.endsWith('Candidates')
    ? { scope: request.scope, rows, includedRowIds: request.includeRowIds ?? [] }
    : rows
}

export function useWorkflowCandidatePage(
  page: WorkflowRowPage | undefined,
  selectedIds: readonly number[] | null | undefined,
  settled: boolean,
  refetch: () => Promise<unknown>,
) {
  const rows = Array.isArray(page) ? page : page?.rows
  const coveredIds = useMemo(() => {
    if (!page || Array.isArray(page)) return null
    return new Set([...page.includedRowIds, ...page.rows.map(row => row.id)])
  }, [page])
  // A checkbox can change while a search is in flight. Absence is authoritative
  // only for IDs the server was asked to include with that search.
  const incomplete = Boolean(coveredIds && selectedIds?.some(id => !coveredIds.has(id)))
  const candidate = page && !Array.isArray(page) ? page : undefined
  const previousPage = useRef<typeof candidate>(undefined)
  useEffect(() => {
    if (!incomplete) previousPage.current = candidate
  }, [candidate, incomplete])
  useEffect(() => {
    if (incomplete && settled) void refetch()
  }, [incomplete, settled, refetch])
  return {
    data: incomplete && previousPage.current && previousPage.current.scope === candidate?.scope
      ? previousPage.current.rows
      : rows,
    isContextReady: settled && !incomplete,
  }
}
