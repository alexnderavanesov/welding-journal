// This module is intentionally domain-scoped. Keep cross-domain rules in weld-server-shared.

import { requireDb } from '@/db'
import {
appSettings,
dispatcherBackgroundRowTasks,
dispatcherRowTasks,
duplicateControls,
generatedDocuments,
generatedDocumentWeldJoints,
weldJoints
} from '@/db/schema'
import { LEGACY_CONTROL_REPLACEMENT_VALUE } from '@/lib/control-availability-values'
import {
DISPATCHER_TASK_FILTER_KEY,
parseDispatcherTaskServerFilter
} from '@/lib/dispatcher-task-row-codes'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import {
DEFAULT_OTHER_SETTINGS,
normalizeOtherSettings,
type OtherSettings
} from '@/lib/other-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
getJointChainFilterPattern,
JOINT_CHAIN_FILTER_KEY,
parseJointChainFilter,
parsePercentageLineStampFilter,
parseRowIdListFilter,
PERCENTAGE_LINE_STAMP_FILTER_KEY,
ROW_ID_LIST_FILTER_KEY
} from '@/lib/report-hidden-filters'
import { isSystemWdiMode,withSystemWdi } from '@/lib/wdi'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'
import {
FIELD_BY_KEY,
type WeldFieldKey,
type WeldInput
} from '@/lib/weld-fields'
import {
type WeldFilters,
type WeldImportScopeRequest
} from '@/server/weld-contracts'
import { and,asc,eq,exists,getTableColumns,ilike,inArray,notExists,notInArray,or,sql,type SQL,type SQLWrapper } from 'drizzle-orm'
import { getControlMethodFilterColumnKey } from '@/server/weld-request-utils'

export const filterKeys = [
  'projectTitle',
  'line',
  'groupName',
  'category',
  'pstoRequired',
  'weldingMethod',
  'materialGroup',
  'officiality',
  'finalStatus',
] as const

export const GENERATED_DOCUMENT_FIELD_TYPES = {
  jsrDocument: 'weldingJournal',
  checklistDocument: 'checklist',
  zniDocument: 'zni',
  layeredVikEdgesDocument: 'layeredVikEdges',
  layeredVikLayersDocument: 'layeredVikLayers',
  layeredPvkEdgesDocument: 'layeredPvkEdges',
  layeredPvkLayersDocument: 'layeredPvkLayers',
  layeredVikDocuments: ['layeredVikEdges', 'layeredVikLayers'],
  layeredPvkDocuments: ['layeredPvkEdges', 'layeredPvkLayers'],
} as const satisfies Partial<Record<WeldFieldKey, string | readonly string[]>>

export const WELDING_JOURNAL_ORDER_BY = [
  sql`${weldJoints.createdAt} desc nulls last`,
  sql`${weldJoints.weldDate} desc nulls last`,
  asc(weldJoints.line),
  asc(weldJoints.joint),
]

export const WELD_TABLE_COLUMNS = getTableColumns(weldJoints)

const { updatedAt: OMITTED_UPDATED_AT_COLUMN, ...WELD_TABLE_SELECT_COLUMNS } = WELD_TABLE_COLUMNS

export const WELD_ROW_VERSION_SELECT = sql<string>`xmin::text`.as('row_version')
export const WELD_EFFECTIVE_OFFICIALITY = sql<string | null>`${weldJoints.officiality}`

export const WELD_TABLE_SELECT = {
  ...WELD_TABLE_SELECT_COLUMNS,
  officiality: WELD_EFFECTIVE_OFFICIALITY.as('officiality'),
  rowVersion: WELD_ROW_VERSION_SELECT,
}

export const WELD_TABLE_RETURNING = {
  ...WELD_TABLE_COLUMNS,
  officiality: WELD_EFFECTIVE_OFFICIALITY.as('officiality'),
  rowVersion: WELD_ROW_VERSION_SELECT,
}

void OMITTED_UPDATED_AT_COLUMN

export async function loadServerOtherSettings() {
  const [storedSettings] = await requireDb()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.other))
    .limit(1)
  if (!storedSettings) return DEFAULT_OTHER_SETTINGS

  try {
    return normalizeOtherSettings(JSON.parse(storedSettings.value))
  } catch {
    return DEFAULT_OTHER_SETTINGS
  }
}

export function applyCurrentSystemWdi<Row extends WeldInput>(rows: Row[], settings: OtherSettings): Row[] {
  return isSystemWdiMode(settings) ? rows.map((row) => withSystemWdi(row, settings)) : rows
}

