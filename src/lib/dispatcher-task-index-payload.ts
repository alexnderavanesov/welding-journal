import type { RepeatedJointTask } from '@/lib/dispatcher-types'

// Increment when dispatcher rules change in a way that requires existing rows
// to be recalculated without a corresponding database mutation.
export const DISPATCHER_TASK_CALCULATION_VERSION = 8

type DispatcherTaskIndexPayload = {
  version: number
  tasks: RepeatedJointTask[]
}

export function serializeDispatcherTaskIndexPayload(tasks: RepeatedJointTask[]) {
  return JSON.stringify({
    version: DISPATCHER_TASK_CALCULATION_VERSION,
    tasks,
  } satisfies DispatcherTaskIndexPayload)
}

export function parseDispatcherTaskIndexPayload(value: unknown): DispatcherTaskIndexPayload {
  const parsed = parseJson(value)
  if (Array.isArray(parsed)) {
    return { version: 0, tasks: parsed as RepeatedJointTask[] }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { version: 0, tasks: [] }
  }
  const payload = parsed as Partial<DispatcherTaskIndexPayload>
  return {
    version: typeof payload.version === 'number' ? payload.version : 0,
    tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
  }
}

export function isDispatcherTaskIndexPayloadCurrent(value: unknown) {
  return parseDispatcherTaskIndexPayload(value).version === DISPATCHER_TASK_CALCULATION_VERSION
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (!value.trim()) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
