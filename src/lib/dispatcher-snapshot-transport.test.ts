import { Blob as StreamBlob } from 'node:buffer'
import { DecompressionStream as NativeDecompressionStream } from 'node:stream/web'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { decodeDispatcherSnapshot, dispatcherSnapshotRequest, type DispatcherTaskSnapshotResult } from './dispatcher-snapshot-transport'
import { encodeDispatcherSnapshot } from '../server/dispatcher-snapshot-transport'
import type { RepeatedJointTask } from './dispatcher-types'

// JSDOM's Blob lacks stream(); exercise the native web-stream implementation.
beforeEach(() => { vi.stubGlobal('Blob', StreamBlob); vi.stubGlobal('DecompressionStream', NativeDecompressionStream) })
afterEach(() => vi.unstubAllGlobals())

it.each([0, 1, 100, 101, 5000])('transports every one of %i tasks in bounded chunks with unchanged metadata', async count => {
  const tasks = Array.from({ length: count }, (_, id) => ({ kind: 'create', key: `task:${id}`,
    row: { id, joint: `S${id}`, projectTitle: '<Проект> "А"', line: 'Л\u00a02',
      pstoNote: 'Двойной  пробел\nследующая строка', pstoRepeatCycles: [{ id: id + 10, weldJointId: id, sequence: 2, pstoNote: 'факт' }] },
    sourceJoint: `S${id}`, targetJoint: `S${id}R1`, result: 'ремонт', suffix: 'R', methodCode: 'РК',
  })) as RepeatedJointTask[]
  const snapshot: DispatcherTaskSnapshotResult = { repeatedJointTasks: tasks, duplicateKeys: ['a', 'b', '__proto__'],
    welderStampExpiryTasks: [], taskFilterOptions: [{ value: 'ДЗ-01', label: 'Проверка', count: 200000 }],
    repeatedJointTaskCount: 200000, repeatedJointTaskPageCount: 2000, repeatedJointTasksTruncated: true,
    sourceRevision: 21, computedRevision: 20, computedAt: '2026-10-09T00:00:00Z', isFresh: false }
  const wire = await encodeDispatcherSnapshot(snapshot)
  expect(wire).not.toHaveProperty('repeatedJointTasks')
  expect(wire.taskChunks).toHaveLength(Math.ceil(count / 100))
  for (const chunk of wire.taskChunks) expect(JSON.parse(gunzipSync(Buffer.from(chunk, 'base64')).toString()).length).toBeLessThanOrEqual(100)
  expect(await decodeDispatcherSnapshot(JSON.parse(JSON.stringify(wire)))).toStrictEqual(snapshot)
  expect(snapshot.repeatedJointTasks).toBe(tasks)
})

it('preserves check source rows, root-cause actions and welder expiry facts without filtering fields', async () => {
  const row = { id: 7, joint: 'S7', material1: '09Г2С', technologyCardNumber: 'ТК №12' }
  const permit = { weldType: 'РД', materialGroups: 'M01, M05', diameterFrom: '1', diameterTo: '100',
    thicknessFrom: '1', thicknessTo: '10', validFrom: '2026-01-01', validTo: '2026-10-10', note: 'Примечание' }
  const snapshot: DispatcherTaskSnapshotResult = { repeatedJointTasks: [{ kind: 'check', key: 'check:7', row, sourceRow: row,
    sourceJoint: 'S7', targetJoint: 'S7R1', baseJoint: 'S7', suffix: 'R', reason: 'Причина',
    rootCauseActions: [{ key: 'open:7', label: 'Исправить дату', target: { kind: 'weld-field', rowId: 7, fieldKey: 'weldDate' } }], actualityRowIds: [7, 8] }],
    duplicateKeys: [], welderStampExpiryTasks: [{ kind: 'welder-stamp-expiry', key: 'stamp:1',
      stamp: { ...permit, id: 1, naksStamp: 'К1', welderName: 'Сварщик', internalStamp: '1', archived: false,
        naksPermits: [{ ...permit, id: 'n1' }], dlsPermits: [] },
      naksStamp: 'К1', permitKind: 'naks', validTo: '2026-10-10', expired: false, daysLeft: 1 }],
    sourceRevision: 2, computedRevision: 2, isFresh: true, computedAt: '2026-10-09T00:00:00Z',
    repeatedJointTaskCount: 1, repeatedJointTaskPageCount: 1, repeatedJointTasksTruncated: false,
    taskFilterOptions: [],
  }
  expect(await decodeDispatcherSnapshot(await encodeDispatcherSnapshot(snapshot))).toStrictEqual(snapshot)
  expect(await decodeDispatcherSnapshot(snapshot)).toBe(snapshot)
})

