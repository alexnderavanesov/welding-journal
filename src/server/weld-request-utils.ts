import type { WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import type { WeldImportScopeRequest } from '@/server/weld-contracts'

const CONTROL_COLUMN_KEYS = {
  ВИК: 'hasVik',
  РК: 'hasRk',
  ПВК: 'hasPvk',
  УЗК: 'hasUzk',
  ТВМТ: 'pstoRequired',
  РФА: 'hasRfa',
  СТЛС: 'hasStls',
  МКК: 'hasMkk',
} as const

export type DuplicateControlCarrier = {
  id: number
  duplicateControls?: DuplicateControlRecord[]
}

export function compactWeldRowsForTransport<Row extends DuplicateControlCarrier>(rows: Row[]): WeldRow[] {
  return rows.map((row) => {
    const compact = Object.fromEntries(
      Object.entries(row as Record<string, unknown>).filter(
        ([, value]) => value !== null && value !== undefined && value !== '',
      ),
    ) as WeldRow
    if (Array.isArray(compact.duplicateControls) && compact.duplicateControls.length === 0) {
      delete compact.duplicateControls
    }
    if (Array.isArray(compact.preHeatTreatmentControls) && compact.preHeatTreatmentControls.length === 0) {
      delete compact.preHeatTreatmentControls
    }
    if (Array.isArray(compact.pstoRepeatCycles) && compact.pstoRepeatCycles.length === 0) {
      delete compact.pstoRepeatCycles
    }
    return compact
  })
}

export function getControlMethodFilterColumnKey(method: string | undefined) {
  if (!method || !(method in CONTROL_COLUMN_KEYS)) return null
  return CONTROL_COLUMN_KEYS[method as keyof typeof CONTROL_COLUMN_KEYS]
}

export function normalizeWeldImportScopeRequest(
  data: WeldImportScopeRequest | undefined,
): Required<WeldImportScopeRequest> {
  return {
    columnFilters: Object.fromEntries(
      Object.entries(data?.columnFilters ?? {})
        .map(([key, value]) => [key, String(value ?? '').trim()] as const)
        .filter(([, value]) => value.length > 0),
    ),
  }
}

export function splitNumberBatches(values: readonly number[], batchSize: number) {
  return Array.from({ length: Math.ceil(values.length / batchSize) }, (_, index) =>
    values.slice(index * batchSize, (index + 1) * batchSize),
  )
}
