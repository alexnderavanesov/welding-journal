import { and, eq } from 'drizzle-orm'
import { requireDb } from '@/db'
import { lineSchemeFiles, lineSchemeRevisions } from '@/db/schema'
import { SCHEME_MAX_BYTES, schemeToken, schemeChangeNumber } from '@/lib/line-schemes'
import { getSchemeFileStore } from './line-scheme-storage'
import { schemeFileResponse } from './line-scheme-file-response'
import { requirePermission } from './access-context'
import { cleanupSchemeFiles, prepareSchemeUpload, publishSchemeFile, type SchemeWriteRequest } from './line-scheme-write'

export async function handleSchemeFile(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site' || request.method === 'POST' && request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return new Response('Недопустимый источник запроса.', { status: 403 })
  let pendingKey: string | null = null
  let publishing = false
  try {
    await requirePermission('schemes.view')
    const store = await getSchemeFileStore()
    if (request.method === 'GET' || request.method === 'HEAD') {
      const id = schemeToken(new URL(request.url).searchParams.get('revision'))
      const [revision] = await requireDb().select().from(lineSchemeRevisions).where(eq(lineSchemeRevisions.id, id))
      if (!revision) return new Response('Редакция удалена или не найдена.', { status: 404 })
      return await schemeFileResponse(request, revision, store)
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
    const { size, digest, pageCount } = await store.upload(pendingKey, request.body, signal)
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