it('bounds bytes through compression, not by reducing the task list', async () => {
  const tasks = Array.from({ length: 5000 }, (_, id) => {
    const row = { id, joint: `Стык ${id}`, projectTitle: 'Большой проект', subtitleCode: 'ПРОЕКТ-2026-001', line: `Л${Math.floor(id / 100)}` }
    return { kind: 'check', key: `check:${id}`, row, sourceRow: row,
      sourceJoint: row.joint, targetJoint: row.joint, baseJoint: row.joint, suffix: 'R',
      details: 'Проверьте сведения в карточке стыка и связанные документы перед продолжением работы. '.repeat(5),
      actualityRowIds: [id], systemWarningCode: 'СП-02' }
  })
  const snapshot = { repeatedJointTasks: tasks, duplicateKeys: [], welderStampExpiryTasks: [],
    taskFilterOptions: [], repeatedJointTaskCount: 5000, repeatedJointTaskPageCount: 50,
    repeatedJointTasksTruncated: false, sourceRevision: 1, computedRevision: 1, isFresh: true, computedAt: '',
  } as DispatcherTaskSnapshotResult
  const wire = await encodeDispatcherSnapshot(snapshot)
  expect(new TextEncoder().encode(JSON.stringify(wire)).length)
    .toBeLessThan(new TextEncoder().encode(JSON.stringify(snapshot)).length * 0.6)
  expect(await decodeDispatcherSnapshot(wire)).toStrictEqual(snapshot)
})

it('negotiates compression only when the client supports it', () => {
  expect(dispatcherSnapshotRequest()).toEqual({ transport: 'gzip-v1' })
  vi.stubGlobal('Blob', class {})
  expect(dispatcherSnapshotRequest()).toEqual({})
  vi.stubGlobal('Blob', StreamBlob)
  vi.stubGlobal('DecompressionStream', undefined)
  expect(dispatcherSnapshotRequest()).toEqual({})
})

it('rejects a corrupted response instead of publishing partial or empty task data', async () => {
  await expect(decodeDispatcherSnapshot({ encoding: 'gzip-base64-v1', summary: 'invalid', taskChunks: [] })).rejects.toThrow()
})

it('rejects the complete response if a later task chunk is corrupt after valid data was decoded', async () => {
  const snapshot: DispatcherTaskSnapshotResult = { duplicateKeys: [], taskFilterOptions: [], welderStampExpiryTasks: [],
    repeatedJointTasks: Array.from({ length: 101 }, (_, id) => ({ kind: 'create', key: `create:${id}`, row: { id },
      sourceJoint: `S${id}`, targetJoint: `S${id}R1`, result: 'ремонт', suffix: 'R', methodCode: 'РК' })),
    repeatedJointTaskCount: 101, repeatedJointTaskPageCount: 2, repeatedJointTasksTruncated: false,
    sourceRevision: 7, computedRevision: 7, computedAt: '2026-10-09T00:00:00Z', isFresh: true }
  const wire = await encodeDispatcherSnapshot(snapshot)
  wire.taskChunks[1] = '%corrupt%'
  await expect(decodeDispatcherSnapshot(wire)).rejects.toThrow('Не удалось прочитать задачи диспетчера')
  expect(await decodeDispatcherSnapshot(await encodeDispatcherSnapshot(snapshot))).toStrictEqual(snapshot)
})
