import {
  normalizeOtherSettings,
  type OtherSettings,
} from '@/lib/other-settings'
import { areWdiValuesEqual, calculateWdi, isSystemWdiMode } from '@/lib/wdi'
import type { WeldInput } from '@/lib/weld-fields'

export const WDI_RECALCULATION_EXAMPLE_LIMIT = 100

export type WdiRecalculationRow = Pick<
  WeldInput,
  'projectTitle' | 'subtitleCode' | 'line' | 'joint' | 'connectionType' | 'd1' | 'd2' | 't1' | 't2' | 'wdi'
> & {
  id: number
}

export type WdiRecalculationExample = {
  id: number
  projectTitle: string
  subtitleCode: string
  line: string
  joint: string
  before: number | null
  after: number | null
}

export type WdiRecalculationPreview = {
  calculationSignature: string
  sourceSignature: string
  total: number
  changed: number
  unchanged: number
  wdiDelta: number
  filled: number
  cleared: number
  examples: WdiRecalculationExample[]
  examplesTruncated: boolean
}

type WdiRecalculationPlan = Omit<WdiRecalculationPreview, 'sourceSignature'> & {
  changes: WdiRecalculationChange[]
}

export type WdiRecalculationChange = {
  id: number
  wdi: number | null
}

export function getWdiCalculationSignature(settings: OtherSettings) {
  const normalized = normalizeOtherSettings(settings)
  return JSON.stringify({
    wdiCalculationMode: normalized.wdiCalculationMode,
    wdiCalculationRules: normalized.wdiCalculationRules,
    wdiTable: normalized.wdiTable,
  })
}

export function buildWdiRecalculationPlan(
  rows: WdiRecalculationRow[],
  settings: OtherSettings,
): WdiRecalculationPlan {
  if (!isSystemWdiMode(settings)) {
    throw new Error('Массовый пересчет доступен только для системного расчета WDI.')
  }

  const changes: WdiRecalculationChange[] = []
  const examples: WdiRecalculationExample[] = []
  let filled = 0
  let cleared = 0
  let wdiDelta = 0

  for (const row of rows) {
    const before = normalizeWdiNumber(row.wdi)
    const after = calculateWdi(row as WeldInput, settings)
    if (areWdiValuesEqual(before, after)) continue

    changes.push({ id: row.id, wdi: after })
    wdiDelta += (after ?? 0) - (before ?? 0)
    if (before === null && after !== null) filled += 1
    if (before !== null && after === null) cleared += 1
    if (examples.length < WDI_RECALCULATION_EXAMPLE_LIMIT) {
      examples.push({
        id: row.id,
        projectTitle: String(row.projectTitle ?? ''),
        subtitleCode: String(row.subtitleCode ?? ''),
        line: String(row.line ?? ''),
        joint: String(row.joint ?? ''),
        before,
        after,
      })
    }
  }

  return {
    calculationSignature: getWdiCalculationSignature(settings),
    total: rows.length,
    changed: changes.length,
    unchanged: rows.length - changes.length,
    wdiDelta: roundWdiDelta(wdiDelta),
    filled,
    cleared,
    examples,
    examplesTruncated: changes.length > examples.length,
    changes,
  }
}

function roundWdiDelta(value: number) {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? 0 : rounded
}

function normalizeWdiNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).trim().replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}
