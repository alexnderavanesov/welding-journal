import { describe, expect, it, vi } from 'vitest'
import { createReleaseRequestGate } from './release-request-gate'

describe('release request gate', () => {
  it('keeps liveness independent of database availability; readiness is not liveness', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('database not migrated'))
    const gate = createReleaseRequestGate(probe)
    expect((await gate(new Request('http://local/health/live')))?.status).toBe(200)
    expect(probe).not.toHaveBeenCalled()
    expect((await gate(new Request('http://local/health/ready')))?.status).toBe(503)
  })

  it('blocks pages, stale RPC, exports and cron before any application handler', async () => {
    const gate = createReleaseRequestGate(async () => false)
    for (const [path, method] of [['/line-program', 'GET'], ['/journal', 'GET'], ['/_serverFn/old-id', 'POST'], ['/api/maintenance/dispatcher-refresh', 'POST'], ['/documents', 'GET']]) {
      const response = await gate(new Request(`http://local${path}`, { method, headers: { accept: 'text/html' } }))
      expect(response?.status).toBe(503)
      expect(response?.headers.get('Cache-Control')).toBe('no-store')
      expect(response?.headers.get('Retry-After')).toBe('5')
      expect(await response?.text()).toMatch(/не (выполнен|подготовлена)/)
    }
  })

  it('coalesces 100 concurrent requests and rechecks after migration without a restart', async () => {
    let time = 0, ready = false
    const probe = vi.fn(async () => ready)
    const gate = createReleaseRequestGate(probe, () => time)
    const requests = () => Promise.all(Array.from({ length: 100 }, () => gate(new Request('http://local/_serverFn/read'))))
    expect((await requests()).every(response => response?.status === 503)).toBe(true)
    expect(probe).toHaveBeenCalledTimes(1)
    ready = true; time = 4_999
    await requests()
    expect(probe).toHaveBeenCalledTimes(1)
    time = 5_000
    expect((await requests()).every(response => response === null)).toBe(true)
    expect(probe).toHaveBeenCalledTimes(2)
    time = 10_000; ready = false
    expect((await requests()).every(response => response?.status === 503)).toBe(true)
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('does not disclose database errors or retry mutations automatically', async () => {
    const gate = createReleaseRequestGate(() => { throw new Error('postgres://secret-password') })
    const response = await gate(new Request('http://local/_serverFn/save', { method: 'POST' }))
    expect(response?.status).toBe(503)
    expect(await response?.text()).not.toContain('secret-password')
  })
})
