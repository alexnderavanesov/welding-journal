// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleSchemeFile } from './line-scheme-http'

const mocks = vi.hoisted(() => ({ permission: vi.fn(), store: vi.fn(), upload: vi.fn(), prepare: vi.fn(), publish: vi.fn(),
  cleanup: vi.fn(), db: vi.fn(), update: vi.fn(), where: vi.fn(), select: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: mocks.db }))
vi.mock('./access-context', () => ({ requirePermission: mocks.permission }))
vi.mock('./line-scheme-storage', () => ({ getSchemeFileStore: mocks.store }))
vi.mock('./line-scheme-write', () => ({ prepareSchemeUpload: mocks.prepare, publishSchemeFile: mocks.publish, cleanupSchemeFiles: mocks.cleanup }))

const fileKey = 'c6ce5477-c7c0-47d2-92e5-35e64af69945.pdf'
const metadata = { size: 100, pageCount: 2, digest: 'fixture-digest' }
function uploadRequest(signal?: AbortSignal) {
  return new Request('http://localhost/pdf', { method: 'POST', signal, body: new Uint8Array([1]), headers: {
    'x-line-scheme-upload': encodeURIComponent(JSON.stringify({ fileName: 'Drawing.pdf', replace: 'archive' })),
  } })
}
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.permission.mockResolvedValue(undefined)
  mocks.store.mockResolvedValue({ upload: mocks.upload })
  mocks.upload.mockResolvedValue(metadata)
  mocks.prepare.mockResolvedValue(fileKey)
  mocks.publish.mockResolvedValue({ revisionId: 'published' })
  mocks.cleanup.mockResolvedValue(undefined)
  mocks.where.mockResolvedValue(undefined)
  mocks.update.mockReturnValue({ set: () => ({ where: mocks.where }) })
  mocks.db.mockReturnValue({ update: mocks.update, select: mocks.select })
})

describe('PDF route integration with mocked persistence only', () => {
  it('checks view permission before resolving storage or accessing metadata', async () => {
    mocks.permission.mockRejectedValue(new Error('AUTH_REQUIRED'))
    expect((await handleSchemeFile(new Request('http://localhost/pdf'))).status).toBe(401)
    expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled()
  })
  it('does not upload or reserve a file without edit permission', async () => {
    mocks.permission.mockImplementation(async permission => { if (permission === 'schemes.edit') throw new Error('Недостаточно прав') })
    expect((await handleSchemeFile(uploadRequest())).status).toBe(403)
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it('rejects a cross-site request before any side effects', async () => {
    const response = await handleSchemeFile(new Request('http://localhost/pdf', { method: 'POST', headers: { Origin: 'https://unrelated.test' } }))
    expect(response.status).toBe(403); expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled()
  })
  it('publishes only the successfully validated and stored file metadata', async () => {
    const response = await handleSchemeFile(uploadRequest())
    expect(response.status).toBe(200)
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fileKey, ...metadata }))
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(mocks.publish.mock.invocationCallOrder[0])
    expect(mocks.cleanup).toHaveBeenCalledTimes(1)
  })
  it('never replaces the active revision after upload failure and schedules staging cleanup', async () => {
    mocks.upload.mockRejectedValue(new Error('Хранилище PDF недоступно.'))
    const response = await handleSchemeFile(uploadRequest())
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'Хранилище PDF недоступно.', retryable: false })
    expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.cleanup).toHaveBeenCalledTimes(1)
  })
  it('does not publish when the client cancels after upload completion', async () => {
    const controller = new AbortController()
    mocks.upload.mockImplementation(async () => { controller.abort(); return metadata })
    expect((await handleSchemeFile(uploadRequest(controller.signal))).status).toBe(400)
    expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.cleanup).toHaveBeenCalledTimes(1)
  })
  it('preserves the existing retry flow when publication has an unknown outcome', async () => {
    mocks.publish.mockRejectedValue(new Error('publication result unknown'))
    const response = await handleSchemeFile(uploadRequest())
    expect(await response.json()).toEqual({ error: 'publication result unknown', retryable: true })
    expect(mocks.cleanup).toHaveBeenCalledTimes(1)
  })
})
