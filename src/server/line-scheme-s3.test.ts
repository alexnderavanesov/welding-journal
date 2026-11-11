// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { PDFDocument } from 'pdf-lib'
import { createS3SchemeFileStore } from './line-scheme-s3'
import { getSchemeFileStore, readSchemeS3Config } from './line-scheme-storage'

const config = { endpoint: 'https://s3.ru-1.storage.selcloud.ru', region: 'ru-1', bucket: 'welding-journal-schemes-test',
  accessKeyId: 'unit-only', secretAccessKey: 'unit-secret-never-log' }
const key = () => `${randomUUID()}.pdf`
const body = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close() } })
const response = (bytes: Uint8Array, extra = {}) => ({ Body: Readable.from([bytes]), ContentLength: bytes.length, $metadata: { httpStatusCode: 200 }, ...extra })
function fixture() { const send = vi.fn(); return { send, store: createS3SchemeFileStore(config, { send } as unknown as S3Client) } }
async function pdfBytes() { const pdf = await PDFDocument.create(); pdf.addPage(); return pdf.save() }
afterEach(() => vi.unstubAllEnvs())

describe('S3 PDF storage without a database', () => {
  it('validates before PUT, uploads a stream with integrity and immutable-key guards, then removes temporary bytes', async () => {
    const { send, store } = fixture(), bytes = await pdfBytes(), fileKey = key()
    let temporary = ''
    send.mockImplementation(async (command: PutObjectCommand) => {
      expect(command).toBeInstanceOf(PutObjectCommand)
      const stream = command.input.Body as ReturnType<typeof import('node:fs').createReadStream>
      temporary = String(stream.path)
      expect(await readFile(temporary)).toEqual(Buffer.from(bytes))
      const chunks = []; for await (const chunk of stream) chunks.push(chunk)
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes))
      expect(command.input).toMatchObject({ Bucket: config.bucket, Key: fileKey, ContentLength: bytes.length,
        ContentType: 'application/pdf', IfNoneMatch: '*', ContentMD5: createHash('md5').update(bytes).digest('base64'),
        Metadata: { sha256: createHash('sha256').update(bytes).digest('hex') } })
      return { $metadata: { httpStatusCode: 200 } }
    })
    expect(await store.upload(fileKey, body(bytes))).toEqual({ size: bytes.length, pageCount: 1, digest: createHash('sha256').update(bytes).digest('hex') })
    expect(send).toHaveBeenCalledTimes(1)
    await expect(access(temporary)).rejects.toThrow()
  })
  it('does not send corrupt, empty or already-cancelled uploads to S3', async () => {
    const { send, store } = fixture()
    await expect(store.upload(key(), body(new TextEncoder().encode('%PDF-1.7 garbage')))).rejects.toThrow(/повреждён/)
    await expect(store.upload(key(), body(new Uint8Array()))).rejects.toThrow('пустой')
    await expect(store.upload(key(), body(await pdfBytes()), AbortSignal.abort())).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
  it.each([403, 409, 412, 503])('cleans the staging file on PUT failure %i without deleting another revision or leaking errors', async code => {
    const { send, store } = fixture(); let temporary = ''
    send.mockImplementation(async (command: PutObjectCommand) => {
      temporary = String((command.input.Body as ReturnType<typeof import('node:fs').createReadStream>).path)
      throw Object.assign(new Error(config.secretAccessKey), { $metadata: { httpStatusCode: code } })
    })
    await expect(store.upload(key(), body(await pdfBytes()))).rejects.toThrow(code === 409 || code === 412 ? 'уже существует' : 'недоступно')
    expect(send).toHaveBeenCalledTimes(1)
    await expect(access(temporary)).rejects.toThrow()
  })
  it('streams the exact range in one GET without HEAD or whole-object buffering', async () => {
    const { send, store } = fixture(), bytes = Buffer.from('0123456789'), fileKey = key()
    send.mockResolvedValue(response(bytes.subarray(2, 5), { ContentRange: 'bytes 2-4/10', $metadata: { httpStatusCode: 206 } }))
    const read = await store.read(fileKey, 2, 4)
    expect(read.size).toBe(10)
    const chunks = []; for await (const chunk of read.stream) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString()).toBe('234')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand)
    expect(send.mock.calls[0][0].input).toEqual({ Bucket: config.bucket, Key: fileKey, Range: 'bytes=2-4' })
  })
  it('cancels a pending PUT and removes its temporary file', async () => {
    const { send, store } = fixture(), controller = new AbortController(); let temporary = ''
    send.mockImplementation((_command: PutObjectCommand, options: { abortSignal: AbortSignal }) => {
      temporary = String((_command.input.Body as ReturnType<typeof import('node:fs').createReadStream>).path)
      const stopped = new Promise((_resolve, reject) => options.abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      controller.abort()
      return stopped
    })
    await expect(store.upload(key(), body(await pdfBytes()), controller.signal)).rejects.toThrow('отменена')
    expect(send).toHaveBeenCalledTimes(1)
    await expect(access(temporary)).rejects.toThrow()
  })
  it.each([
    { ContentRange: undefined, $metadata: { httpStatusCode: 200 } },
    { ContentRange: 'bytes 0-2/10' },
    { ContentRange: 'bytes 2-4/4' },
    { ContentLength: 4 },
  ])('rejects an ignored or inconsistent Range response before handing out a stream: %j', async extra => {
    const { send, store } = fixture(), result = response(Buffer.from('234'), { ContentRange: 'bytes 2-4/10', $metadata: { httpStatusCode: 206 }, ...extra })
    send.mockResolvedValue(result)
    await expect(store.read(key(), 2, 4)).rejects.toThrow('не соответствует')
    expect(result.Body.destroyed).toBe(true)
  })
  it('cancels the open S3 response when the viewer disconnects', async () => {
    const { send, store } = fixture(), abort = new AbortController(), stream = new Readable({ read() {} })
    const error = new Promise<unknown>(resolve => stream.once('error', resolve))
    send.mockResolvedValue({ Body: stream, ContentLength: 10, $metadata: { httpStatusCode: 200 } })
    await store.read(key(), undefined, undefined, abort.signal)
    abort.abort()
    expect(stream.destroyed).toBe(true)
    expect(await error).toBeInstanceOf(Error)
  })
  it('retries ordinary deletion safely and never sends a version ID', async () => {
    const { send, store } = fixture(), fileKey = key()
    send.mockResolvedValueOnce({ ContentLength: 12 }).mockResolvedValueOnce({})
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
    await store.remove(fileKey); await store.remove(fileKey)
    expect(send.mock.calls.map(call => call[0].constructor)).toEqual([HeadObjectCommand, DeleteObjectCommand, HeadObjectCommand])
    for (const [command] of send.mock.calls) expect(command.input).toEqual({ Bucket: config.bucket, Key: fileKey })
  })
  it('does not treat forbidden HEAD as a missing object and exposes no provider error', async () => {
    const { send, store } = fixture()
    send.mockRejectedValue({ message: config.secretAccessKey, $metadata: { httpStatusCode: 403 } })
    await expect(store.remove(key())).rejects.toThrow('недоступно')
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('honors the cleanup deadline before issuing a request', async () => {
    const { send, store } = fixture()
    await expect(store.remove(key(), AbortSignal.abort())).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
  it('cleans abandoned temporary bytes even if the server stopped before PUT', async () => {
    const { send, store } = fixture(), fileKey = key(), staging = join(tmpdir(), `.scheme-upload-${fileKey}`)
    await mkdir(staging); await writeFile(join(staging, 'source.pdf'), 'partial upload')
    try {
      send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      await store.remove(fileKey)
      await expect(access(staging)).rejects.toThrow()
      expect(send).toHaveBeenCalledTimes(1)
    } finally { await rm(staging, { recursive: true, force: true }) }
  })
  it('rejects malformed keys and ranges before network access', async () => {
    const { send, store } = fixture()
    await expect(store.read('../other.pdf')).rejects.toThrow('ключ')
    await expect(store.upload('../other.pdf', body(new Uint8Array()))).rejects.toThrow('ключ')
    await expect(store.remove('../other.pdf')).rejects.toThrow('ключ')
    await expect(store.read(key(), -1, 2)).rejects.toThrow('диапазон')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('explicit storage configuration', () => {
  const env = { LINE_SCHEME_S3_ENDPOINT: config.endpoint, LINE_SCHEME_S3_REGION: config.region,
    LINE_SCHEME_S3_BUCKET: config.bucket, LINE_SCHEME_S3_ACCESS_KEY_ID: config.accessKeyId, LINE_SCHEME_S3_SECRET_ACCESS_KEY: config.secretAccessKey }
  it('requires explicit credentials and a secure bare endpoint', () => {
    expect(readSchemeS3Config(env)).toEqual(config)
    for (const endpoint of ['http://example.test', 'https://user:secret@example.test', 'https://example.test/path', 'https://example.test?key=secret']) {
      expect(() => readSchemeS3Config({ ...env, LINE_SCHEME_S3_ENDPOINT: endpoint })).toThrow('HTTPS')
    }
    expect(() => readSchemeS3Config({ ...env, LINE_SCHEME_S3_SECRET_ACCESS_KEY: '' })).toThrow('ключи')
  })
  it('keeps local storage as the default even when S3 settings exist', async () => {
    vi.stubEnv('LINE_SCHEME_STORAGE_DRIVER', '')
    vi.stubEnv('LINE_SCHEME_STORAGE_PATH', '/unused/local-test-path')
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    const store = await getSchemeFileStore()
    await expect(store.size(key())).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('fails closed for an unknown backend rather than silently selecting local files', async () => {
    vi.stubEnv('LINE_SCHEME_STORAGE_DRIVER', 's33')
    await expect(getSchemeFileStore()).rejects.toThrow('Неизвестный')
  })
})
