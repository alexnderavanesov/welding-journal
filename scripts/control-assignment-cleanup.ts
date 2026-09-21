import { createHash } from 'node:crypto'

import {
  CONTROL_ADDITIONAL_NORMALIZED_VALUES,
  CONTROL_NO_NORMALIZED_VALUES,
  CONTROL_YES_NORMALIZED_VALUES,
  isRecognizedControlAvailabilityValue,
  normalizeControlAvailabilityStorageText,
} from '../src/lib/control-availability-values.ts'

export const CONTROL_ASSIGNMENT_CLEANUP_FIELDS = [
  { key: 'hasVik', column: 'has_vik', label: 'Назначение ВИК' },
  { key: 'hasRk', column: 'has_rk', label: 'Назначение РК' },
  { key: 'hasUzk', column: 'has_uzk', label: 'Назначение УЗК' },
  { key: 'hasPvk', column: 'has_pvk', label: 'Назначение ПВК' },
  { key: 'hasTvmt', column: 'has_tvmt', label: 'Назначение ТВМТ' },
  { key: 'pstoRequired', column: 'psto_required', label: 'Назначение ПСТО' },
] as const

export type ControlAssignmentCleanupColumn = (typeof CONTROL_ASSIGNMENT_CLEANUP_FIELDS)[number]['column']

export type ControlAssignmentAuditRow = {
  field: string
  value: string | null
  count: number
}

export type ControlAssignmentCleanupEntry = {
  value: string | null
  canonicalValue: string | null
  count: number
  action: 'keep' | 'normalize' | 'unknown'
}

export type ControlAssignmentCleanupFieldPlan = {
  key: (typeof CONTROL_ASSIGNMENT_CLEANUP_FIELDS)[number]['key']
  column: ControlAssignmentCleanupColumn
  label: string
  entries: ControlAssignmentCleanupEntry[]
  changedCells: number
  unknownCells: number
}

export type ControlAssignmentCleanupPlan = {
  fields: ControlAssignmentCleanupFieldPlan[]
  changedCells: number
  unknownCells: number
}

export type ControlAssignmentCleanupOptions = {
  remote: boolean
  apply: boolean
  confirmation: string
  backupConfirmed: boolean
  maintenanceWindowConfirmed: boolean
  releaseDeployedConfirmed: boolean
}

export type ControlAssignmentDatabaseIdentity = {
  database: string
  user: string
  serverAddress: string
  serverPort: number | null
}

export type ControlAssignmentSchemaInspection = {
  tableName: string | null
  tableKind: string | null
  rowSecurityEnabled: boolean
  rowSecurityForced: boolean
  columns: Array<{
    columnName: string
    dataType: string
    isGenerated: string
  }>
  triggerNames: string[]
  ruleNames: string[]
}

const FIELD_BY_COLUMN = new Map(
  CONTROL_ASSIGNMENT_CLEANUP_FIELDS.map((field) => [field.column, field]),
)

