// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib'
import { SCHEME_MAX_BYTES } from '@/lib/line-schemes'
import { createSchemeFileStore, parseSchemeRange } from './line-scheme-files'

const directories: string[] = []
async function fixture() { const directory = await mkdtemp(join(tmpdir(), 'scheme-files-test-')); directories.push(directory); return { directory, store: createSchemeFileStore(directory), key: `${randomUUID()}.pdf` } }
const body = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } })
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })
describe('local PDF store', () => {
  it('streams an unchanged original, verifies pages, reads byte ranges and removes both temporary/final files', async () => {
    const { store, key, directory } = await fixture(), pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage([2384, 3370])
    const bytes = await pdf.save(), result = await store.write(key, body(bytes))
    expect(result).toEqual({ size: bytes.length, digest: createHash('sha256').update(bytes).digest('hex') })
    expect(await store.validate(key)).toBe(2); expect(await store.size(key)).toBe(bytes.length)
    const chunks: Buffer[] = []; for await (const chunk of store.read(key, 0, 9)) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes.subarray(0, 10)))
    await store.remove(key); await store.remove(key); expect(await readdir(directory)).toEqual([])
  })
  it('rejects corrupt content, too many pages, traversal and already-cancelled validation', async () => {
    const { store, key } = await fixture()
    await store.write(key, body(new TextEncoder().encode('%PDF-1.7 garbage')))
    await expect(store.validate(key)).rejects.toThrow(/повреждён/)
    const pdf = await PDFDocument.create(); for (let i = 0; i < 101; i++) pdf.addPage()
    const second = `${randomUUID()}.pdf`; await store.write(second, body(await pdf.save()))
    await expect(store.validate(second)).rejects.toThrow(/100 страниц/)
    await expect(store.size('../outside.pdf')).rejects.toThrow(/ключ/)
    await expect(store.validate(key, AbortSignal.abort())).rejects.toThrow()
  })
  it('removes a partial write after cancellation without touching another revision', async () => {
    const { store, key, directory } = await fixture(), retained = `${randomUUID()}.pdf`
    await writeFile(join(directory, retained), '%PDF-old')
    const abort = new AbortController()
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('%PDF-')); setTimeout(() => abort.abort(), 10) } })
    await expect(store.write(key, stream, abort.signal)).rejects.toThrow()
    expect(await readdir(directory)).toEqual([retained])
  })
  it('enforces the streaming byte limit without retaining the rejected file', async () => {
    const { store, key, directory } = await fixture(), chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (sent > SCHEME_MAX_BYTES) { controller.close(); return }
      controller.enqueue(chunk); sent += chunk.length
    } })
    await expect(store.write(key, stream)).rejects.toThrow('100 МБ')
    expect(await readdir(directory)).toEqual([])
  })
  it('accepts 100 pages and rejects an encrypted original without changing it', async () => {
    const { store, key } = await fixture(), pdf = await PDFDocument.create()
    for (let page = 0; page < 100; page++) pdf.addPage()
    await store.write(key, body(await pdf.save()))
    expect(await store.validate(key)).toBe(100)
    const encryptedKey = `${randomUUID()}.pdf`
    pdf.context.trailerInfo.Encrypt = pdf.context.register(pdf.context.obj({ Filter: PDFName.of('Standard'), V: 1, R: 2, P: -4, O: PDFHexString.of('00'.repeat(32)), U: PDFHexString.of('00'.repeat(32)) }))
    const bytes = await pdf.save(); await store.write(encryptedKey, body(bytes))
    await expect(store.validate(encryptedKey)).rejects.toThrow('паролем')
    expect(await store.size(encryptedKey)).toBe(bytes.length)
    expect(await store.validate(key)).toBe(100)
  })
})
describe('HTTP byte ranges', () => {
  it.each([['bytes=0-9', 0, 9], ['bytes=10-', 10, 99], ['bytes=-10', 90, 99], ['bytes=0-1000', 0, 99]])('%s', (header, start, end) => { expect(parseSchemeRange(header, 100)).toEqual({ start, end }) })
  it.each(['bytes=100-', 'bytes=20-10', 'bytes=-0', 'bytes=0-2,4-5', 'bytes=-', 'bytes=NaN-2'])('rejects %s', header => { expect(() => parseSchemeRange(header, 100)).toThrow('RANGE') })
})
