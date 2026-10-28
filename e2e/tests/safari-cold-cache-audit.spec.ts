import { expect, test } from '@playwright/test'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { prepareSafariMeasurementWindow } from '../safari-foreground'

test.use({ trace: 'off', video: 'off' })

test('installed Safari: verified fresh-origin delivery and warm refreshes', async ({}, info) => {
  test.skip(process.env.AUDIT_SAFARI_COLD_CACHE !== '1', 'Requires the owned visible SafariDriver window')
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(info.project.use.baseURL).toBe('http://127.0.0.1:3100')
  test.setTimeout(600_000)
  const upstream = 'http://127.0.0.1:3100'
  let origin = '', session = ''
  const requests: Array<{ path: string; status: number; bytes: number }> = []
  const proxy = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (value && !['host', 'connection', 'content-length', 'accept-encoding'].includes(key)) {
          headers.set(key, Array.isArray(value) ? value.join(',') : value)
        }
      }
      if (headers.get('origin') === origin) headers.set('origin', upstream)
      const response = await fetch(upstream + req.url, {
        method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: 'manual',
      })
      const body = Buffer.from(await response.arrayBuffer())
      requests.push({ path: req.url!, status: response.status, bytes: body.length })
      res.statusCode = response.status
      for (const [key, value] of response.headers) {
        if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(key)) res.setHeader(key, value)
      }
      res.end(body)
    } catch (error) { res.writeHead(502); res.end(String(error)) }
  })
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch('http://127.0.0.1:4445' + path, {
      method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000),
    })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result.value))
    return result.value
  }
  const samples: unknown[] = [], ports = new Set<number>()
  let browserVersion = ''
  try {
    const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari', pageLoadStrategy: 'eager' } } })
    session = '/session/' + created.sessionId
    browserVersion = created.capabilities.browserVersion
    const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
    await command(session + '/window/rect', { x: 0, y: 0, width: 1600, height: 1050 })
    await prepareSafariMeasurementWindow(command, session, 300_000)
    for (let cold = 0; cold < 3; cold++) {
      proxy.listen(0, '127.0.0.1')
      await once(proxy, 'listening')
      const address = proxy.address()
      if (!address || typeof address === 'string') throw new Error('Expected owned loopback listener')
      expect(ports.has(address.port)).toBe(false)
      ports.add(address.port)
      origin = 'http://127.0.0.1:' + address.port
      for (let round = 0; round <= 5; round++) {
        const token = `${cold}:${round}`
        await execute('window.coldCachePreviousDocument=arguments[0]', token)
        const before = requests.length, start = performance.now()
        if (round === 0) await command(session + '/url', { url: origin + '/journal' })
        else await command(session + '/refresh', {})
        await expect.poll(() => execute(`return location.origin===arguments[0]&&window.coldCachePreviousDocument!==arguments[1]&&
          document.querySelector('.journal-grid-frame')?.getAttribute('aria-busy')==='false'&&
          !!document.querySelector('.ag-row[row-id]')`, origin, token), { timeout: 30_000 }).toBe(true)
        const readyMs = performance.now() - start
        const metrics = await execute(`const nav=performance.getEntriesByType('navigation')[0];return {
          visible:!document.hidden,ttfbMs:nav.responseStart,htmlCompleteMs:nav.responseEnd,
          domContentLoadedMs:nav.domContentLoadedEventEnd,
          resources:performance.getEntriesByType('resource').map(e=>({path:new URL(e.name).pathname,bytes:e.transferSize,durationMs:e.duration}))}`)
        expect(metrics.visible).toBe(true)
        const delivery = requests.slice(before), assets = delivery.filter(row => row.path.startsWith('/assets/'))
        if (round === 0) {
          // Evidence comes from delivered HTTP bodies, not a new session label.
          expect(assets.filter(row => row.status === 200 && row.bytes > 0).length).toBeGreaterThan(10)
          expect(assets.some(row => /^\/assets\/index-/.test(row.path))).toBe(true)
        }
        samples.push({ cold, round, phase: round ? 'warm-refresh' : 'verified-cold-origin', readyMs, delivery, ...metrics })
      }
      proxy.closeAllConnections()
      await new Promise<void>(resolve => proxy.close(() => resolve()))
    }
  } finally {
    try { if (session) await command(session, undefined, 'DELETE') } finally {
      proxy.closeAllConnections()
      if (proxy.listening) await new Promise<void>(resolve => proxy.close(() => resolve()))
      await writeFile(info.outputPath('safari-cold-cache.json'), JSON.stringify({ browserVersion,
        environment: 'installed Safari, normal CPU, loopback forwarding adds overhead; server/database warm', samples }, null, 2))
    }
  }
})
