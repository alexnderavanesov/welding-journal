import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DISPATCHER_REMINDER_SETTINGS,
  DEFAULT_DISPATCHER_SETTINGS,
  getDispatcherTaskCode,
  getDispatcherTaskSettingId,
  getDispatcherTaskTypeLabel,
  normalizeDispatcherSettings,
} from './dispatcher-settings'
import { buildVisibleDispatcherTasks } from './dispatcher-task-builder'
import { buildLnkResultRuleCheckTasks } from './repeated-joint-check-tasks'
import { buildRepeatedJointTasks } from './repeated-joint-tasks'
import { buildDispatcherTaskCodeIndexRows } from './dispatcher-task-row-codes'
import { getDispatcherTaskActionSpecs } from './dispatcher-task-actions-model'
import { getPrimaryRejectedLnkResult, getOfficialRejectedJointChainRows } from './repeated-joint-task-helpers'
import { getRepeatedJointTaskTitle } from './dispatcher-text'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import type { WeldRow } from './dispatcher-types'

const methods = ['ВИК', 'ПВК', 'РК', 'УЗК'] as const
const keys = { ВИК: 'vikResult', ПВК: 'pvkResult', РК: 'rkResult', УЗК: 'uzkResult' } as const
const cases = methods.flatMap(method => [57, 89, 159].flatMap(diameter =>
  ['F1', 'F1R1', 'F1R2'].flatMap(joint => (['годен', 'ремонт', 'вырез'] as const).flatMap(result =>
    ['primary', 'preheat', 'duplicate'].map(stage => ({ method, diameter, joint, result, stage }))))))

const row = (values: Partial<WeldRow> = {}): WeldRow => ({
  id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1',
  d1: 159, d2: 159, officiality: 'действующий', ...values,
})

