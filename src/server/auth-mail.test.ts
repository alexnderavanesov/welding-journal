import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getMailConfiguration, assertServerMailConfiguration } from './auth-mail-config'

const sdk = vi.hoisted(() => ({ handle: vi.fn(), configuration: vi.fn(), destroy: vi.fn() }))
vi.mock('./auth', () => ({ getAuthConfiguration: () => ({ baseURL: process.env.BETTER_AUTH_URL }) }))
vi.mock('@aws-sdk/client-sesv2', async importOriginal => {
  const original = await importOriginal<typeof import('@aws-sdk/client-sesv2')>()
  return { ...original, SESv2Client: class extends original.SESv2Client {
    constructor(configuration: ConstructorParameters<typeof original.SESv2Client>[0]) {
      sdk.configuration(configuration)
      // Real SDK serialization, signing and retries; replace only the network boundary.
      super({ ...configuration, requestHandler: { handle: sdk.handle } })
    }
    override destroy() { sdk.destroy(); super.destroy() }
  } }
})
import { sendAccountLink } from './auth-mail'

const postbox = { AUTH_MAIL_MODE: 'postbox', AUTH_MAIL_FROM: 'system@yums.ru',
  POSTBOX_ACCESS_KEY_ID: 'test-access-key', POSTBOX_SECRET_ACCESS_KEY: 'test-secret-key' }
