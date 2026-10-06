import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { captureProgramChainStates } from './line-program-chain-state'
import { buildProgramIntegrityTasks, getCoilRestorationBlockReason } from './coil-restoration'
import { DEFAULT_SYSTEM_INDEX_SETTINGS as settings } from './system-index-settings'
import { getDispatcherTaskCode, isDispatcherTaskEnabled, DEFAULT_DISPATCHER_SETTINGS } from './dispatcher-settings'
import { getDispatcherTaskActionSpecs } from './dispatcher-task-actions-model'
import { buildJointNextActions } from './joint-next-actions'
import { buildDispatcherTaskCodeIndexRows, buildMergedDispatcherTaskCodes } from './dispatcher-task-row-codes'
import { parseDispatcherTaskIndexPayload, serializeDispatcherTaskIndexPayload } from './dispatcher-task-index-payload'

const root: WeldRow = { id: 1, joint: 'S1', projectTitle: 'P', subtitleCode: 'S', line: 'L', connectionType: 'С17', weldDate: '2026-09-01',
  hasVik: 'да', vikResult: 'годен', hasUzk: 'да', uzkResult: 'годен' }
const repair: WeldRow = { ...root, id: 2, joint: 'S1R1', weldDate: '2026-09-02' }
const coil1: WeldRow = { ...root, id: 3, joint: 'S1Y1', weldDate: '2026-09-03' }
const coil2: WeldRow = { ...coil1, id: 4, joint: 'S1Y2' }
const states = [...captureProgramChainStates([root, repair, coil1, coil2]).values()]
const check = (live: WeldRow[], history = states) => getCoilRestorationBlockReason(live.find(row => row.id === 1)!, live, history, new Set(), settings)

describe('explicit correction of a mistakenly recorded physical coil', () => {
  it('allows a corrected original or a single good mandatory-control repair, without resurrecting automatically', () => {
    expect(check([root])).toBeNull()
    expect(check([{ ...root, uzkResult: 'ремонт' }, repair])).toBeNull()
    expect(states.find(state => state.weldJointId === 1)?.replacedByCoil).toBe(true)
  })
  it.each(['S0', 'S99'])('uses saved links, not name order, for the renamed good repair %s', joint => {
    expect(check([{ ...root, uzkResult: 'ремонт' }, { ...repair, joint }])).toBeNull()
  })
  it('does not overlook a missing predecessor when a repair was renamed outside the original name group', () => {
    const brokenStates = states.map(state => state.weldJointId === repair.id ? { ...state, sourceRowId: 999 } : state)
    expect(check([{ ...root, uzkResult: 'ремонт' }, { ...repair, joint: 'S99' }], brokenStates)).toContain('связи цепочки')
  })
  it.each(['intermediate', 'unofficial'])('does not restore a cut root while %s history has mixed actuality', variant => {
    const live = [{ ...root, uzkResult: 'ремонт' },
      { ...repair, uzkResult: 'ремонт', revisionActuality: 'не актуален', ...(variant === 'unofficial' ? { officiality: 'неофициальный' } : {}) },
      { ...repair, id: 5, joint: variant === 'unofficial' ? 'S1R1' : 'S1R2', weldDate: '2026-09-03' }]
    const history = [...captureProgramChainStates([...live, coil1, coil2]).values()]
    expect(check(live, history)).toContain('актуальность')
    expect(check(live.map(row => ({ ...row, revisionActuality: null })), history)).toBeNull()
  })
  it.each([
    [root, coil1], [root, coil2], [root, { ...coil1, line: 'Other', joint: 'Renamed', officiality: 'неофициальный' }],
  ])('blocks any surviving side, regardless of name, line or officiality', (...live) => {
    expect(check(live)).toContain('Сохранились стороны катушки')
  })
  it('blocks a surviving descendant through deleted intermediate coil nodes', () => {
    const descendant = { ...repair, id: 5, joint: 'S1Y1R1', line: 'Other' }
    const captured = [...captureProgramChainStates([root, coil1, coil2, { ...descendant, line: 'L' }]).values()]
    expect(check([root, descendant], captured)).toContain('Сохранились стороны катушки')
  })
  it.each([
    [{ ...root, uzkResult: null }],
    [root, repair],
    [{ ...root, uzkResult: 'ремонт' }, { ...repair, officiality: 'неофициальный' }],
    [{ ...root, uzkResult: 'ремонт' }, { ...repair, revisionActuality: 'не актуален' }],
    [{ ...root, uzkResult: 'ремонт' }, { ...repair, line: 'Other' }],
    [{ ...root, uzkResult: 'ремонт' }, { ...repair, hasUzk: null, uzkResult: null }],
  ])('blocks unfinished, excluded, duplicated or moved finals', (...live) => {
    expect(check(live)).not.toBeNull()
  })
  it('blocks erased historical identities rather than trusting a reused name', () => {
    expect(check([root], states.filter(state => state.kind !== 'coil'))).toContain('Недостаточно сохранённых связей')
    const unrelated = { ...repair, id: 99 }
    expect(getCoilRestorationBlockReason(root, [root], states, new Set(), settings, [root, unrelated])).toContain('несвязанные продолжения')
  })
  it('does not allow new namesakes to manufacture proof of an old replacement', () => {
    const rootState = { ...states[0], replacementCoilIds: [] }
    const recreated = [...captureProgramChainStates([{ ...root, programChainState: rootState },
      { ...coil1, id: 30 }, { ...coil2, id: 40 }]).values()]
    expect(check([root], recreated)).toContain('Недостаточно сохранённых связей')
  })
  it('records new coil IDs only after a new replacement following explicit restoration', () => {
    const restored = { ...states[0], replacedByCoil: false }
    const next = captureProgramChainStates([{ ...root, programChainState: restored }, { ...coil1, id: 30 }, { ...coil2, id: 40 }])
    expect(next.get(1)).toMatchObject({ replacedByCoil: true, replacementCoilIds: [30, 40] })
    expect(states[0].replacementCoilIds).toEqual([3, 4])
  })
  it('keeps physical integrity visible in dispatcher, persisted codes, virtual field and next step', () => {
    const savedRoot = { ...root, programChainState: states[0] }
    const tasks = buildProgramIntegrityTasks([savedRoot])
    expect(tasks).toHaveLength(1)
    expect(getDispatcherTaskCode(tasks[0])).toBe('СП-04')
    expect(isDispatcherTaskEnabled(tasks[0], Object.fromEntries(Object.keys(DEFAULT_DISPATCHER_SETTINGS).map(key => [key, false])) as typeof DEFAULT_DISPATCHER_SETTINGS)).toBe(true)
    expect(getDispatcherTaskActionSpecs(tasks[0])[0].id).toBe('restore-coil')
    const saved = parseDispatcherTaskIndexPayload(serializeDispatcherTaskIndexPayload(tasks)).tasks
    const index = buildDispatcherTaskCodeIndexRows(saved, [savedRoot])
    expect([...buildMergedDispatcherTaskCodes(index, []).allByRowId]).toEqual([[1, 'СП-04']])
    expect(buildJointNextActions(savedRoot, tasks).some(action => action.kind === 'complete')).toBe(false)
    expect(buildJointNextActions(savedRoot, tasks)[0].taskActionId).toBe('restore-coil')
  })
})
