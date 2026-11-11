// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { schemeFileResponse } from './line-scheme-file-response'
import type { SchemeFileStore } from './line-scheme-files'

const revision = { fileKey: '2b414d83-c594-42f9-893b-253f12380a5b.pdf', fileName: 'Схема №1.pdf', size: 10 }
const request = (headers: Record<string, string> = {}, method = 'GET') => new Request('http://localhost/api/line-scheme-file', { method, headers })
function fixture() {
  const read = vi.fn(async (_key: string, start?: number, end?: number) => ({ size: 10,
    stream: Readable.from([Buffer.from('0123456789').subarray(start ?? 0, end === undefined ? 10 : end + 1)]) }))
  const size = vi.fn(async () => 10)
  const store: SchemeFileStore = { read, size, upload: vi.fn(), remove: vi.fn() }
  return { store, read, size }
}

describe('authorized PDF response without a database', () => {
  it('returns original bytes with private caching and a safe Unicode filename in one read', async () => {
    const { store, read, size } = fixture(), req = request(), response = await schemeFileResponse(req, revision, store)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('0123456789')
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache')
    expect(response.headers.get('Content-Length')).toBe('10')
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toContain(encodeURIComponent(revision.fileName))
    expect(read).toHaveBeenCalledExactlyOnceWith(revision.fileKey, undefined, undefined, req.signal)
    expect(size).not.toHaveBeenCalled()
  })
  it.each([['bytes=2-4', '234', 'bytes 2-4/10'], ['bytes=-2', '89', 'bytes 8-9/10']])('serves %s without an extra HEAD', async (range, bytes, contentRange) => {
    const { store, read, size } = fixture(), response = await schemeFileResponse(request({ Range: range }), revision, store)
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe(contentRange)
    expect(response.headers.get('Content-Length')).toBe(String(bytes.length))
    expect(await response.text()).toBe(bytes)
    expect(read).toHaveBeenCalledTimes(1); expect(size).not.toHaveBeenCalled()
  })
  it('ignores a Range for a different If-Range revision', async () => {
    const { store } = fixture(), response = await schemeFileResponse(request({ Range: 'bytes=2-4', 'If-Range': '"old"' }), revision, store)
    expect(response.status).toBe(200); expect(await response.text()).toBe('0123456789')
  })
  it('returns 416 for invalid/multiple ranges without opening an object', async () => {
    const { store, read, size } = fixture()
    for (const range of ['bytes=10-', 'bytes=1-2,3-4']) {
      const response = await schemeFileResponse(request({ Range: range }), revision, store)
      expect(response.status).toBe(416); expect(response.headers.get('Content-Range')).toBe('bytes */10')
    }
    expect(read).not.toHaveBeenCalled(); expect(size).not.toHaveBeenCalled()
  })
  it.each([['HEAD', {}, 200], ['HEAD', { Range: 'bytes=2-4' }, 206], ['GET', { 'If-None-Match': `"${revision.fileKey}"` }, 304]] as const)(
    'checks object existence for %s %j, without opening a body', async (method, headers, status) => {
      const { store, read, size } = fixture(), response = await schemeFileResponse(request(headers, method), revision, store)
      expect(response.status).toBe(status); expect(response.body).toBeNull()
      expect(size).toHaveBeenCalledTimes(1); expect(read).not.toHaveBeenCalled()
    })
  it('does not return a cached 304 after the object has disappeared', async () => {
    const { store, size } = fixture(); size.mockRejectedValue(new Error('missing'))
    await expect(schemeFileResponse(request({ 'If-None-Match': `"${revision.fileKey}"` }), revision, store)).rejects.toThrow('missing')
  })
  it('rejects a mismatch with revision metadata and closes the stream', async () => {
    const { store, read } = fixture(), stream = Readable.from(['wrong'])
    read.mockResolvedValue({ size: 5, stream })
    await expect(schemeFileResponse(request(), revision, store)).rejects.toThrow('не соответствует')
    expect(stream.destroyed).toBe(true)
  })
  it('closes the storage stream when the HTTP body is cancelled', async () => {
    const { store, read } = fixture(), stream = new Readable({ read() {} })
    read.mockResolvedValue({ size: 10, stream })
    const response = await schemeFileResponse(request(), revision, store)
    await response.body!.cancel()
    expect(stream.destroyed).toBe(true)
  })
  it('does not drain a large PDF into memory while the browser is not reading', async () => {
    const { store, read } = fixture(), chunkSize = 16 * 1024, total = 16 * 1024 * 1024
    let produced = 0
    const stream = new Readable({ highWaterMark: 64 * 1024, read() {
      if (produced === total) { this.push(null); return }
      produced += chunkSize; this.push(Buffer.alloc(chunkSize))
    } })
    read.mockResolvedValue({ size: total, stream })
    const response = await schemeFileResponse(request(), { ...revision, size: total }, store)
    try {
      await new Promise(resolve => setImmediate(resolve))
      expect(produced).toBeGreaterThan(0)
      expect(produced).toBeLessThanOrEqual(192 * 1024)
    } finally { await response.body!.cancel() }
  })
})