const response = (statusCode = 200, payload: object = { MessageId: 'test-message-id' }) => ({ response: {
  statusCode, headers: { 'content-type': 'application/json' }, body: Uint8Array.from(Buffer.from(JSON.stringify(payload))),
} })
let directory: string | undefined
beforeEach(() => {
  vi.clearAllMocks()
  sdk.handle.mockReset().mockResolvedValue(response())
  Object.entries(postbox).forEach(([key, value]) => vi.stubEnv(key, value))
  vi.stubEnv('BETTER_AUTH_URL', 'https://example.test')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('account email delivery', () => {
  it.each(['invite', 'recovery'] as const)('sends %s through signed HTTPS with the original fragment link', async kind => {
    await sendAccountLink('employee@example.test', 'test-token+with/characters', kind)
    const [request, options] = sdk.handle.mock.calls[0]
    expect(sdk.handle).toHaveBeenCalledTimes(1)
    expect(request).toMatchObject({ protocol: 'https:', hostname: 'postbox.cloud.yandex.net', method: 'POST', path: '/v2/email/outbound-emails' })
    expect(request.headers.authorization).toContain('AWS4-HMAC-SHA256 Credential=test-access-key/')
    expect(request.headers.authorization).toContain('/ru-central1/ses/aws4_request')
    expect(request.headers.authorization).not.toContain('test-secret-key')
    expect(options.abortSignal).toBeDefined()
    const payload = JSON.parse(request.body)
    expect(payload.FromEmailAddress).toBe('system@yums.ru')
    expect(payload.Destination.ToAddresses).toEqual(['employee@example.test'])
    expect(payload.Content.Simple.Subject.Charset).toBe('UTF-8')
    const message = payload.Content.Simple.Body.Text.Data
    const url = new URL(message.split('\n')[1])
    expect(url.origin + url.pathname).toBe('https://example.test/account-link')
    expect(url.search).toBe('')
    expect(new URLSearchParams(url.hash.slice(1)).get('token')).toBe('test-token+with/characters')
    expect(new URLSearchParams(url.hash.slice(1)).get('kind')).toBe(kind)
    expect(message).toContain(kind === 'invite' ? '48 часов' : '1 час')
    expect(sdk.configuration.mock.calls[0][0]).toMatchObject({ maxAttempts: 3, retryMode: 'standard', credentials: {
      accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key',
    } })
    expect(sdk.destroy).toHaveBeenCalledOnce()
  })

  it.each([400, 403])('rejects HTTP %s without exposing provider text or retrying a permanent error', async status => {
    sdk.handle.mockResolvedValue(response(status, { message: 'test-secret-key test-token private-provider-error', __type: 'BadRequestException' }))
    await expect(sendAccountLink('employee@example.test', 'test-token', 'invite')).rejects.toThrow('Postbox не подтвердил приём письма.')
    expect(sdk.handle).toHaveBeenCalledTimes(1)
    expect(sdk.destroy).toHaveBeenCalledOnce()
  })

  it('retries a temporary quota error with the same link', async () => {
    sdk.handle.mockResolvedValueOnce(response(429, { __type: 'TooManyRequestsException' })).mockResolvedValue(response())
    await sendAccountLink('employee@example.test', 'test-token', 'invite')
    expect(sdk.handle).toHaveBeenCalledTimes(2)
    expect(sdk.handle.mock.calls[0][0].body).toBe(sdk.handle.mock.calls[1][0].body)
  })

  it('rejects a success response without a message ID', async () => {
    sdk.handle.mockResolvedValue(response(200, {}))
    await expect(sendAccountLink('employee@example.test', 'test-token', 'invite')).rejects.toThrow('Postbox не подтвердил')
    expect(sdk.destroy).toHaveBeenCalledOnce()
  })

  it('sanitizes connection/abort errors and closes the client', async () => {
    sdk.handle.mockRejectedValue(Object.assign(new Error('test-secret-key test-token'), { name: 'AbortError' }))
    await expect(sendAccountLink('employee@example.test', 'test-token', 'invite')).rejects.toThrow(/^Postbox не подтвердил приём письма\./)
    expect(sdk.handle).toHaveBeenCalledTimes(1)
    expect(sdk.destroy).toHaveBeenCalledOnce()
  })

  it('keeps local delivery offline in a private file', async () => {
    directory = await mkdtemp(join(tmpdir(), 'postbox-mail-test-'))
    vi.stubEnv('AUTH_MAIL_MODE', 'local'); vi.stubEnv('SMTP_HOST', '127.0.0.1')
    vi.stubEnv('BETTER_AUTH_URL', 'http://127.0.0.1:3000'); vi.stubEnv('AUTH_MAIL_LOCAL_DIR', directory)
    await sendAccountLink('employee@example.test', 'local-test-token', 'invite')
    expect(sdk.handle).not.toHaveBeenCalled()
    const files = await readdir(directory)
    expect(files).toHaveLength(1)
    expect(await readFile(join(directory, files[0]), 'utf8')).toContain('From: system@yums.ru')
    expect((await stat(join(directory, files[0]))).mode & 0o777).toBe(0o600)
  })

  it('refuses local delivery for a remote site before writing a file', async () => {
    vi.stubEnv('AUTH_MAIL_MODE', 'local'); vi.stubEnv('SMTP_HOST', 'localhost')
    await expect(sendAccountLink('employee@example.test', 'test-token', 'invite')).rejects.toThrow('только для локального приложения')
    expect(sdk.handle).not.toHaveBeenCalled()
  })
})

describe('mail configuration and operator preflight', () => {
  it('accepts Postbox for the owner without SMTP or default AWS credentials', () => {
    expect(assertServerMailConfiguration(postbox).mode).toBe('postbox')
  })
  it.each(['POSTBOX_ACCESS_KEY_ID', 'POSTBOX_SECRET_ACCESS_KEY'])('rejects missing/whitespace %s before sending', key => {
    for (const value of [undefined, '', ' secret ', 'secret\nvalue']) {
      expect(() => getMailConfiguration({ ...postbox, [key]: value })).toThrow(key)
    }
  })
  it('retains SMTP and rejects offline or unknown modes for the server owner', () => {
    expect(assertServerMailConfiguration({ AUTH_MAIL_MODE: 'smtp', SMTP_HOST: 'smtp.example.test', SMTP_USER: 'system@example.test', SMTP_PASSWORD: 'test-password' }).mode).toBe('smtp')
    expect(() => assertServerMailConfiguration({ AUTH_MAIL_MODE: 'local' })).toThrow('серверного владельца')
    expect(() => getMailConfiguration({ AUTH_MAIL_MODE: 'invalid' })).toThrow('способ доставки')
  })
})
