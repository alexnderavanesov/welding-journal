import { describe, expect, it } from 'vitest'

import {
  CONTROL_ASSIGNMENT_CLEANUP_FIELDS,
  assertControlAssignmentCleanupSchema,
  assertControlAssignmentCleanupPreconditions,
  assertControlAssignmentPlanCanApply,
  assertRemoteControlAssignmentCleanupPublishedCommit,
  assertRemoteControlAssignmentCleanupWorkspace,
  buildControlAssignmentAuditSql,
  buildControlAssignmentCleanupConfirmation,
  buildControlAssignmentCleanupPlan,
  buildControlAssignmentFingerprintSql,
  buildControlAssignmentUpdateExplainSql,
  buildControlAssignmentUpdateSql,
  getControlAssignmentUpdateParams,
  parseControlAssignmentCleanupArgs,
} from './control-assignment-cleanup.ts'
import { CONTROL_ASSIGNMENT_FIELD_KEYS } from '../src/lib/control-availability-values.ts'

describe('control assignment cleanup', () => {
  it('builds a conservative plan without guessing unknown values', () => {
    const plan = buildControlAssignmentCleanupPlan([
      { field: 'psto_required', value: null, count: 10 },
      { field: 'psto_required', value: 'да', count: 5 },
      { field: 'psto_required', value: ' Да ', count: 3 },
      { field: 'psto_required', value: '0', count: 2 },
      { field: 'psto_required', value: '-', count: 1 },
      { field: 'psto_required', value: 'неизвестно', count: 4 },
      { field: 'has_rk', value: 'замена РК/УЗК', count: 2 },
    ])

    expect(plan.changedCells).toBe(8)
    expect(plan.unknownCells).toBe(4)
    const pstoEntries = plan.fields.find((field) => field.column === 'psto_required')?.entries
    expect(pstoEntries).toHaveLength(6)
    expect(pstoEntries).toEqual(expect.arrayContaining([
      { value: null, canonicalValue: null, count: 10, action: 'keep' },
      { value: '-', canonicalValue: null, count: 1, action: 'normalize' },
      { value: '0', canonicalValue: 'нет', count: 2, action: 'normalize' },
      { value: 'да', canonicalValue: 'да', count: 5, action: 'keep' },
      { value: ' Да ', canonicalValue: 'да', count: 3, action: 'normalize' },
      { value: 'неизвестно', canonicalValue: null, count: 4, action: 'unknown' },
    ]))
    expect(() => assertControlAssignmentPlanCanApply(plan)).toThrow(/неизвестных значений/)
  })

  it('refuses an apply when there is nothing to change', () => {
    const plan = buildControlAssignmentCleanupPlan([
      { field: 'has_vik', value: null, count: 10 },
      { field: 'has_vik', value: 'да', count: 5 },
    ])

    expect(plan).toMatchObject({ changedCells: 0, unknownCells: 0 })
    expect(() => assertControlAssignmentPlanCanApply(plan)).toThrow(/Очистка не требуется/)
  })

  it('requires an explicit dry-run token and extra remote confirmations', () => {
    expect(parseControlAssignmentCleanupArgs([])).toMatchObject({ remote: false, apply: false })
    expect(parseControlAssignmentCleanupArgs(['--remote'])).toMatchObject({ remote: true, apply: false })
    expect(() => parseControlAssignmentCleanupArgs(['--force'])).toThrow(/Неизвестный аргумент/)

    expect(() => assertControlAssignmentCleanupPreconditions(
      parseControlAssignmentCleanupArgs(['--apply']),
    )).toThrow(/сначала выполните dry-run/)
    expect(() => assertControlAssignmentCleanupPreconditions(
      parseControlAssignmentCleanupArgs(['--remote', '--apply', '--confirm=token']),
    )).toThrow(/backup-confirmed/)
    expect(() => assertControlAssignmentCleanupPreconditions(
      parseControlAssignmentCleanupArgs([
        '--remote',
        '--apply',
        '--confirm=token',
        '--backup-confirmed',
      ]),
    )).toThrow(/maintenance-window-confirmed/)
    expect(() => assertControlAssignmentCleanupPreconditions(
      parseControlAssignmentCleanupArgs([
        '--remote',
        '--apply',
        '--confirm=token',
        '--backup-confirmed',
        '--maintenance-window-confirmed',
      ]),
    )).toThrow(/release-deployed-confirmed/)
    expect(() => assertControlAssignmentCleanupPreconditions(
      parseControlAssignmentCleanupArgs([
        '--remote',
        '--apply',
        '--confirm=token',
        '--backup-confirmed',
        '--maintenance-window-confirmed',
        '--release-deployed-confirmed',
      ]),
    )).not.toThrow()
  })

  it('blocks database features that could make the update affect hidden data', () => {
    const validInspection = {
      tableName: 'weld_joints',
      tableKind: 'r',
      rowSecurityEnabled: false,
      rowSecurityForced: false,
      columns: CONTROL_ASSIGNMENT_CLEANUP_FIELDS.map((field) => ({
        columnName: field.column,
        dataType: 'text',
        isGenerated: 'NEVER',
      })),
      triggerNames: [],
      ruleNames: [],
    }

    expect(() => assertControlAssignmentCleanupSchema(validInspection)).not.toThrow()
    expect(() => assertControlAssignmentCleanupSchema({
      ...validInspection,
      triggerNames: ['unexpected_update_trigger'],
    })).toThrow(/пользовательские триггеры/)
    expect(() => assertControlAssignmentCleanupSchema({
      ...validInspection,
      rowSecurityEnabled: true,
    })).toThrow(/политика RLS/)
    expect(() => assertControlAssignmentCleanupSchema({
      ...validInspection,
      columns: validInspection.columns.slice(1),
    })).toThrow(/отсутствует поле/)
  })

  it('requires a clean published main before a remote connection', () => {
    expect(() => assertRemoteControlAssignmentCleanupWorkspace('main', '')).not.toThrow()
    expect(() => assertRemoteControlAssignmentCleanupWorkspace('feature', '')).toThrow(/ветки main/)
    expect(() => assertRemoteControlAssignmentCleanupWorkspace('main', ' M file.ts')).toThrow(
      /незакоммиченные изменения/,
    )
    expect(() => assertRemoteControlAssignmentCleanupPublishedCommit('ABC', 'abc')).not.toThrow()
    expect(() => assertRemoteControlAssignmentCleanupPublishedCommit('abc', 'def')).toThrow(
      /не совпадает с origin\/main/,
    )
  })

  it('builds a state-bound confirmation token', () => {
    const plan = buildControlAssignmentCleanupPlan([
      { field: 'psto_required', value: 'Да', count: 1 },
    ])
    const input = {
      scope: 'remote' as const,
      identity: {
        database: 'welding',
        user: 'admin',
        serverAddress: '10.0.0.5',
        serverPort: 5432,
      },
      fingerprint: 'first',
      rowCount: 100,
      plan,
    }

    const token = buildControlAssignmentCleanupConfirmation(input)
    expect(token).toMatch(/^control-values-[a-f0-9]{24}$/)
    expect(buildControlAssignmentCleanupConfirmation(input)).toBe(token)
    expect(buildControlAssignmentCleanupConfirmation({ ...input, fingerprint: 'second' })).not.toBe(token)
    expect(buildControlAssignmentCleanupConfirmation({ ...input, scope: 'local' })).not.toBe(token)
  })

  it('updates only the fixed assignment columns with parameterized aliases', () => {
    const auditSql = buildControlAssignmentAuditSql()
    const fingerprintSql = buildControlAssignmentFingerprintSql()
    const updateSql = buildControlAssignmentUpdateSql()
    const explainSql = buildControlAssignmentUpdateExplainSql()
    const allSql = `${auditSql}\n${fingerprintSql}\n${updateSql}`.toLowerCase()

    expect(new Set(CONTROL_ASSIGNMENT_CLEANUP_FIELDS.map((field) => field.key))).toEqual(
      CONTROL_ASSIGNMENT_FIELD_KEYS,
    )
    expect(auditSql.match(/from public\.weld_joints/g)).toHaveLength(1)
    for (const field of CONTROL_ASSIGNMENT_CLEANUP_FIELDS) {
      expect(auditSql).toContain(`'${field.column}'`)
      expect(updateSql).toContain(`"${field.column}" = case`)
      expect(fingerprintSql).toContain(`"${field.column}"`)
    }
    expect(updateSql).toContain('$1::text[]')
    expect(updateSql).toContain('$2::text[]')
    expect(updateSql).toContain('$3::text[]')
    expect(explainSql).toBe(`explain (format text, costs off) ${updateSql}`)
    expect(explainSql.toLowerCase()).not.toContain('analyze')
    expect(getControlAssignmentUpdateParams()).toEqual([
      expect.arrayContaining(['да', '1']),
      expect.arrayContaining(['нет', '0']),
      expect.arrayContaining(['дополнительный', 'замена рк/узк']),
    ])
    expect(allSql).not.toMatch(/\b(delete|truncate|drop|alter)\b/)
  })
})
