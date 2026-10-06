import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { buildRepeatedJointTasks } from './repeated-joint-tasks'
import { buildDispatcherTaskCodeIndexRows, buildMergedDispatcherTaskCodes } from './dispatcher-task-row-codes'
import { buildJointNextActions } from './joint-next-actions'
import { evaluateEarlyCoilCandidate } from './early-coil-candidate'
import { getDispatcherTaskActionSpecs } from './dispatcher-task-actions-model'
import { getDispatcherTaskCode } from './dispatcher-settings'
import { buildChainActualityCheckTasks } from './chain-actuality-check'

const row = (id: number, values: Partial<WeldRow> = {}): WeldRow => ({
  id, projectTitle: 'Inactive chain', subtitleCode: 'S', line: 'L', joint: 'S1',
  officiality: 'действующий', revisionActuality: 'актуальная', weldDate: '2026-09-01',
  connectionType: 'СШ', d1: 108, d2: 108, category: 'II', groupName: 'A',
  weldControlPercent: 10, pvkControlPercent: 0, hasUzk: 'да', uzkResult: 'ремонт', ...values,
})
const continuations = (rows: WeldRow[], early?: Set<number>) => buildRepeatedJointTasks(rows, [], [], {
  earlyCoilDecisionSourceRowIds: early,
}).filter(task => task.kind === 'create' || task.kind === 'coil')

