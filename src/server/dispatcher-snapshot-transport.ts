import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import type { CompressedDispatcherSnapshot, DispatcherTaskSnapshotResult } from '@/lib/dispatcher-snapshot-transport'

const compress = promisify(gzip)

/** Lossless transport only. Never trim task fields or change the stored index. */
export async function encodeDispatcherSnapshot(snapshot: DispatcherTaskSnapshotResult): Promise<CompressedDispatcherSnapshot> {
  const { repeatedJointTasks, ...summary } = snapshot
  const pack = async (value: unknown) => (await compress(JSON.stringify(value), { level: 1 })).toString('base64')
  const taskChunks: string[] = []
  for (let offset = 0; offset < repeatedJointTasks.length; offset += 100) {
    taskChunks.push(await pack(repeatedJointTasks.slice(offset, offset + 100)))
  }
  return { encoding: 'gzip-base64-v1', summary: await pack(summary), taskChunks }
}
