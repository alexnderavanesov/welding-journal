import type { WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { migrateLegacyWeldFieldRecordKeys } from '@/lib/weld-fields'
import type { WeldImportScopeRequest } from '@/server/weld-contracts'
import { sql, type SQLWrapper } from 'drizzle-orm'
import {
  CONTROL_ASSIGNMENT_FIELD_KEYS,
  normalizeControlAvailabilityFilterValue,
} from '@/lib/control-availability-values'

const CONTROL_COLUMN_KEYS = {
  ВИК: 'hasVik',
  РК: 'hasRk',
  ПВК: 'hasPvk',
  УЗК: 'hasUzk',
  ТВМТ: 'pstoRequired',
} as const

export type DuplicateControlCarrier = {
  id: number
  duplicateControls?: DuplicateControlRecord[]
}

export function compactWeldRowsForTransport<Row extends DuplicateControlCarrier>(rows: Row[]): WeldRow[] {
  return rows.map((row) => {
    const compact = Object.fromEntries(
      Object.entries(row as Record<string, unknown>)
        .map(([key, value]) => [
          key,
          CONTROL_ASSIGNMENT_FIELD_KEYS.has(key)
            ? normalizeControlAvailabilityFilterValue(value)
            : value,
        ] as const)
        .filter(([, value]) => value !== null && value !== undefined && value !== ''),
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
    columnFilters: migrateLegacyWeldFieldRecordKeys(Object.fromEntries(
      Object.entries(data?.columnFilters ?? {})
        .map(([key, value]) => [key, String(value ?? '').trim()] as const)
        .filter(([, value]) => value.length > 0),
    )),
  }
}

export function buildNumberArrayMatch(column: SQLWrapper, values: readonly number[]) {
  if (values.length === 0) return sql`false`
  return sql`${column} = any(${sql.param(values)}::integer[])`
}

export function buildIncludedRowsFirstOrder(column: SQLWrapper, values: readonly number[]) {
  return sql`case when ${buildNumberArrayMatch(column, values)} then 0 else 1 end`
}

export function buildTextArrayMatch(column: SQLWrapper, values: readonly string[]) {
  if (values.length === 0) return sql`false`
  return sql`${column} = any(${sql.param(values)}::text[])`
}
