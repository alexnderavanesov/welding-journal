import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DISPATCHER_TASK_CALCULATION_VERSION, serializeDispatcherTaskIndexPayload } from '@/lib/dispatcher-task-index-payload'
import type { RepeatedJointTask } from '@/lib/dispatcher-types'
import { getDispatcherTaskIndexSnapshot } from './dispatcher-task-index'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ execute: mocks.execute }) }))

const task = { kind: 'check', key: 'old-completeness', row: { id: 1, joint: 'F1' },
  sourceJoint: 'F1', targetJoint: 'F1', baseJoint: 'F1', suffix: 'R',
  reason: 'дозаполнить результат ЛНК', details: 'Нет даты заключения.' } as RepeatedJointTask

beforeEach(() => { mocks.execute.mockReset() })

describe('dispatcher snapshots across a calculation-version change', () => {
  it.each([0, 72, 73])('does not reinterpret tasks from version %s through the current rule catalogue', async version => {
    expect(version).toBeLessThan(DISPATCHER_TASK_CALCULATION_VERSION)
    const payload = JSON.parse(serializeDispatcherTaskIndexPayload([task], [], {
      taskFilterOptions: [{ value: 'СП-11', count: 1 }],
    }))
    payload.version = version
    mocks.execute.mockResolvedValueOnce({ rows: [{
      sourceRevision: 7, computedRevision: 7, computedAt: new Date(), updatedAt: new Date(),
      repeatedTasks: JSON.stringify(payload), duplicateKeys: '[]', welderStampExpiryTasks: '[]',
      dirtyScopes: '[]', fullRebuild: false,
    }] }).mockResolvedValue({ rows: [] })
    const snapshot = await getDispatcherTaskIndexSnapshot({ scheduleRefresh: false })
    expect(snapshot).toMatchObject({ isFresh: false, repeatedJointTasks: [], repeatedJointTaskCount: 0,
      repeatedJointTaskPageCount: 0, repeatedJointTasksTruncated: false, taskFilterOptions: [] })
    // Reading the obsolete cache must neither calculate it synchronously nor scan its row codes.
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('preserves a stale data snapshot when its calculation version is still current', async () => {
    const currentTask = { ...task, key: 'chronology', reason: 'проверить даты ЛНК', systemWarningCode: 'СП-04' } as RepeatedJointTask
    mocks.execute.mockResolvedValueOnce({ rows: [{
      sourceRevision: 8, computedRevision: 7, computedAt: new Date(), updatedAt: new Date(),
      repeatedTasks: serializeDispatcherTaskIndexPayload([currentTask], [], { taskFilterOptions: [] }),
      duplicateKeys: '[]', welderStampExpiryTasks: '[]', dirtyScopes: '[]', fullRebuild: false,
    }] }).mockResolvedValue({ rows: [] })
    const snapshot = await getDispatcherTaskIndexSnapshot({ scheduleRefresh: false })
    expect(snapshot.isFresh).toBe(false)
    expect(snapshot.repeatedJointTasks).toEqual([currentTask])
    expect(snapshot.repeatedJointTaskCount).toBe(1)
  })
})
