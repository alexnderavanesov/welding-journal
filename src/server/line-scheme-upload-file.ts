import { createWriteStream } from 'node:fs'
import { mkdir, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { SCHEME_MAX_BYTES, SCHEME_MAX_PAGES } from '@/lib/line-schemes'
import { validateSchemePdf } from './line-scheme-pdf-validation'

export type SchemeUploadResult = { size: number; digest: string; pageCount: number }
type StagedPdf = SchemeUploadResult & { path: string; contentMd5: string }
let validationTail: Promise<unknown> = Promise.resolve()

export function assertSchemeFileKey(key: string) {
  if (!/^[a-f0-9-]{36}\.pdf$/.test(key)) throw new Error('Недопустимый ключ PDF.')
}

function stagingDirectory(key: string, parentDirectory: string) {
  assertSchemeFileKey(key)
  return join(parentDirectory, `.scheme-upload-${key}`)
}

/** Called only for unused/expired keys by the existing file cleanup workflow.
 * A stable per-key path also recovers files left by a killed server. */
export async function removeStagedSchemeUpload(key: string, parentDirectory = tmpdir()) {
  await rm(stagingDirectory(key, parentDirectory), { recursive: true, force: true })
}

/** The complete PDF stays on private temporary disk, never in a server Buffer.
 * Both backends share one parser queue. Publish only after parsing succeeds. */
export async function withValidatedSchemeUpload<T>(key: string, body: ReadableStream<Uint8Array>, signal: AbortSignal | undefined,
  publish: (file: StagedPdf) => Promise<T>, parentDirectory = tmpdir()): Promise<T> {
  signal?.throwIfAborted()
  const directory = stagingDirectory(key, parentDirectory)
  // A duplicate in-flight key must not replace or clean another upload's staging file.
  await mkdir(directory, { mode: 0o700 })
  const path = join(directory, 'source.pdf')
  try {
    let size = 0
    const sha256 = createHash('sha256'), md5 = createHash('md5')
    const limit = new Transform({ transform(chunk: Buffer, _encoding, done) {
      size += chunk.length
      if (size > SCHEME_MAX_BYTES) { done(new Error('Размер PDF превышает 100 МБ.')); return }
      sha256.update(chunk); md5.update(chunk)
      done(null, chunk)
    } })
    await pipeline(Readable.fromWeb(body as never), limit, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal })
    if (!size) throw new Error('Загружен пустой файл.')
    const validation = validationTail.catch(() => {}).then(() => {
      signal?.throwIfAborted()
      return validateSchemePdf(path, SCHEME_MAX_BYTES, SCHEME_MAX_PAGES, signal)
    })
    validationTail = validation.catch(() => {})
    const pageCount = await validation
    signal?.throwIfAborted()
    const handle = await open(path, 'r+')
    try { await handle.sync() } finally { await handle.close() }
    return await publish({ path, size, digest: sha256.digest('hex'), contentMd5: md5.digest('base64'), pageCount })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
