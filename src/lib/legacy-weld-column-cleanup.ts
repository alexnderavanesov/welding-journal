export const LEGACY_WELD_CONTROL_COLUMNS = [
  'has_rfa',
  'has_stls',
  'has_mkk',
  'rfa_control_basis',
  'stls_control_basis',
  'mkk_control_basis',
  'rfa_request',
  'rfa_request_date',
  'stls_request',
  'stls_request_date',
  'mkk_request',
  'mkk_request_date',
  'rfa_result',
  'stls_result',
  'mkk_result',
  'rfa_conclusion_date',
  'rfa_conclusion',
  'stls_conclusion_date',
  'stls_conclusion',
  'mkk_conclusion_date',
  'mkk_conclusion',
  'rfa_boq',
  'rfa_ks3',
  'stls_boq',
  'stls_ks3',
  'mkk_boq',
  'mkk_ks3',
] as const

export type LegacyWeldControlColumn = typeof LEGACY_WELD_CONTROL_COLUMNS[number]
export type LegacyStatusPreparationMode = 'synchronize' | 'rename-will-preserve' | 'none'

export type LegacyWeldMigrationMilestones = {
  officialityRename: number
  legacyControlRemoval: number
  compatibilityRestore: number
  finalCleanup: number
}

export type LegacyWeldMigrationState = {
  officialityRenameApplied: boolean
  legacyControlRemovalApplied: boolean
  compatibilityRestoreApplied: boolean
  finalCleanupApplied: boolean
}

export function getPresentLegacyControlColumns(columnNames: Iterable<string>): LegacyWeldControlColumn[] {
  const availableColumns = new Set(columnNames)
  return LEGACY_WELD_CONTROL_COLUMNS.filter((columnName) => availableColumns.has(columnName))
}

export function getLegacyStatusPreparationMode(columnNames: Iterable<string>): LegacyStatusPreparationMode {
  const availableColumns = new Set(columnNames)
  if (availableColumns.has('status') && availableColumns.has('officiality')) return 'synchronize'
  if (availableColumns.has('status')) return 'rename-will-preserve'
  return 'none'
}

export function getLegacyWeldMigrationState(
  latestMigrationWhen: number | null,
  milestones: LegacyWeldMigrationMilestones,
): LegacyWeldMigrationState {
  const orderedMilestones = [
    milestones.officialityRename,
    milestones.legacyControlRemoval,
    milestones.compatibilityRestore,
    milestones.finalCleanup,
  ]
  const hasInvalidMilestone = orderedMilestones.some((value) => !Number.isSafeInteger(value))
    || orderedMilestones.some((value, index) => index > 0 && value <= orderedMilestones[index - 1])
  if (hasInvalidMilestone) {
    throw new Error('Некорректно настроены контрольные точки миграций weld_joints.')
  }

  const latest = latestMigrationWhen ?? Number.NEGATIVE_INFINITY
  return {
    officialityRenameApplied: latest >= milestones.officialityRename,
    legacyControlRemovalApplied: latest >= milestones.legacyControlRemoval,
    compatibilityRestoreApplied: latest >= milestones.compatibilityRestore,
    finalCleanupApplied: latest >= milestones.finalCleanup,
  }
}

export function assertLegacyWeldSchemaMatchesMigrationState(
  columnNames: Iterable<string>,
  state: LegacyWeldMigrationState,
) {
  const availableColumns = new Set(columnNames)
  const compatibilityColumnsExpected = state.compatibilityRestoreApplied && !state.finalCleanupApplied
  const statusExpected = !state.officialityRenameApplied || compatibilityColumnsExpected
  const officialityExpected = state.officialityRenameApplied
  const legacyControlColumnsExpected = !state.legacyControlRemovalApplied || compatibilityColumnsExpected
  const mismatches: string[] = []

  appendColumnMismatch(mismatches, availableColumns, 'status', statusExpected)
  appendColumnMismatch(mismatches, availableColumns, 'officiality', officialityExpected)

  const presentLegacyColumns = getPresentLegacyControlColumns(availableColumns)
  if (legacyControlColumnsExpected && presentLegacyColumns.length !== LEGACY_WELD_CONTROL_COLUMNS.length) {
    const missingColumns = LEGACY_WELD_CONTROL_COLUMNS
      .filter((columnName) => !availableColumns.has(columnName))
    mismatches.push(`отсутствуют ожидаемые колонки: ${missingColumns.join(', ')}`)
  }
  if (!legacyControlColumnsExpected && presentLegacyColumns.length > 0) {
    mismatches.push(`неожиданно присутствуют колонки: ${presentLegacyColumns.join(', ')}`)
  }

  if (mismatches.length === 0) return

  throw new Error(
    `Миграция остановлена: фактическая схема weld_joints не соответствует истории Drizzle `
    + `(${mismatches.join('; ')}). Данные не изменены. Сначала требуется отдельная сверка схемы и истории миграций.`,
  )
}

export function assertNoOfficialityConflicts(conflictingRowCount: number) {
  if (conflictingRowCount === 0) return

  throw new Error(
    `Миграция остановлена: в ${conflictingRowCount} строках status и officiality содержат разные `
    + 'непустые значения. Данные не изменены. Сначала требуется выбрать правильные значения вручную.',
  )
}

export function assertLegacyControlColumnsEmpty(
  populatedCounts: Readonly<Partial<Record<LegacyWeldControlColumn, number>>>,
) {
  const populatedColumns = LEGACY_WELD_CONTROL_COLUMNS
    .map((columnName) => ({ columnName, count: populatedCounts[columnName] ?? 0 }))
    .filter(({ count }) => count > 0)

  if (populatedColumns.length === 0) return

  const details = populatedColumns
    .map(({ columnName, count }) => `${columnName}: ${count}`)
    .join(', ')
  throw new Error(
    `Миграция остановлена: в удаляемых колонках РФА/СТЛС/МКК найдены данные (${details}). `
    + 'Данные не изменены. Перед продолжением требуется отдельный план их сохранения.',
  )
}

function appendColumnMismatch(
  mismatches: string[],
  availableColumns: ReadonlySet<string>,
  columnName: string,
  expected: boolean,
) {
  const present = availableColumns.has(columnName)
  if (present === expected) return
  mismatches.push(expected
    ? `отсутствует ожидаемая колонка ${columnName}`
    : `неожиданно присутствует колонка ${columnName}`)
}
