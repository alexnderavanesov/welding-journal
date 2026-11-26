// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { handleAuthRequest } from './auth'
import { accountRateLimit, AccountRateLimitError, limitSignInAccount } from './account-management'

vi.mock('./account-management', () => ({ accountRateLimit: vi.fn(), AccountRateLimitError: class extends Error {}, limitSignInAccount: vi.fn() }))
beforeEach(() => { vi.mocked(accountRateLimit).mockReset(); vi.mocked(limitSignInAccount).mockReset() })

it.each([true, false])('bounds sign-in bodies before parsing and before creating an account bucket (declared size %s)', async declared => {
  const request = new Request('http://localhost/api/auth/sign-in/email', {
    method: 'POST', body: ' '.repeat(16 * 1024 + 1),
    headers: declared ? { 'content-length': String(16 * 1024 + 1) } : {},
  })
  const response = await handleAuthRequest(request)
  expect(response.status).toBe(413)
  expect(accountRateLimit).toHaveBeenCalledTimes(1)
  expect(accountRateLimit).toHaveBeenCalledWith('signin-path:shared', 60)
  expect(limitSignInAccount).not.toHaveBeenCalled()
})

it('fails closed before reading the body if the office counter is unavailable', async () => {
  vi.mocked(accountRateLimit).mockRejectedValue(new Error('database unavailable'))
  const request = new Request('http://localhost/api/auth/sign-in/email', { method: 'POST', body: '{}' })
  expect((await handleAuthRequest(request)).status).toBe(429)
  expect(request.bodyUsed).toBe(false)
})

it('keeps the same body limits for a busy office and leaves the employee reserve untouched on cancellation', async () => {
  vi.mocked(accountRateLimit).mockRejectedValue(new AccountRateLimitError('busy'))
  const controller = new AbortController()
  const request = new Request('http://localhost/api/auth/sign-in/email', { method: 'POST', body: '{}', signal: controller.signal })
  controller.abort()
  expect((await handleAuthRequest(request)).status).toBe(408)
  const large = new Request(request.url, { method: 'POST', body: ' '.repeat(16 * 1024 + 1) })
  expect((await handleAuthRequest(large)).status).toBe(413)
  expect(limitSignInAccount).not.toHaveBeenCalled()
})
