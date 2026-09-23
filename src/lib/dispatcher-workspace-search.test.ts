import { describe, expect, it } from 'vitest'

import type { LineConsistencyTask, RepeatedJointCheckTask, RepeatedJointCreateTask } from '@/lib/dispatcher-types'
import { matchesDispatcherWorkspaceTask } from '@/lib/dispatcher-workspace-search'
import {
  normalizeDispatcherTaskBatchRequest,
  normalizeDispatcherTaskSearchRequest,
} from '@/server/dispatcher-task-pages'

const task = {
  kind: 'line-consistency',
  key: 'line-control:1',
  row: { id: 1, projectTitle: 'Проект Ёлка', subtitleCode: 'Шифр 7', line: 'Линия A', joint: 'F17' },
  line: 'Линия A',
  projectTitle: 'Проект Ёлка',
  subtitleCode: 'Шифр 7',
  fieldKey: 'controlPresence',
  fieldLabel: 'Назначение контроля',
  title: 'Проверить назначение',
  values: ['РК', 'УЗК'],
  details: 'Нет единообразия на линии.',
} as LineConsistencyTask

describe('dispatcher workspace search', () => {
  it('searches code, joint, project, line, and description without case or ё/е mismatch', () => {
    expect(matchesDispatcherWorkspaceTask(task, 'ДЗ-27 F17', null)).toBe(true)
    expect(matchesDispatcherWorkspaceTask(task, 'елка линия a', null)).toBe(true)
    expect(matchesDispatcherWorkspaceTask(task, 'нет единообразия', null)).toBe(true)
    expect(matchesDispatcherWorkspaceTask(task, '', 'ДЗ-27')).toBe(true)
    expect(matchesDispatcherWorkspaceTask(task, 'F17', 'ДЗ-02')).toBe(false)
    expect(matchesDispatcherWorkspaceTask(task, 'чужой стык', null)).toBe(false)
  })

  it('bounds batch and search requests before any database read', () => {
    expect(normalizeDispatcherTaskBatchRequest({ offset: 5_000, limit: 200, computedRevision: 7 })).toEqual({
      offset: 5_000, limit: 200, computedRevision: 7,
    })
    expect(() => normalizeDispatcherTaskBatchRequest({ offset: -1, limit: 200, computedRevision: 7 })).toThrow()
    expect(() => normalizeDispatcherTaskBatchRequest({ offset: 0, limit: 201, computedRevision: 7 })).toThrow()
    expect(normalizeDispatcherTaskSearchRequest({ search: 'F17', code: null, offset: 0, limit: 100, computedRevision: 7 }))
      .toEqual({ search: 'F17', code: null, offset: 0, limit: 100, computedRevision: 7 })
    expect(() => normalizeDispatcherTaskSearchRequest({ search: '', code: null, offset: 0, limit: 100, computedRevision: 7 })).toThrow()
  })

  it('finds the generated description of checks and creation tasks, not only stored details', () => {
    const check = {
      kind: 'check', key: 'date-check', row: task.row, sourceRow: task.row,
      baseJoint: 'F17', sourceJoint: 'F17R1', reason: 'проверить даты сварки',
    } as RepeatedJointCheckTask
    const create = {
      kind: 'create', key: 'create-repeat', row: task.row, sourceJoint: 'F17',
      targetJoint: 'F17W1', methodCode: 'РК', result: 'вырез', suffix: 'W',
    } as RepeatedJointCreateTask
    expect(matchesDispatcherWorkspaceTask(check, 'нарушает последовательность', null)).toBe(true)
    expect(matchesDispatcherWorkspaceTask(create, 'создание после подтверждения', null)).toBe(true)
    expect(matchesDispatcherWorkspaceTask(create, 'выдуманное описание', null)).toBe(false)
  })
})