export function buildWhere(filters: WeldFilters & { columnFilters?: Record<string, string> }) {
  const clauses: SQL[] = []

  addBaseFilterClauses(clauses, filters)
  addColumnFilterClauses(clauses, filters.columnFilters ?? {})

  return clauses.length ? and(...clauses) : sql`true`
}

export function addBaseFilterClauses(clauses: SQL[], filters: WeldFilters) {

  if (filters.search?.trim()) {
    const search = `%${filters.search.trim()}%`
    const searchClause = or(
      ilike(weldJoints.joint, search),
      ilike(weldJoints.line, search),
      ilike(weldJoints.isometry, search),
      ilike(weldJoints.spool, search),
      ilike(weldJoints.element1, search),
      ilike(weldJoints.element2, search),
      ilike(weldJoints.material1, search),
      ilike(weldJoints.material2, search),
      ilike(weldJoints.materialUniqueNumber1, search),
      ilike(weldJoints.materialUniqueNumber2, search),
      ilike(weldJoints.materialFullName1, search),
      ilike(weldJoints.materialFullName2, search),
      ilike(weldJoints.materialNormativeDocument1, search),
      ilike(weldJoints.materialNormativeDocument2, search),
      ilike(weldJoints.materialCertificateNumber1, search),
      ilike(weldJoints.materialCertificateNumber2, search),
      ilike(weldJoints.technologyCardNumber, search),
      ilike(weldJoints.weldingElectrodes, search),
      ilike(weldJoints.weldingElectrodesCertificateNumber, search),
      ilike(weldJoints.fillerWire, search),
      ilike(weldJoints.fillerWireCertificateNumber, search),
      ilike(weldJoints.shieldingGas, search),
      ilike(weldJoints.shieldingGasCertificateNumber, search),
      ilike(weldJoints.responsible, search),
    )
    if (searchClause) clauses.push(searchClause)
  }

  for (const key of filterKeys) {
    const value = filters[key]
    const column = getWeldColumn(key)
    if (value && column) clauses.push(sql`${column} = ${value}`)
  }

  const controlColumnKey = getControlMethodFilterColumnKey(filters.controlMethod)
  if (controlColumnKey) {
    const column = weldJoints[controlColumnKey]
    const controlClause = or(eq(column, 'да'), eq(column, 'дополнительный'), eq(column, LEGACY_CONTROL_REPLACEMENT_VALUE))
    if (controlClause) clauses.push(controlClause)
  }
}

