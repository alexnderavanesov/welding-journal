import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { SCHEME_MAX_BYTES, SCHEME_MAX_PAGES } from '@/lib/line-schemes'
import { validateSchemePdf } from './line-scheme-pdf-validation'

export type SchemeFileStore = {
  write: (key: string, body: ReadableStream<Uint8Array>, signal?: AbortSignal) => Promise<{ size: number; digest: string }>
  read: (key: string, start?: number, end?: number) => Readable
  size: (key: string) => Promise<number>
  remove: (key: string) => Promise<void>
  validate: (key: string, signal?: AbortSignal) => Promise<number>
}

export function lineSchemeStorageDirectory() {
  if (process.env.NODE_ENV === 'production' && !process.env.LINE_SCHEME_STORAGE_PATH?.trim()) throw new Error('Не настроено постоянное хранилище схем (LINE_SCHEME_STORAGE_PATH).')
  return resolve(process.env.LINE_SCHEME_STORAGE_PATH?.trim() || 'data/line-schemes')
}

// Parse one upload at a time. Waiting uploads stay on disk, not as 100 MB buffers
// in memory. The isolated parser also bounds memory and can be terminated.
let validationTail: Promise<unknown> = Promise.resolve()
export function createSchemeFileStore(directory: string): SchemeFileStore {
  const path = (key: string) => {
    if (!/^[a-f0-9-]{36}\.pdf$/.test(key)) throw new Error('Недопустимый ключ PDF.')
    return resolve(directory, key)
  }
  return {
    async write(key, body, signal) {
      const final = path(key), temporary = `${final}.tmp`
      await mkdir(directory, { recursive: true })
      let bytes = 0
      const hash = createHash('sha256')
      const limit = new Transform({ transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length
        hash.update(chunk)
        done(bytes > SCHEME_MAX_BYTES ? new Error('Размер PDF превышает 100 МБ.') : null, chunk)
      } })
      try {
        await pipeline(Readable.fromWeb(body as never), limit, createWriteStream(temporary, { flags: 'wx' }), { signal })
        if (!bytes) throw new Error('Загружен пустой файл.')
        const handle = await open(temporary, 'r+'); try { await handle.sync() } finally { await handle.close() }
        await rename(temporary, final)
        const folder = await open(directory, 'r'); try { await folder.sync() } finally { await folder.close() }
        return { size: bytes, digest: hash.digest('hex') }
      } finally { await rm(temporary, { force: true }) }
    },
    read(key, start, end) { return createReadStream(path(key), { start, end }) },
    async size(key) { return (await stat(path(key))).size },
    async remove(key) { await rm(path(key), { force: true }); await rm(`${path(key)}.tmp`, { force: true }) },
    validate(key, signal) {
      const task = validationTail.catch(() => {}).then(async () => {
        signal?.throwIfAborted()
        return validateSchemePdf(path(key), SCHEME_MAX_BYTES, SCHEME_MAX_PAGES, signal)
      })
      validationTail = task.catch(() => {})
      return task
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
