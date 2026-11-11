import { Readable } from 'node:stream'
import { parseSchemeRange, type SchemeFileStore } from './line-scheme-files'

type FileRevision = { fileKey: string; fileName: string; size: number }

/** Caller has already checked access and looked up the immutable revision.
 * A GET uses one storage read, including Range; no HEAD before every PDF chunk. */
export async function schemeFileResponse(request: Request, revision: FileRevision, store: SchemeFileStore) {
  const size = revision.size, etag = `"${revision.fileKey}"`
  const headers = new Headers({ 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache', ETag: etag,
    'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="drawing.pdf"; filename*=UTF-8''${encodeURIComponent(revision.fileName).replace(/'/g, '%27')}` })
  const assertSize = (actual: number) => { if (actual !== size) throw new Error('Размер PDF в хранилище не соответствует редакции.') }
  if (request.headers.get('if-none-match') === etag && !request.headers.has('range')) {
    assertSize(await store.size(revision.fileKey, request.signal))
    return new Response(null, { status: 304, headers })
  }
  let range
  try { range = parseSchemeRange(request.headers.has('if-range') && request.headers.get('if-range') !== etag ? null : request.headers.get('range'), size) }
  catch { headers.set('Content-Range', `bytes */${size}`); return new Response(null, { status: 416, headers }) }
  headers.set('Content-Length', String(range ? range.end - range.start + 1 : size))
  if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
  if (request.method === 'HEAD') {
    assertSize(await store.size(revision.fileKey, request.signal))
    return new Response(null, { status: range ? 206 : 200, headers })
  }
  const file = await store.read(revision.fileKey, range?.start, range?.end, request.signal)
  try { assertSize(file.size) } catch (error) { file.stream.destroy(); throw error }
  return new Response(Readable.toWeb(file.stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers })
}
