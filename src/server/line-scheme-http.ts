import { and, eq } from 'drizzle-orm'
import { Readable } from 'node:stream'
import { requireDb } from '@/db'
import { lineSchemeFiles, lineSchemeRevisions } from '@/db/schema'
import { SCHEME_MAX_BYTES, schemeToken, schemeChangeNumber } from '@/lib/line-schemes'
import { createSchemeFileStore, lineSchemeStorageDirectory, parseSchemeRange } from './line-scheme-files'
import { requirePermission } from './access-context'
import { cleanupSchemeFiles, prepareSchemeUpload, publishSchemeFile, type SchemeWriteRequest } from './line-scheme-write'

export async function handleSchemeFile(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site' || request.method === 'POST' && request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return new Response('Недопустимый источник запроса.', { status: 403 })
  let pendingKey: string | null = null
  let publishing = false
  try {
    await requirePermission('schemes.view')
    const store = createSchemeFileStore(lineSchemeStorageDirectory())
    if (request.method === 'GET' || request.method === 'HEAD') {
      const id = schemeToken(new URL(request.url).searchParams.get('revision'))
      const [revision] = await requireDb().select().from(lineSchemeRevisions).where(eq(lineSchemeRevisions.id, id))
      if (!revision) return new Response('Редакция удалена или не найдена.', { status: 404 })
      const size = await store.size(revision.fileKey), etag = `"${revision.fileKey}"`
      const headers = new Headers({ 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache', ETag: etag,
        'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="drawing.pdf"; filename*=UTF-8''${encodeURIComponent(revision.fileName).replace(/'/g, '%27')}` })
      if (request.headers.get('if-none-match') === etag && !request.headers.has('range')) return new Response(null, { status: 304, headers })
      let range
      try { range = parseSchemeRange(request.headers.has('if-range') && request.headers.get('if-range') !== etag ? null : request.headers.get('range'), size) }
      catch { headers.set('Content-Range', `bytes */${size}`); return new Response(null, { status: 416, headers }) }
      headers.set('Content-Length', String(range ? range.end - range.start + 1 : size))
      if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
      if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers })
      const stream = store.read(revision.fileKey, range?.start, range?.end)
      const abort = () => stream.destroy()
      request.signal.addEventListener('abort', abort, { once: true }); stream.once('close', () => request.signal.removeEventListener('abort', abort))
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers })
    }
    if (request.method !== 'POST') return new Response(null, { status: 405 })
    await requirePermission('schemes.edit')
    if (!request.body) throw new Error('Файл не передан.')
    const header = request.headers.get('x-line-scheme-upload') ?? ''
    if (!header || header.length > 8192) throw new Error('Некорректные параметры загрузки.')
    const data = JSON.parse(decodeURIComponent(header)) as SchemeWriteRequest & { fileName: string; replace: 'archive' | 'delete'; changeNumber?: string | null }
    if (!['archive', 'delete'].includes(data.replace) || typeof data.fileName !== 'string' || !data.fileName.trim() || data.fileName.length > 255 || /[\x00-\x1f]/.test(data.fileName)) throw new Error('Некорректное имя файла или вариант замены.')
    data.changeNumber = schemeChangeNumber(data.changeNumber)
    if (Number(request.headers.get('content-length')) > SCHEME_MAX_BYTES) throw new Error('Размер PDF превышает 100 МБ.')
    pendingKey = await prepareSchemeUpload(data)
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120_000)])
    const { size, digest } = await store.write(pendingKey, request.body, signal)
    const pageCount = await store.validate(pendingKey, signal)
    signal.throwIfAborted()
    publishing = true
    const result = await publishSchemeFile({ ...data, fileKey: pendingKey, fileName: data.fileName.trim(), size, digest, pageCount })
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось обработать PDF.'
    return Response.json({ error: message, retryable: publishing }, { status: message.startsWith('AUTH_REQUIRED') ? 401 : message.includes('Недостаточно прав') ? 403 : 400, headers: { 'Cache-Control': 'no-store' } })
  } finally {
    if (pendingKey) {
      // On success only an unused retry file remains staging. On failure this
      // marks the incomplete upload; the previous active revision is untouched.
      await requireDb().update(lineSchemeFiles).set({ state: 'deleting', expiresAt: null }).where(and(eq(lineSchemeFiles.key, pendingKey), eq(lineSchemeFiles.state, 'staging'))).catch(error => console.error('Scheme upload cleanup remains pending:', error))
      await cleanupSchemeFiles().catch(error => console.error('Scheme file cleanup remains pending:', error))
    }
  }
}