export function addColumnFilterClauses(clauses: SQL[], columnFilters: Record<string, string>) {
  for (const [key, value] of Object.entries(columnFilters)) {
    const query = value.trim()
    if (!query) continue

    if (key === ROW_ID_LIST_FILTER_KEY) {
      const filter = parseRowIdListFilter(query)
      if (filter) clauses.push(buildRowIdListWhere(filter))
      continue
    }

    if (key === JOINT_CHAIN_FILTER_KEY) {
      const filter = parseJointChainFilter(query)
      if (filter) clauses.push(buildJointChainWhere(filter))
      continue
    }

    if (key === DISPATCHER_TASK_FILTER_KEY) {
      const filter = parseDispatcherTaskServerFilter(query)
      if (filter) clauses.push(buildDispatcherTaskWhere(filter))
      continue
    }

    if (key === PERCENTAGE_LINE_STAMP_FILTER_KEY) {
      const filter = parsePercentageLineStampFilter(query)
      if (filter) clauses.push(buildPercentageLineStampWhere(filter))
      continue
    }

    if (!FIELD_BY_KEY.has(key as WeldFieldKey)) continue
    const generatedDocumentType = GENERATED_DOCUMENT_FIELD_TYPES[key as keyof typeof GENERATED_DOCUMENT_FIELD_TYPES]
    if (generatedDocumentType) {
      clauses.push(buildGeneratedDocumentColumnWhere(query, generatedDocumentType))
      continue
    }
    if (key === 'finalStatus') {
      clauses.push(buildFinalStatusColumnWhere(query))
      continue
    }
    const column = getWeldColumn(key as WeldFieldKey)
    if (!column) continue

    const choiceFilter = parseWeldColumnChoiceFilter(query)
    if (choiceFilter?.kind === 'values') {
      clauses.push(buildColumnChoiceWhere(column, choiceFilter.values))
      continue
    }

    if (query.startsWith('=')) {
      clauses.push(buildColumnTextEqualsWhere(column, query.slice(1).trim().replace(/^["']|["']$/g, '')))
      continue
    }

    clauses.push(sql`coalesce(${column}::text, '') ilike ${`%${query}%`}`)
  }
}

export function buildGeneratedDocumentColumnWhere(
  query: string,
  documentType: string | readonly string[],
) {
  const documentTypes = Array.isArray(documentType) ? [...documentType] : [documentType]
  const typeWhere = documentTypes.length === 1
    ? eq(generatedDocuments.type, documentTypes[0])
    : inArray(generatedDocuments.type, documentTypes)
  const titleMatch = (value: string) =>
    sql`exists (
      select 1
      from ${generatedDocumentWeldJoints}
      inner join ${generatedDocuments}
        on ${generatedDocuments.id} = ${generatedDocumentWeldJoints.documentId}
      where ${generatedDocumentWeldJoints.weldJointId} = ${weldJoints.id}
        and ${typeWhere}
        and lower(trim(coalesce(${generatedDocuments.title}, ''))) = lower(trim(${value}))
    )`
  const withoutDocument = sql`not exists (
    select 1
    from ${generatedDocumentWeldJoints}
    inner join ${generatedDocuments}
      on ${generatedDocuments.id} = ${generatedDocumentWeldJoints.documentId}
    where ${generatedDocumentWeldJoints.weldJointId} = ${weldJoints.id}
      and ${typeWhere}
  )`
  const choiceFilter = parseWeldColumnChoiceFilter(query)
  if (choiceFilter?.kind === 'values') {
    const values = [...new Set(choiceFilter.values.map((value) => String(value ?? '').trim()))]
    const choices = values.filter(Boolean).map(titleMatch)
    if (values.includes('')) choices.push(withoutDocument)
    return choices.length > 0 ? or(...choices) ?? sql`false` : sql`false`
  }
  if (query.startsWith('=')) {
    const value = query.slice(1).trim().replace(/^["']|["']$/g, '')
    return value ? titleMatch(value) : withoutDocument
  }
  return sql`exists (
    select 1
    from ${generatedDocumentWeldJoints}
    inner join ${generatedDocuments}
      on ${generatedDocuments.id} = ${generatedDocumentWeldJoints.documentId}
    where ${generatedDocumentWeldJoints.weldJointId} = ${weldJoints.id}
      and ${typeWhere}
      and coalesce(${generatedDocuments.title}, '') ilike ${`%${query}%`}
  )`
}

export function getWeldColumn(fieldKey: WeldFieldKey) {
  if (fieldKey === 'officiality') return WELD_EFFECTIVE_OFFICIALITY
  return WELD_TABLE_COLUMNS[fieldKey as keyof typeof WELD_TABLE_COLUMNS]
}

export function getWeldColumnFilterExpression(fieldKey: WeldFieldKey) {
  if (fieldKey !== 'finalStatus') return getWeldColumn(fieldKey)

  const rejectedDuplicateMethods = sql<string>`(
    select string_agg(
      distinct trim(${duplicateControls.method}),
      ', ' order by trim(${duplicateControls.method})
    )
    from ${duplicateControls}
    where ${duplicateControls.weldJointId} = ${weldJoints.id}
      and ${duplicateControls.result} in ('ремонт', 'вырез')
      and trim(${duplicateControls.method}) <> ''
  )`

  return sql<string>`case
    when lower(trim(coalesce(${weldJoints.finalStatus}, ''))) = 'не годен по дублю'
      then concat(
        coalesce(${weldJoints.finalStatus}, ''),
        nullif(concat(' (', ${rejectedDuplicateMethods}, ')'), ' ()')
      )
    else coalesce(${weldJoints.finalStatus}, '')
  end`
}

export function buildFinalStatusColumnWhere(query: string) {
  const choiceFilter = parseWeldColumnChoiceFilter(query)
  if (choiceFilter?.kind === 'values') {
    return or(...choiceFilter.values.map(buildFinalStatusChoiceWhere)) ?? sql`false`
  }
  if (query.startsWith('=')) {
    return buildFinalStatusChoiceWhere(query.slice(1).trim().replace(/^["']|["']$/g, ''))
  }
  return sql`coalesce(${getWeldColumnFilterExpression('finalStatus')}::text, '') ilike ${`%${query}%`}`
}

export function buildFinalStatusChoiceWhere(value: string) {
  const match = String(value ?? '').trim().match(/^не годен по дублю\s*\((.+)\)$/i)
  if (!match) return buildColumnTextEqualsWhere(weldJoints.finalStatus, value)

  const methods = Array.from(
    new Set(
      match[1]
        .split(',')
        .map((method) => method.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, 'ru', { numeric: true, sensitivity: 'base' }))
  if (methods.length === 0) return sql`false`
  const expectedMethods = methods.join(', ')

  return (
    and(
      buildColumnTextEqualsWhere(weldJoints.finalStatus, 'не годен по дублю'),
      sql`${weldJoints.id} in (
        select ${duplicateControls.weldJointId}
        from ${duplicateControls}
        where ${duplicateControls.result} in ('ремонт', 'вырез')
          and trim(${duplicateControls.method}) <> ''
        group by ${duplicateControls.weldJointId}
        having lower(string_agg(
          distinct trim(${duplicateControls.method}),
          ', ' order by trim(${duplicateControls.method})
        )) = lower(${expectedMethods})
      )`,
    ) ?? sql`false`
  )
}

export function buildColumnChoiceWhere(column: SQLWrapper, values: readonly string[]) {
  const normalizedValues = [...new Set(values.map((value) => String(value ?? '').trim()))]
  if (normalizedValues.length === 0) return sql`false`
  return or(...normalizedValues.map((value) => buildColumnTextEqualsWhere(column, value))) ?? sql`false`
}

export function buildColumnTextEqualsWhere(column: SQLWrapper, value: string) {
  return sql`lower(trim(coalesce(${column}::text, ''))) = lower(trim(${value}))`
}

export function buildRowIdListWhere(filter: NonNullable<ReturnType<typeof parseRowIdListFilter>>) {
  if (filter.rowIds.length === 0) return filter.mode === 'exclude' ? sql`true` : sql`false`
  return filter.mode === 'exclude' ? notInArray(weldJoints.id, filter.rowIds) : inArray(weldJoints.id, filter.rowIds)
}

export function buildJointChainWhere(filter: NonNullable<ReturnType<typeof parseJointChainFilter>>) {
  const pattern = getJointChainFilterPattern(filter)
  return sql`regexp_replace(coalesce(${weldJoints.joint}::text, ''), '\\s+', '', 'g') ~* ${pattern}`
}

export function buildDispatcherTaskWhere(filter: NonNullable<ReturnType<typeof parseDispatcherTaskServerFilter>>) {
  if (filter.mode === 'all') return sql`true`

  if (filter.mode === 'codes' && filter.codes.length === 0) return sql`false`
  const activeTaskClauses: SQL[] = [eq(dispatcherRowTasks.weldJointId, weldJoints.id)]
  const backgroundTaskClauses: SQL[] = [eq(dispatcherBackgroundRowTasks.weldJointId, weldJoints.id)]
  if (filter.mode === 'codes') {
    activeTaskClauses.push(inArray(dispatcherRowTasks.code, filter.codes))
    backgroundTaskClauses.push(inArray(dispatcherBackgroundRowTasks.code, filter.codes))
  }
  const matchingActiveTask = requireDb()
    .select({ value: sql`1` })
    .from(dispatcherRowTasks)
    .where(and(...activeTaskClauses))
  const matchingBackgroundTask = requireDb()
    .select({ value: sql`1` })
    .from(dispatcherBackgroundRowTasks)
    .where(and(...backgroundTaskClauses))

  return filter.mode === 'without'
    ? and(notExists(matchingActiveTask), notExists(matchingBackgroundTask)) ?? sql`false`
    : or(exists(matchingActiveTask), exists(matchingBackgroundTask)) ?? sql`false`
}

export function normalizedTextEquals(column: SQLWrapper, value: unknown) {
  const normalizedValue = String(value ?? '').replace(/\s+/g, '').trim().toLowerCase()
  return sql`lower(regexp_replace(coalesce(${column}::text, ''), '\\s+', '', 'g')) = ${normalizedValue}`
}

export function getColumnFilterOptionFilters(columnFilters: Record<string, string>, fieldKey: WeldFieldKey) {
  const filters = { ...columnFilters }
  delete filters[fieldKey]
  return filters
}

export function hasDispatcherTaskServerFilter(columnFilters: Record<string, string>) {
  return Boolean(parseDispatcherTaskServerFilter(columnFilters[DISPATCHER_TASK_FILTER_KEY]))
}

export function buildPercentageLineStampWhere(filter: NonNullable<ReturnType<typeof parsePercentageLineStampFilter>>) {
  const stamp = filter.stamp.trim()
  return and(
    buildColumnTextEqualsWhere(weldJoints.projectTitle as unknown as SQL, filter.projectTitle),
    buildColumnTextEqualsWhere(weldJoints.subtitleCode as unknown as SQL, filter.subtitleCode),
    buildColumnTextEqualsWhere(weldJoints.line as unknown as SQL, filter.line),
    or(
      eq(weldJoints.stamp1K, stamp),
      eq(weldJoints.stamp1Z, stamp),
      eq(weldJoints.stamp1O, stamp),
      eq(weldJoints.stamp2K, stamp),
      eq(weldJoints.stamp2Z, stamp),
      eq(weldJoints.stamp2O, stamp),
    ) ?? sql`false`,
  ) ?? sql`false`
}
