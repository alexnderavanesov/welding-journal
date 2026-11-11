import { createReadStream } from 'node:fs'
import { link, mkdir, open, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { assertSchemeFileKey, removeStagedSchemeUpload, withValidatedSchemeUpload, type SchemeUploadResult } from './line-scheme-upload-file'

export type SchemeFileStore = {
  upload: (key: string, body: ReadableStream<Uint8Array>, signal?: AbortSignal) => Promise<SchemeUploadResult>
  read: (key: string, start?: number, end?: number, signal?: AbortSignal) => Promise<{ stream: Readable; size: number }>
  size: (key: string, signal?: AbortSignal) => Promise<number>
  remove: (key: string, signal?: AbortSignal) => Promise<void>
}

export function lineSchemeStorageDirectory() {
  if (process.env.NODE_ENV === 'production' && !process.env.LINE_SCHEME_STORAGE_PATH?.trim()) throw new Error('Не настроено постоянное хранилище схем (LINE_SCHEME_STORAGE_PATH).')
  return resolve(process.env.LINE_SCHEME_STORAGE_PATH?.trim() || 'data/line-schemes')
}

export function createSchemeFileStore(directory: string): SchemeFileStore {
  const path = (key: string) => {
    assertSchemeFileKey(key)
    return resolve(directory, key)
  }
  return {
    async upload(key, body, signal) {
      const final = path(key)
      signal?.throwIfAborted()
      await mkdir(directory, { recursive: true })
      return withValidatedSchemeUpload(key, body, signal, async file => {
        signal?.throwIfAborted()
        // Same-filesystem atomic publication; an existing revision is never overwritten.
        await link(file.path, final)
        const folder = await open(directory, 'r'); try { await folder.sync() } finally { await folder.close() }
        return { size: file.size, digest: file.digest, pageCount: file.pageCount }
      }, directory)
    },
    async read(key, start, end, signal) {
      const file = path(key)
      signal?.throwIfAborted()
      const size = (await stat(file)).size
      signal?.throwIfAborted()
      return { size, stream: createReadStream(file, { start, end, signal }) }
    },
    async size(key, signal) { signal?.throwIfAborted(); return (await stat(path(key))).size },
    async remove(key, signal) {
      signal?.throwIfAborted()
      await rm(path(key), { force: true }); await rm(`${path(key)}.tmp`, { force: true })
      await removeStagedSchemeUpload(key, directory)
    },
  }
}

export function parseSchemeRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) throw new Error('RANGE')
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] ? match[2] ? Math.min(size - 1, Number(match[2])) : size - 1 : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new Error('RANGE')
  return { start, end }
}
