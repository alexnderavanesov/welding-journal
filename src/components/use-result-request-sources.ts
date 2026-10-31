import { useMemo, useState } from 'react'
import type { ResultRequestSource } from '@/lib/result-request-sources'

export function useResultRequestSources<T extends { id: number }>(rows: T[], groups: ResultRequestSource[], showSelected: () => void) {
  const [key, setKey] = useState<string | null>(null)
  const active = groups.find(group => group.key === key)
  const filteredRows = useMemo(() => active ? rows.filter(row => active.rowIds.has(row.id)) : rows, [rows, active])
  return {
    rows: filteredRows,
    clear: () => setKey(null),
    sourceProps: {
      groups,
      activeKey: active?.key ?? null,
      onSelect: (value: string | null) => { setKey(value); showSelected() },
    },
  }
}