describe('mandatory SP-05 dispatcher result matrix', () => {
  it.each(cases)('$method $result D$diameter $joint $stage -> SP-05', ({ method, diameter, joint, result, stage }) => {
    const source = row({ joint, d1: 159, d2: diameter })
    if (stage === 'primary') source[keys[method]] = result
    if (stage === 'preheat') source.preHeatTreatmentControls = [{ id: 10, weldJointId: 1, method, result }]
    if (stage === 'duplicate') source.duplicateControls = [{ id: 20, weldJointId: 1, method, result, controlDate: '', conclusion: '', conclusionDate: '' }]
    const surface = method === 'ВИК' || method === 'ПВК'
    // Derived from the accepted matrix, independently of the policy helper.
    const forbidden = result === 'вырез' ? surface
      : result === 'ремонт' && (joint === 'F1R2' || (!surface && diameter < 89))
    const tasks = buildLnkResultRuleCheckTasks([source])
    expect(tasks.map(getDispatcherTaskCode)).toEqual(forbidden ? ['СП-07'] : [])
    expect(buildDispatcherTaskCodeIndexRows(tasks, [source])).toEqual(forbidden
      ? [{ rowId: 1, taskKey: 'code:СП-07', code: 'СП-07' }]
      : [])
  })

  it('cannot hide all simultaneous issues through legacy false, dismissal or acceptance', () => {
    const source = row({
      joint: 'F1R2', d2: 57, vikResult: 'вырез', rkResult: 'ремонт',
      preHeatTreatmentLnkEnabled: false,
      preHeatTreatmentControls: [{ id: 10, weldJointId: 1, method: 'ПВК', result: 'вырез' }],
      duplicateControls: [{ id: 20, weldJointId: 1, method: 'УЗК', result: 'ремонт', controlDate: '', conclusion: '', conclusionDate: '' }],
    })
    const [task] = buildLnkResultRuleCheckTasks([source])
    const settings = normalizeDispatcherSettings({
      ...Object.fromEntries(Object.keys(DEFAULT_DISPATCHER_SETTINGS).map(key => [key, false])),
      'check-repair-diameter': false,
    })
    const visible = buildVisibleDispatcherTasks({
      rows: [source], dispatcherSettings: settings,
      dispatcherReminderSettings: DEFAULT_DISPATCHER_REMINDER_SETTINGS,
      acceptedDispatcherWarningKeys: new Set([task.key]), dismissedRepeatedJointTaskKeys: new Set([task.key]),
      welderStamps: [], welderStampSuspensions: [],
    }).repeatedJointTasks.filter(task => getDispatcherTaskCode(task) === 'СП-07')
    expect(settings).not.toHaveProperty('check-repair-diameter')
    expect(visible).toHaveLength(1)
    expect(task.details).toContain('ВИК:')
    expect(task.details).toContain('РК:')
    expect(task.details).toContain('ПВК до ТО:')
    expect(task.details).toContain('УЗК (дубль):')
    expect(task.details).toContain('два ремонта')
    expect(task.details).toContain('меньше 89')
    expect(getDispatcherTaskSettingId(task)).toBeNull()
    expect(getDispatcherTaskTypeLabel(task)).toBe('Допустимые результаты ЛНК')
    expect(getRepeatedJointTaskTitle(task).type).toBe('Допустимые результаты ЛНК')
    expect(getDispatcherTaskActionSpecs(task).map(action => action.id)).toEqual(['open-lnk', 'edit-weld', 'show-task'])
  })

  it.each(['vikResult', 'pvkResult'] as const)('preserves invalid %s history without W, repair or coil creation', field => {
    const source = row({ [field]: 'вырез' })
    const before = structuredClone(source)
    for (const earlyCoilDecisionSourceRowIds of [new Set<number>(), new Set([1])]) {
      const tasks = buildRepeatedJointTasks([source], [], [], { earlyCoilDecisionSourceRowIds })
      expect(tasks.filter(task => ['create', 'coil', 'rename', 'delete'].includes(task.kind))).toEqual([])
      expect(tasks.filter(task => getDispatcherTaskCode(task) === 'СП-07')).toHaveLength(1)
    }
    expect(getPrimaryRejectedLnkResult(source)?.result).toBe('вырез')
    expect(source).toEqual(before)
  })

  it('keeps mixed RK cut and invalid VIK history and existing W children, including unused ones', () => {
    for (const child of [row({ id: 2, joint: 'F1W1' }), row({ id: 2, joint: 'F1W1', weldDate: '2026-07-01', rkResult: 'годен' })]) {
      const rows = [row({ vikResult: 'вырез', rkResult: 'вырез' }), child]
      const before = structuredClone(rows)
      const tasks = buildRepeatedJointTasks(rows)
      expect(tasks.filter(task => ['create', 'coil', 'rename', 'delete'].includes(task.kind))).toEqual([])
      expect(tasks.filter(task => getDispatcherTaskCode(task) === 'СП-07').map(task => task.row.id)).toEqual([1])
      expect(getOfficialRejectedJointChainRows(rows, rows[0], 'F1').map(row => row.id)).toEqual([1])
      expect(rows).toEqual(before)
    }
  })

  it('preserves an existing coil while preventing new completion from an invalid source', () => {
    const rows = [
      row({ joint: 'F1', rkResult: 'вырез' }),
      row({ id: 2, joint: 'F1W1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'F1W2', rkResult: 'вырез' }),
      row({ id: 4, joint: 'F1W3', rkResult: 'вырез', vikResult: 'вырез' }),
      row({ id: 5, joint: 'F1Y1' }),
    ]
    const before = structuredClone(rows)
    const tasks = buildRepeatedJointTasks(rows)
    expect(tasks.some(task => task.kind === 'coil')).toBe(false)
    expect(tasks.some(task => (task.kind === 'delete' || task.kind === 'rename') && task.row.id === 5)).toBe(false)
    expect(tasks.filter(task => getDispatcherTaskCode(task) === 'СП-07').map(task => task.row.id)).toEqual([4])
    expect(rows).toEqual(before)
  })

  it('does not replay an invalid cut into a renamed chain', () => {
    const tasks = buildRepeatedJointTasks([
      row({ joint: 'F1', rkResult: 'вырез' }),
      row({ id: 2, joint: 'F1R1', vikResult: 'вырез' }),
      row({ id: 3, joint: 'F1R1W1' }),
    ])
    expect(tasks.filter(task => task.kind === 'rename' || task.kind === 'delete')).toEqual([])
    expect(tasks.some(task => getDispatcherTaskCode(task) === 'СП-07')).toBe(true)
  })

  it('applies the configured R suffix while preserving unofficial repair semantics', () => {
    const settings = { ...DEFAULT_SYSTEM_INDEX_SETTINGS, repair: 'C' }
    const tasks = buildLnkResultRuleCheckTasks([
      row({ joint: 'F1C2', vikResult: 'ремонт' }),
      row({ id: 2, joint: 'F2C2', vikResult: 'ремонт', officiality: 'неофициальный' }),
    ], settings)
    expect(tasks.map(task => task.row.id)).toEqual([1])
  })

  it('scans each stored result once for 200,000 rows and indexes only affected records', () => {
    let reads = 0
    const rows: WeldRow[] = Array.from({ length: 200_000 }, (_, index) => ({
      id: index + 1, joint: `F${index + 1}`, line: 'L',
      get vikResult() { reads++; return index % 50 === 0 ? 'вырез' : 'годен' },
    }))
    const tasks = buildLnkResultRuleCheckTasks(rows)
    expect(reads).toBe(200_000)
    expect(tasks).toHaveLength(4_000)
    expect(buildDispatcherTaskCodeIndexRows(tasks, rows)).toHaveLength(4_000)
    expect(reads).toBe(200_000)
  }, 20_000)
})
