import type { RepeatedJointTask, WelderStampExpiryTask } from './dispatcher-types'

export type DispatcherTaskSnapshotResult = {
  duplicateKeys: string[]
  repeatedJointTasks: RepeatedJointTask[]
  taskFilterOptions: Array<{ value: string; count: number; label: string }>
  welderStampExpiryTasks: WelderStampExpiryTask[]
  repeatedJointTaskCount: number
  repeatedJointTaskPageCount: number
  repeatedJointTasksTruncated: boolean
  sourceRevision: number
  computedRevision: number
  isFresh: boolean
  computedAt: string
}

export type CompressedDispatcherSnapshot = {
  encoding: 'gzip-base64-v1'
  summary: string
  taskChunks: string[]
}

// Older browsers and already-open clients can continue using the original DTO.
// Capability negotiation adds no request and never changes counts or task limits.
export function dispatcherSnapshotRequest(): { transport?: 'gzip-v1' } {
  return typeof DecompressionStream === 'function' && typeof Blob.prototype.stream === 'function'
    ? { transport: 'gzip-v1' } : {}
}

export async function decodeDispatcherSnapshot(wire: CompressedDispatcherSnapshot | DispatcherTaskSnapshotResult): Promise<DispatcherTaskSnapshotResult> {
  if (!('encoding' in wire)) return wire
  async function unpack(value: string) {
    const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return JSON.parse(await new Response(stream).text())
  }
  try {
    const summary = await unpack(wire.summary) as Omit<DispatcherTaskSnapshotResult, 'repeatedJointTasks'>
    const repeatedJointTasks: RepeatedJointTask[] = []
    // Sequential decoding bounds temporary strings/buffers; do not fan out 50
    // decompression streams or retain another full copy of the parsed task graph.
    for (const chunk of wire.taskChunks) repeatedJointTasks.push(...await unpack(chunk) as RepeatedJointTask[])
    return { ...summary, repeatedJointTasks }
  } catch (cause) {
    throw new Error('Не удалось прочитать задачи диспетчера. Повторите загрузку.', { cause })
  }
}
