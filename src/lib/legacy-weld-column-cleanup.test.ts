import { describe, expect, it } from 'vitest'

import {
  assertLegacyControlColumnsEmpty,
  assertLegacyWeldSchemaMatchesMigrationState,
  assertNoOfficialityConflicts,
  getLegacyStatusPreparationMode,
  getLegacyWeldMigrationState,
  getPresentLegacyControlColumns,
  LEGACY_WELD_CONTROL_COLUMNS,
  type LegacyWeldMigrationMilestones,
} from '@/lib/legacy-weld-column-cleanup'

const milestones: LegacyWeldMigrationMilestones = {
  officialityRename: 29,
  legacyControlRemoval: 31,
  compatibilityRestore: 35,
  finalCleanup: 36,
}

const baseColumns = ['id', 'project_title']
const legacyColumns = [...LEGACY_WELD_CONTROL_COLUMNS]

describe('legacy weld column cleanup', () => {
  it('keeps the complete deletion allowlist explicit and duplicate-free', () => {
    expect(LEGACY_WELD_CONTROL_COLUMNS).toHaveLength(27)
    expect(new Set(LEGACY_WELD_CONTROL_COLUMNS)).toHaveProperty('size', 27)
  })

  it('returns only allowlisted columns that are present in the database', () => {
    expect(getPresentLegacyControlColumns([
      'id',
      'has_rfa',
      'officiality',
      'mkk_ks3',
      'unexpected_column',
    ])).toEqual(['has_rfa', 'mkk_ks3'])
  })

  it('selects the safe status preservation strategy for each schema state', () => {
    expect(getLegacyStatusPreparationMode(['status', 'officiality'])).toBe('synchronize')
    expect(getLegacyStatusPreparationMode(['status'])).toBe('rename-will-preserve')
    expect(getLegacyStatusPreparationMode(['officiality'])).toBe('none')
    expect(getLegacyStatusPreparationMode([])).toBe('none')
  })

  it('allows deletion only when every present legacy control column is empty', () => {
    expect(() => assertLegacyControlColumnsEmpty({ has_rfa: 0, rfa_request: 0 })).not.toThrow()
    expect(() => assertLegacyControlColumnsEmpty({
      has_rfa: 2,
      rfa_request: 1,
    })).toThrow(/has_rfa: 2, rfa_request: 1/)
  })

  it.each([
    [null, ['status', ...legacyColumns]],
    [29, ['officiality', ...legacyColumns]],
    [31, ['officiality']],
    [35, ['status', 'officiality', ...legacyColumns]],
    [36, ['officiality']],
  ] as const)('accepts the schema expected after migration %s', (latestMigrationWhen, expectedColumns) => {
    const state = getLegacyWeldMigrationState(latestMigrationWhen, milestones)
    expect(() => assertLegacyWeldSchemaMatchesMigrationState(
      [...baseColumns, ...expectedColumns],
      state,
    )).not.toThrow()
  })

  it('stops when the physical schema has drifted from migration history', () => {
    const stateAfterLegacyRemoval = getLegacyWeldMigrationState(31, milestones)
    expect(() => assertLegacyWeldSchemaMatchesMigrationState(
      [...baseColumns, 'status', 'officiality', ...legacyColumns],
      stateAfterLegacyRemoval,
    )).toThrow(/не соответствует истории Drizzle/)

    const stateAfterCompatibilityRestore = getLegacyWeldMigrationState(35, milestones)
    expect(() => assertLegacyWeldSchemaMatchesMigrationState(
      [...baseColumns, 'officiality'],
      stateAfterCompatibilityRestore,
    )).toThrow(/отсутствует ожидаемая колонка status/)
  })

  it('stops instead of overwriting conflicting officiality values', () => {
    expect(() => assertNoOfficialityConflicts(0)).not.toThrow()
    expect(() => assertNoOfficialityConflicts(2)).toThrow(/2 строках status и officiality/)
  })

  it('rejects invalid migration milestone ordering', () => {
    expect(() => getLegacyWeldMigrationState(36, {
      ...milestones,
      finalCleanup: 31,
    })).toThrow(/Некорректно настроены/)
  })
})
