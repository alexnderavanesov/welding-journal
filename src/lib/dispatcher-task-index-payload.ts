import type { JointChainContinuation, RepeatedJointTask } from '@/lib/dispatcher-types'

// Increment when dispatcher rules change in a way that requires existing rows
// to be recalculated without a corresponding database mutation.
export const DISPATCHER_TASK_CALCULATION_VERSION = 39
export const DISPATCHER_TASK_PAGE_SIZE = 100

type DispatcherTaskIndexPayload = {
  version: number
  chainContinuations: JointChainContinuation[]
  tasks: RepeatedJointTask[]
  totalTaskCount: number
  totalPageCount: number
  tasksTruncated: boolean
  taskFilterOptions: Array<{ value: string; count: number }> | null
}

export function serializeDispatcherTaskIndexPayload(
  tasks: RepeatedJointTask[],
  chainContinuations: JointChainContinuation[] = [],
  metadata: {
    totalTaskCount?: number
    totalPageCount?: number
    tasksTruncated?: boolean
    taskFilterOptions?: Array<{ value: string; count: number }>
  } = {},
) {
  const totalTaskCount = Math.max(tasks.length, isNonNegativeSafeInteger(metadata.totalTaskCount)
    ? metadata.totalTaskCount : 0)
  const totalPageCount = isNonNegativeSafeInteger(metadata.totalPageCount)
    ? metadata.totalPageCount
    : Math.ceil(totalTaskCount / DISPATCHER_TASK_PAGE_SIZE)
  return JSON.stringify({
    version: DISPATCHER_TASK_CALCULATION_VERSION,
    chainContinuations,
    tasks,
    totalTaskCount,
    totalPageCount,
    tasksTruncated: metadata.tasksTruncated ?? totalTaskCount > tasks.length,
    taskFilterOptions: metadata.taskFilterOptions
      ? normalizeTaskFilterOptions(metadata.taskFilterOptions)
      : null,
  } satisfies DispatcherTaskIndexPayload)
}

export function parseDispatcherTaskIndexPayload(value: unknown): DispatcherTaskIndexPayload {
  const parsed = parseJson(value)
  if (Array.isArray(parsed)) {
    return {
      version: 0,
      chainContinuations: [],
      tasks: parsed as RepeatedJointTask[],
      totalTaskCount: parsed.length,
      totalPageCount: Math.ceil(parsed.length / DISPATCHER_TASK_PAGE_SIZE),
      tasksTruncated: false,
      taskFilterOptions: null,
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return {
      version: 0,
      chainContinuations: [],
      tasks: [],
      totalTaskCount: 0,
      totalPageCount: 0,
      tasksTruncated: false,
      taskFilterOptions: null,
    }
  }
  const payload = parsed as Partial<DispatcherTaskIndexPayload>
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : []
  const totalTaskCount = Math.max(
    tasks.length,
    isNonNegativeSafeInteger(payload.totalTaskCount) ? payload.totalTaskCount : 0,
  )
  return {
    version: typeof payload.version === 'number' ? payload.version : 0,
    chainContinuations: Array.isArray(payload.chainContinuations) ? payload.chainContinuations : [],
    tasks,
    totalTaskCount,
    totalPageCount: isNonNegativeSafeInteger(payload.totalPageCount)
      ? payload.totalPageCount
      : Math.ceil(totalTaskCount / DISPATCHER_TASK_PAGE_SIZE),
    tasksTruncated: payload.tasksTruncated === true || totalTaskCount > tasks.length,
    taskFilterOptions: Array.isArray(payload.taskFilterOptions)
      ? normalizeTaskFilterOptions(payload.taskFilterOptions)
      : null,
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
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

function normalizeTaskFilterOptions(value: Array<{ value: string; count: number }>) {
  return value.flatMap((option) => {
    const code = String(option?.value ?? '').trim()
    const count = Number(option?.count)
    return code && Number.isFinite(count) && count >= 0
      ? [{ value: code, count: Math.floor(count) }]
      : []
  })
}
