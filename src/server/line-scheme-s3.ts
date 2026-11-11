import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import type { SchemeFileStore } from './line-scheme-files'
import type { SchemeS3Config } from './line-scheme-storage'
import { assertSchemeFileKey, removeStagedSchemeUpload, withValidatedSchemeUpload } from './line-scheme-upload-file'
import { SCHEME_MAX_BYTES } from '@/lib/line-schemes'

const STORAGE_ERROR = 'Хранилище PDF недоступно. Повторите операцию.'
const SIZE_ERROR = 'Размер PDF в хранилище не соответствует редакции.'
const status = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode
const operationSignal = (signal?: AbortSignal) => AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)])
const validSize = (size: unknown): size is number => typeof size === 'number' && Number.isSafeInteger(size) && size > 0 && size <= SCHEME_MAX_BYTES

function storageError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted) return new Error('Операция с PDF отменена.')
  if (status(error) === 404) return new Error('Файл PDF не найден в хранилище.')
  if (status(error) === 409 || status(error) === 412) return new Error('Файл этой редакции уже существует. Повторите загрузку как новую редакцию.')
  return new Error(STORAGE_ERROR)
}

/** Single PUT fits the agreed 100 MiB limit; no multipart permissions or orphaned parts. */
export function createS3SchemeFileStore(config: SchemeS3Config, client = new S3Client({
  endpoint: config.endpoint, region: config.region,
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  forcePathStyle: false,
  maxAttempts: 1,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  requestHandler: { connectionTimeout: 10_000, socketTimeout: 30_000 },
})): SchemeFileStore {
  const input = (key: string) => { assertSchemeFileKey(key); return { Bucket: config.bucket, Key: key } }
  return {
    async upload(key, body, signal) {
      const target = input(key)
      return withValidatedSchemeUpload(key, body, signal, async file => {
        const stream = createReadStream(file.path)
        try {
          await client.send(new PutObjectCommand({ ...target, Body: stream, ContentLength: file.size,
            ContentType: 'application/pdf', ContentMD5: file.contentMd5, Metadata: { sha256: file.digest }, IfNoneMatch: '*' }),
          { abortSignal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120_000)]) })
          return { size: file.size, digest: file.digest, pageCount: file.pageCount }
        } catch (error) { throw storageError(error, signal) }
        finally { stream.destroy() }
      })
    },
    async read(key, start, end, signal) {
      const target = input(key)
      if ((start === undefined) !== (end === undefined) || start !== undefined &&
        (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end! < start)) throw new Error('Некорректный диапазон PDF.')
      signal?.throwIfAborted()
      let result
      try {
        result = await client.send(new GetObjectCommand({ ...target, ...(start !== undefined ? { Range: `bytes=${start}-${end}` } : {}) }), { abortSignal: signal })
      } catch (error) { throw storageError(error, signal) }
      const stream = result.Body
      if (!(stream instanceof Readable)) throw new Error(STORAGE_ERROR)
      let size = result.ContentLength
      let valid = validSize(size)
      if (start !== undefined) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(result.ContentRange ?? '')
        size = match ? Number(match[3]) : undefined
        valid = !!match && validSize(size) && Number(match[1]) === start && Number(match[2]) === end &&
          end! < size && result.ContentLength === end! - start + 1 && result.$metadata.httpStatusCode === 206
      } else if (result.ContentRange || result.$metadata.httpStatusCode !== 200) valid = false
      if (!valid) { stream.destroy(); throw new Error(SIZE_ERROR) }
      const abort = () => stream.destroy(new Error('Чтение PDF отменено.'))
      signal?.addEventListener('abort', abort, { once: true })
      stream.once('close', () => signal?.removeEventListener('abort', abort))
      if (signal?.aborted) { stream.destroy(); throw new Error('Чтение PDF отменено.') }
      return { stream, size: size! }
    },
    async size(key, signal) {
      try {
        const result = await client.send(new HeadObjectCommand(input(key)), { abortSignal: operationSignal(signal) })
        if (!validSize(result.ContentLength)) throw new Error(SIZE_ERROR)
        return result.ContentLength
      } catch (error) { throw storageError(error, signal) }
    },
    async remove(key, callerSignal) {
      const target = input(key), signal = operationSignal(callerSignal)
      signal.throwIfAborted()
      await removeStagedSchemeUpload(key)
      // Avoid creating a fresh delete marker on every cleanup retry. Never delete a version.
      try { await client.send(new HeadObjectCommand(target), { abortSignal: signal }) }
      catch (error) { if (status(error) === 404) return; throw storageError(error) }
      try { await client.send(new DeleteObjectCommand(target), { abortSignal: signal }) }
      catch (error) { throw storageError(error) }
    },
  }
}
