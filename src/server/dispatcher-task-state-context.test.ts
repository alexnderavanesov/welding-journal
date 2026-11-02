import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { dispatcherTaskIndexState } from '@/db/schema'
import {
  DISPATCHER_TASK_CALCULATION_VERSION,
  parseDispatcherTaskIndexPayload,
  serializeDispatcherTaskIndexPayload,
} from '@/lib/dispatcher-task-index-payload'
import type { JointChainContinuation } from '@/lib/dispatcher-types'
import { isDispatcherTaskIndexFresh } from './dispatcher-task-index'
import { readDispatcherTaskStateContext } from './dispatcher-task-state-context'

const continuation: JointChainContinuation = {
  kind: 'official-joint', sourceRowId: 1, sourceJoint: 'F1', targetRowIds: [2],
  targetJoints: ['F1'], projectTitle: 'P', subtitleCode: 'S', line: 'L',
}

function freshState(): typeof dispatcherTaskIndexState.$inferSelect {
  return {
    id: 1, sourceRevision: 7, computedRevision: 7, fullRebuild: false,
    repeatedTasks: serializeDispatcherTaskIndexPayload([], [continuation]),
    duplicateKeys: '[]', welderStampExpiryTasks: '[]', dirtyScopes: '[]',
    computedAt: new Date(), updatedAt: new Date(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-01T20:59:00Z'))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('dispatcher state read context', () => {
  it('parses a state once for freshness and repeated chain reads without retaining the task snapshot', () => {
    const state = freshState()
    const parse = vi.spyOn(JSON, 'parse')
    expect(isDispatcherTaskIndexFresh(state)).toBe(true)
    const context = readDispatcherTaskStateContext(state)
    expect(readDispatcherTaskStateContext(state)).toBe(context)
    expect(isDispatcherTaskIndexFresh(state)).toBe(true)
    expect(context).toEqual({ version: DISPATCHER_TASK_CALCULATION_VERSION, chainContinuations: [continuation] })
    expect(parse.mock.calls.filter(([raw]) => raw === state.repeatedTasks)).toHaveLength(1)
  })

  it('reparses an in-place payload replacement and independently parses a new database state object', () => {
    const state = freshState()
    const initialRaw = state.repeatedTasks
    const parse = vi.spyOn(JSON, 'parse')
    const before = readDispatcherTaskStateContext(state)
    state.repeatedTasks = serializeDispatcherTaskIndexPayload([], [{ ...continuation, targetRowIds: [3], targetJoints: ['F1W1'] }])
    const after = readDispatcherTaskStateContext(state)
    expect(after).not.toBe(before)
    expect(after.chainContinuations[0]?.targetRowIds).toEqual([3])
    expect(before.chainContinuations[0]?.targetRowIds).toEqual([2])
    const separatelyRead = readDispatcherTaskStateContext({ ...state })
    expect(separatelyRead).toEqual(after)
    expect(separatelyRead).not.toBe(after)
    expect(separatelyRead.chainContinuations).not.toBe(after.chainContinuations)
    expect(parse.mock.calls.filter(([raw]) => raw === initialRaw)).toHaveLength(1)
    expect(parse.mock.calls.filter(([raw]) => raw === state.repeatedTasks)).toHaveLength(2)
  })

  it.each(['', 'not JSON', 'null', '[]', '{"version":1,"chainContinuations":[]}',
    '{"version":"76","chainContinuations":null}'])('preserves parser and stale-rule behavior for %s', raw => {
    const expected = parseDispatcherTaskIndexPayload(raw)
    const state = { ...freshState(), repeatedTasks: raw }
    expect(readDispatcherTaskStateContext(state)).toEqual({ version: expected.version, chainContinuations: expected.chainContinuations })
    expect(isDispatcherTaskIndexFresh(state)).toBe(false)
  })

  it('does not reuse an earlier current-version verdict after the same state receives obsolete rules', () => {
    const state = freshState()
    expect(isDispatcherTaskIndexFresh(state)).toBe(true)
    state.repeatedTasks = JSON.stringify({ version: DISPATCHER_TASK_CALCULATION_VERSION - 1, chainContinuations: [continuation] })
    expect(isDispatcherTaskIndexFresh(state)).toBe(false)
    expect(readDispatcherTaskStateContext(state).chainContinuations).toEqual([continuation])
  })

  it('rechecks revisions, full rebuild, dirty scopes and computation time on the cached state', () => {
    const state = freshState()
    const context = readDispatcherTaskStateContext(state)
    expect(isDispatcherTaskIndexFresh(state)).toBe(true)
    state.sourceRevision++
    expect(isDispatcherTaskIndexFresh(state)).toBe(false)
    state.computedRevision++
    state.fullRebuild = true
    expect(isDispatcherTaskIndexFresh(state)).toBe(false)
    state.fullRebuild = false
    state.dirtyScopes = JSON.stringify([{ projectTitle: 'P', subtitleCode: 'S', line: 'L' }])
    expect(isDispatcherTaskIndexFresh(state)).toBe(false)
    state.dirtyScopes = 'invalid'
    expect(isDispatcherTaskIndexFresh(state)).toBe(false)
    state.dirtyScopes = '[]'
    state.computedAt = null
    expect(isDispatcherTaskIndexFresh(state)).toBe(false)
    state.computedAt = new Date()
    expect(isDispatcherTaskIndexFresh(state)).toBe(true)
    expect(readDispatcherTaskStateContext(state)).toBe(context)
  })

  it('expires at the next Moscow business day even with the same state and payload', () => {
    const state = freshState()
    const context = readDispatcherTaskStateContext(state)
    expect(isDispatcherTaskIndexFresh(state)).toBe(true)
    vi.setSystemTime(new Date('2026-11-01T21:00:00Z'))
    expect(isDispatcherTaskIndexFresh(state)).toBe(false)
    expect(readDispatcherTaskStateContext(state)).toBe(context)
  })

  it('reuses an explicitly supplied read only after comparing the complete payload, without retaining task cards', () => {
    const source = freshState()
    const parse = vi.spyOn(JSON, 'parse')
    expect(isDispatcherTaskIndexFresh(source)).toBe(true)
    const target = { ...source, repeatedTasks: Buffer.from(source.repeatedTasks).toString('utf8') }
    expect(isDispatcherTaskIndexFresh(target, source)).toBe(true)
    expect(readDispatcherTaskStateContext(target)).toBe(readDispatcherTaskStateContext(source))
    expect(parse.mock.calls.filter(([raw]) => raw === target.repeatedTasks)).toHaveLength(1)
    expect(Object.keys(readDispatcherTaskStateContext(target)).sort()).toEqual(['chainContinuations', 'version'])
  })

  it('independently parses changed target content, an uncached hint, and a hint changed in place since parsing', () => {
    const source = freshState()
    const previous = readDispatcherTaskStateContext(source)
    const changed = serializeDispatcherTaskIndexPayload([], [{ ...continuation, targetRowIds: [9] }])
    const target = { ...source, repeatedTasks: changed }
    const parse = vi.spyOn(JSON, 'parse')
    const next = readDispatcherTaskStateContext(target, source)
    expect(next.chainContinuations[0].targetRowIds).toEqual([9])
    expect(next).not.toBe(previous)
    expect(parse.mock.calls.filter(([raw]) => raw === changed)).toHaveLength(1)

    const uncachedHint = freshState()
    const independent = readDispatcherTaskStateContext({ ...uncachedHint }, uncachedHint)
    expect(independent).toEqual(previous)
    expect(independent).not.toBe(previous)
    expect(parse.mock.calls.filter(([raw]) => raw === uncachedHint.repeatedTasks)).toHaveLength(1)

    source.repeatedTasks = changed
    const afterHintMutation = readDispatcherTaskStateContext({ ...source }, source)
    expect(afterHintMutation).toEqual(next)
    expect(afterHintMutation).not.toBe(previous)
    expect(afterHintMutation).not.toBe(next)
    expect(parse.mock.calls.filter(([raw]) => raw === changed)).toHaveLength(2)
  })

  it('shares only payload interpretation; target freshness always uses its independently read headers and business date', () => {
    const source = freshState()
    readDispatcherTaskStateContext(source)
    const target = { ...source }
    expect(isDispatcherTaskIndexFresh(target, source)).toBe(true)
    expect(readDispatcherTaskStateContext(target)).toBe(readDispatcherTaskStateContext(source))
    for (const patch of [
      { sourceRevision: target.sourceRevision + 1 },
      { fullRebuild: true },
      { dirtyScopes: '[{"projectTitle":"P","subtitleCode":"S","line":"L"}]' },
      { dirtyScopes: 'invalid' },
      { computedAt: null },
      { computedAt: new Date('2026-10-31T20:59:00Z') },
    ]) expect(isDispatcherTaskIndexFresh({ ...target, ...patch }, source)).toBe(false)
    for (const raw of ['invalid', JSON.stringify({ version: DISPATCHER_TASK_CALCULATION_VERSION - 1, chainContinuations: [continuation] })]) {
      const obsolete = { ...target, repeatedTasks: raw }
      readDispatcherTaskStateContext(obsolete)
      expect(isDispatcherTaskIndexFresh({ ...obsolete }, obsolete)).toBe(false)
    }
    // A stale source cannot make an independently fresh target stale; its
    // different headers prevent hint reuse before a full string comparison.
    source.sourceRevision++
    const newer = { ...source, computedRevision: source.sourceRevision }
    expect(isDispatcherTaskIndexFresh(source)).toBe(false)
    expect(isDispatcherTaskIndexFresh(newer, source)).toBe(true)
    expect(readDispatcherTaskStateContext(newer)).toEqual(readDispatcherTaskStateContext(source))
    expect(readDispatcherTaskStateContext(newer)).not.toBe(readDispatcherTaskStateContext(source))
  })

  it('does not inspect the source hint when cheap target guards already reject the independently read state', () => {
    const hint = { ...freshState(), get repeatedTasks(): string { throw new Error('must not inspect hint') } }
    const fresh = freshState()
    const parse = vi.spyOn(JSON, 'parse')
    expect(isDispatcherTaskIndexFresh(undefined, hint)).toBe(false)
    expect(isDispatcherTaskIndexFresh({ ...fresh, sourceRevision: fresh.sourceRevision + 1 }, hint)).toBe(false)
    expect(isDispatcherTaskIndexFresh({ ...fresh, computedAt: null }, hint)).toBe(false)
    expect(parse).not.toHaveBeenCalled()
  })

  it('skips an otherwise cached raw hint when its independently read metadata differs', () => {
    for (const patch of [
      { sourceRevision: 8 }, { computedRevision: 8 },
      { computedAt: new Date('2026-11-01T20:58:00Z') },
      { updatedAt: new Date('2026-11-01T20:58:00Z') },
    ]) {
      const source = freshState(), target = { ...source }
      readDispatcherTaskStateContext(source)
      Object.assign(source, patch)
      Object.defineProperty(source, 'repeatedTasks', { get() { throw new Error('header mismatch must skip raw comparison') } })
      expect(isDispatcherTaskIndexFresh(target, source)).toBe(true)
    }
  })
})