export function buildControlAssignmentCleanupPlan(
  auditRows: readonly ControlAssignmentAuditRow[],
): ControlAssignmentCleanupPlan {
  const entriesByColumn = new Map<ControlAssignmentCleanupColumn, Map<string, ControlAssignmentCleanupEntry>>()
  for (const field of CONTROL_ASSIGNMENT_CLEANUP_FIELDS) entriesByColumn.set(field.column, new Map())

  for (const row of auditRows) {
    const field = FIELD_BY_COLUMN.get(row.field as ControlAssignmentCleanupColumn)
    if (!field) throw new Error(`Проверка назначений получила неизвестное поле: ${row.field}`)
    const count = Number(row.count)
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Проверка назначений получила некорректное количество для ${row.field}.`)
    }

    const value = row.value === null ? null : String(row.value)
    const entry = classifyControlAssignmentValue(value, count)
    const entryKey = value === null ? '\u0000:null' : `value:${value}`
    const existing = entriesByColumn.get(field.column)!.get(entryKey)
    if (existing) existing.count += count
    else entriesByColumn.get(field.column)!.set(entryKey, entry)
  }

  const fields = CONTROL_ASSIGNMENT_CLEANUP_FIELDS.map((field) => {
    const entries = [...entriesByColumn.get(field.column)!.values()].sort(compareCleanupEntries)
    return {
      ...field,
      entries,
      changedCells: sumEntryCounts(entries, 'normalize'),
      unknownCells: sumEntryCounts(entries, 'unknown'),
    }
  })

  return {
    fields,
    changedCells: fields.reduce((sum, field) => sum + field.changedCells, 0),
    unknownCells: fields.reduce((sum, field) => sum + field.unknownCells, 0),
  }
}

export function parseControlAssignmentCleanupArgs(
  args: readonly string[],
): ControlAssignmentCleanupOptions {
  const options: ControlAssignmentCleanupOptions = {
    remote: false,
    apply: false,
    confirmation: '',
    backupConfirmed: false,
    maintenanceWindowConfirmed: false,
    releaseDeployedConfirmed: false,
  }

  for (const arg of args) {
    if (arg === '--remote') options.remote = true
    else if (arg === '--apply') options.apply = true
    else if (arg === '--backup-confirmed') options.backupConfirmed = true
    else if (arg === '--maintenance-window-confirmed') options.maintenanceWindowConfirmed = true
    else if (arg === '--release-deployed-confirmed') options.releaseDeployedConfirmed = true
    else if (arg.startsWith('--confirm=')) options.confirmation = arg.slice('--confirm='.length).trim()
    else throw new Error(`Неизвестный аргумент очистки назначений: ${arg}`)
  }

  return options
}

export function assertControlAssignmentCleanupPreconditions(
  options: ControlAssignmentCleanupOptions,
) {
  if (!options.apply) {
    if (
      options.confirmation ||
      options.backupConfirmed ||
      options.maintenanceWindowConfirmed ||
      options.releaseDeployedConfirmed
    ) {
      throw new Error('Подтверждения разрешены только вместе с явным флагом --apply.')
    }
    return
  }

  if (!options.confirmation) {
    throw new Error(
      'Очистка не запущена: сначала выполните dry-run и передайте выданный код через --confirm=...',
    )
  }
  if (options.remote && !options.backupConfirmed) {
    throw new Error('Удаленная очистка не запущена: отсутствует флаг --backup-confirmed.')
  }
  if (options.remote && !options.maintenanceWindowConfirmed) {
    throw new Error(
      'Удаленная очистка не запущена: отсутствует флаг --maintenance-window-confirmed.',
    )
  }
  if (options.remote && !options.releaseDeployedConfirmed) {
    throw new Error(
      'Удаленная очистка не запущена: отсутствует флаг --release-deployed-confirmed.',
    )
  }
}

export function assertControlAssignmentPlanCanApply(plan: ControlAssignmentCleanupPlan) {
  if (plan.unknownCells > 0) {
    throw new Error(
      `Очистка остановлена: найдено неизвестных значений назначений: ${plan.unknownCells}. `
      + 'Скрипт не будет угадывать их смысл.',
    )
  }
  if (plan.changedCells === 0) {
    throw new Error('Очистка не требуется: все значения уже приведены к каноническому виду.')
  }
}

export function assertControlAssignmentCleanupSchema(
  inspection: ControlAssignmentSchemaInspection,
) {
  if (!inspection.tableName) {
    throw new Error('Очистка остановлена: таблица public.weld_joints не найдена.')
  }
  if (inspection.tableKind !== 'r') {
    throw new Error('Очистка остановлена: public.weld_joints имеет неожиданный тип объекта базы.')
  }
  if (inspection.rowSecurityEnabled || inspection.rowSecurityForced) {
    throw new Error('Очистка остановлена: для public.weld_joints включена неизвестная политика RLS.')
  }
  if (inspection.triggerNames.length > 0) {
    throw new Error(
      `Очистка остановлена: у public.weld_joints найдены пользовательские триггеры: ${inspection.triggerNames.join(', ')}.`,
    )
  }
  if (inspection.ruleNames.length > 0) {
    throw new Error(
      `Очистка остановлена: у public.weld_joints найдены правила перезаписи: ${inspection.ruleNames.join(', ')}.`,
    )
  }

  const columns = new Map(inspection.columns.map((column) => [column.columnName, column]))
  for (const field of CONTROL_ASSIGNMENT_CLEANUP_FIELDS) {
    const column = columns.get(field.column)
    if (!column) {
      throw new Error(`Очистка остановлена: отсутствует поле weld_joints.${field.column}.`)
    }
    if (column.dataType !== 'text' || column.isGenerated !== 'NEVER') {
      throw new Error(`Очистка остановлена: поле weld_joints.${field.column} имеет неожиданный тип.`)
    }
  }
}

export function assertRemoteControlAssignmentCleanupWorkspace(
  branch: unknown,
  gitStatus: unknown,
) {
  const currentBranch = String(branch ?? '').trim()
  if (currentBranch !== 'main') {
    throw new Error(
      `Удаленная очистка разрешена только из ветки main. Текущая ветка: ${currentBranch || 'detached HEAD'}.`,
    )
  }
  if (String(gitStatus ?? '').trim()) {
    throw new Error(
      'Удаленная очистка остановлена до подключения к базе: рабочая копия содержит незакоммиченные изменения.',
    )
  }
}

export function assertRemoteControlAssignmentCleanupPublishedCommit(
  localHead: unknown,
  remoteMainHead: unknown,
) {
  const localCommit = String(localHead ?? '').trim().toLowerCase()
  const remoteCommit = String(remoteMainHead ?? '').trim().toLowerCase()
  if (localCommit && localCommit === remoteCommit) return
  throw new Error(
    'Удаленная очистка остановлена до подключения к базе: локальный HEAD не совпадает с origin/main.',
  )
}

export function buildControlAssignmentCleanupConfirmation({
  scope,
  identity,
  fingerprint,
  rowCount,
  plan,
}: {
  scope: 'local' | 'remote'
  identity: ControlAssignmentDatabaseIdentity
  fingerprint: string
  rowCount: number
  plan: ControlAssignmentCleanupPlan
}) {
  const payload = JSON.stringify({
    version: 1,
    scope,
    identity,
    fingerprint,
    rowCount,
    fields: plan.fields.map((field) => ({
      column: field.column,
      entries: field.entries.map((entry) => ({
        value: entry.value,
        canonicalValue: entry.canonicalValue,
        count: entry.count,
        action: entry.action,
      })),
    })),
  })
  return `control-values-${createHash('sha256').update(payload).digest('hex').slice(0, 24)}`
}

export function buildControlAssignmentAuditSql() {
  const values = CONTROL_ASSIGNMENT_CLEANUP_FIELDS.map((field) => (
    `('${field.column}'::text, ${quoteIdentifier(field.column)}::text)`
  ))
  return [
    'select assignment.field, assignment.value, count(*)::int as count',
    'from public.weld_joints',
    `cross join lateral (values\n  ${values.join(',\n  ')}\n) as assignment(field, value)`,
    'group by assignment.field, assignment.value',
  ].join('\n')
}

export function buildControlAssignmentFingerprintSql() {
  const parts = CONTROL_ASSIGNMENT_CLEANUP_FIELDS.map(({ column }) => {
    const identifier = quoteIdentifier(column)
    return `coalesce(length(${identifier})::text || ':' || ${identifier}, '-1:')`
  })
  return `
    select
      count(*)::int as row_count,
      md5(coalesce(string_agg(
        md5(concat_ws('|', id::text, ${parts.join(', ')})),
        '' order by id
      ), '')) as fingerprint
    from public.weld_joints
  `
}

export function buildControlAssignmentUpdateSql() {
  const normalizedExpressions = new Map(
    CONTROL_ASSIGNMENT_CLEANUP_FIELDS.map(({ column }) => [
      column,
      buildNormalizedColumnSql(column),
    ]),
  )
  const assignments = CONTROL_ASSIGNMENT_CLEANUP_FIELDS.map(({ column }) => (
    `${quoteIdentifier(column)} = ${normalizedExpressions.get(column)}`
  ))
  const changedClauses = CONTROL_ASSIGNMENT_CLEANUP_FIELDS.map(({ column }) => (
    `${quoteIdentifier(column)} is distinct from ${normalizedExpressions.get(column)}`
  ))

  return [
    'update public.weld_joints',
    `set ${assignments.join(',\n    ')}`,
    `where ${changedClauses.join('\n   or ')}`,
  ].join('\n')
}

export function buildControlAssignmentUpdateExplainSql() {
  return `explain (format text, costs off) ${buildControlAssignmentUpdateSql()}`
}

export function getControlAssignmentUpdateParams() {
  return [
    [...CONTROL_YES_NORMALIZED_VALUES],
    [...CONTROL_NO_NORMALIZED_VALUES],
    [...CONTROL_ADDITIONAL_NORMALIZED_VALUES],
  ]
}

function classifyControlAssignmentValue(
  value: string | null,
  count: number,
): ControlAssignmentCleanupEntry {
  if (!isRecognizedControlAvailabilityValue(value)) {
    return { value, canonicalValue: null, count, action: 'unknown' }
  }
  const canonicalValue = normalizeControlAvailabilityStorageText(value)
  return {
    value,
    canonicalValue,
    count,
    action: value === canonicalValue ? 'keep' : 'normalize',
  }
}

function compareCleanupEntries(
  left: ControlAssignmentCleanupEntry,
  right: ControlAssignmentCleanupEntry,
) {
  if (left.value === null) return right.value === null ? 0 : -1
  if (right.value === null) return 1
  return left.value.localeCompare(right.value, 'ru', { numeric: true, sensitivity: 'variant' })
}

function sumEntryCounts(
  entries: readonly ControlAssignmentCleanupEntry[],
  action: ControlAssignmentCleanupEntry['action'],
) {
  return entries.reduce((sum, entry) => sum + (entry.action === action ? entry.count : 0), 0)
}

function buildNormalizedColumnSql(column: string) {
  const identifier = quoteIdentifier(column)
  const normalized = `lower(btrim(${identifier}))`
  return [
    'case',
    `when ${identifier} is null then null`,
    `when btrim(${identifier}) in ('', '-') then null`,
    `when ${normalized} = any($1::text[]) then 'да'`,
    `when ${normalized} = any($2::text[]) then 'нет'`,
    `when ${normalized} = any($3::text[]) then 'дополнительный'`,
    `when ${normalized} = 'отменен' then 'отменен'`,
    `else ${identifier}`,
    'end',
  ].join(' ')
}

function quoteIdentifier(identifier: string) {
  if (!CONTROL_ASSIGNMENT_CLEANUP_FIELDS.some((field) => field.column === identifier)) {
    throw new Error(`Недопустимое имя поля очистки назначений: ${identifier}`)
  }
  return `"${identifier}"`
}