describe('inactive rejected branch: history is retained, continuation is not required', () => {
  it('visits persisted ancestry a bounded number of times even for unusually long history', () => {
    let sourceReads = 0
    const size = 2_000
    const rows = Array.from({ length: size }, (_, i) => row(i + 1, {
      joint: i === 0 ? 'S1' : `S1R${i}`, revisionActuality: i === size - 1 ? 'не актуален' : null,
      programChainState: { weldJointId: i + 1, kind: i ? 'repair' : 'primary', physicalRootId: 1,
        get sourceRowId() { sourceReads++; return i || null },
        coilParentId: null, coilSide: null, replacedByCoil: false },
    }))
    expect(buildChainActualityCheckTasks(rows)).toEqual([expect.objectContaining({
      actualityRowIds: rows.map(row => row.id),
    })])
    expect(sourceReads).toBeLessThan(size * 4)
  })

  it.each(['годен', 'ремонт', null])('warns about an active rejected predecessor whose only official continuation is inactive (%s)', uzkResult => {
    const source = row(1), repair = row(2, { joint: 'S1R1', revisionActuality: 'не актуален', uzkResult })
    const tasks = buildRepeatedJointTasks([source, repair]).filter(task => task.kind === 'check' && task.reason === 'проверить актуальность цепочки')
    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('ДЗ-13')
    expect(buildDispatcherTaskCodeIndexRows(tasks, [source, repair]).map(entry => entry.rowId)).toEqual([1, 2])
    const actions = getDispatcherTaskActionSpecs(tasks[0])
    expect(actions.map(action => action.id)).toEqual(['set-chain-inactive', 'set-chain-active'])
    expect(buildJointNextActions(source, tasks)[0]).toMatchObject({ title: 'ДЗ-13 · Проверить актуальность цепочки', kind: 'dispatcherTask' })
    for (const resolved of [[source, { ...repair, revisionActuality: null }], [{ ...source, revisionActuality: 'не актуален' }, repair]]) {
      expect(buildRepeatedJointTasks(resolved).some(task => task.kind === 'check' && task.reason === 'проверить актуальность цепочки')).toBe(false)
    }
  })

  it('requires uniform actuality of the physical connection even with a later good final (user clarification)', () => {
    const rows = [row(1), row(2, { joint: 'S1R1', revisionActuality: 'не актуален' }), row(3, { joint: 'S1R2', uzkResult: 'годен' })]
    const tasks = buildRepeatedJointTasks(rows).filter(task => task.kind === 'check' && task.reason === 'проверить актуальность цепочки')
    expect(tasks).toHaveLength(1)
    expect(buildDispatcherTaskCodeIndexRows(tasks, rows).map(entry => entry.rowId)).toEqual([1, 2, 3])
    expect(buildJointNextActions(rows[2], tasks)[0]).toMatchObject({ kind: 'dispatcherTask' })
  })

  it('includes unofficial history and cut roots, but never joins another line by name', () => {
    const source = row(1), excluded = row(2, { joint: 'S1R1', revisionActuality: 'не актуален' })
    for (const rows of [
      [source, { ...excluded, officiality: 'неофициальный' }],
      [{ ...source, programChainState: { weldJointId: 1, kind: 'primary' as const, physicalRootId: 1, sourceRowId: null, coilParentId: null, coilSide: null, replacedByCoil: true } }, excluded],
      [source, excluded, row(3, { joint: 'S1R1' })],
    ]) expect(buildRepeatedJointTasks(rows).some(task => task.kind === 'check' && task.reason === 'проверить актуальность цепочки')).toBe(true)
    expect(buildChainActualityCheckTasks([source, { ...excluded, line: 'ANOTHER LINE' }])).toEqual([])
  })

  it.each([
    ['ремонт', 'действующий', 'S1R1'], ['вырез', 'действующий', 'S1W1'],
    ['ремонт', 'неофициальный', 'S1'], ['вырез', 'неофициальный', 'S1'],
  ])('%s / %s: removes and restores the exact task and row code', (uzkResult, officiality, targetJoint) => {
    const source = row(1, { uzkResult, officiality })
    for (const revisionActuality of ['актуальная', 'не актуален', ' НЕ АКТУАЛЕН ', null]) {
      const current = { ...source, revisionActuality }
      const tasks = continuations([current])
      const inactive = revisionActuality?.trim().toLowerCase() === 'не актуален'
      expect(tasks).toHaveLength(inactive ? 0 : 1)
      if (!inactive) expect(tasks[0]).toMatchObject({ kind: 'create', targetJoint })
      const index = buildDispatcherTaskCodeIndexRows(tasks, [current])
      expect(index).toHaveLength(inactive ? 0 : 1)
      expect(buildMergedDispatcherTaskCodes(index, []).allByRowId.has(1)).toBe(!inactive)
      expect(current.uzkResult).toBe(uzkResult)
    }
  })

  it('suspends both an automatic and an accepted early coil without deleting the decision', () => {
    const automatic = [row(1, { uzkResult: 'вырез' }), ...[1, 2, 3].map(n => row(n + 1, { joint: `S1W${n}`, uzkResult: 'вырез' }))]
    const early = [row(1)]
    for (const [rows, decisions] of [[automatic, undefined], [early, new Set([1])]] as const) {
      expect(continuations(rows, decisions)).toEqual([expect.objectContaining({ kind: 'coil' })])
      const inactive = rows.map((value, i) => i === rows.length - 1 ? { ...value, revisionActuality: 'не актуален' } : value)
      expect(continuations(inactive, decisions)).toEqual([])
      expect(continuations(rows, decisions)).toEqual([expect.objectContaining({ kind: 'coil' })])
    }
  })

  it('keeps an inactive ancestor as history for the active rejected repair and other branches', () => {
    const source = row(1, { revisionActuality: 'не актуален' })
    const repair = row(2, { joint: 'S1R1' })
    const other = row(3, { joint: 'S2', uzkResult: 'вырез' })
    const tasks = buildRepeatedJointTasks([source, repair, other])
    expect(tasks.filter(task => task.kind === 'create')).toEqual([
      expect.objectContaining({ row: repair, targetJoint: 'S1R2' }),
      expect.objectContaining({ row: other, targetJoint: 'S2W1' }),
    ])
    expect(tasks.some(task => task.kind === 'check' && task.reason === 'проверить целостность цепочки')).toBe(false)
  })

  it('does not turn an inactive rejected record into completed work or an unresolved creation debt', () => {
    const source = row(1, { revisionActuality: 'не актуален' })
    expect(buildJointNextActions(source)).toEqual([expect.objectContaining({
      kind: 'blocked', title: 'Продолжение не требуется', tone: 'default',
      description: expect.stringContaining('возврата актуальности'),
    })])
    expect(evaluateEarlyCoilCandidate([source], source).candidate).toBeNull()
  })

  it('keeps integrity corrections visible on an inactive orphan', () => {
    const source = row(1, { joint: 'S1R1', revisionActuality: 'не актуален' })
    const tasks = buildRepeatedJointTasks([source])
    // The physical integrity warning remains the priority action in the picture.
    const check = tasks.find(task => task.kind === 'check' && task.systemWarningCode === 'СП-04')!
    expect(check).toBeDefined()
    expect(buildJointNextActions(source, tasks)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'dispatcherTask', taskKey: check.key }),
    ]))
    expect(continuations([source])).toEqual([])
  })
})
