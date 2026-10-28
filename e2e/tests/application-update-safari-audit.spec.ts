import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { E2E_DATABASE_URL } from '../database'
import { prepareSafariMeasurementWindow } from '../safari-foreground'

test.use({ trace: 'off', video: 'off' })

test('installed Safari: local version switch, initial module faults and explicit recovery', async ({ request }, info) => {
  test.skip(process.env.AUDIT_SAFARI_UPDATE !== '1', 'Requires the owned installed SafariDriver window')
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(info.project.use.baseURL).toBe('http://127.0.0.1:3100')
  expect(process.env.AUDIT_OLD_BUILD).toBeTruthy()
  test.setTimeout(300_000)
  const previousBuild = resolve(process.env.AUDIT_OLD_BUILD!)
  expect(previousBuild).not.toBe(resolve('.output'))
  const retiredGuide = (await readdir(resolve(previousBuild, 'public/assets'))).find(name => /^user-guide-page-.*\.js$/.test(name))!
  expect(retiredGuide).toBeTruthy()
  expect(await readdir(resolve('.output/public/assets'))).not.toContain(retiredGuide)
  const previousOrigin = 'http://127.0.0.1:3117'
  let origin = 'http://127.0.0.1:3118'
  let occupied = false
  try { await request.get(previousOrigin, { timeout: 1000 }); occupied = true } catch {}
  expect(occupied).toBe(false)
  const old = spawn(process.execPath, [resolve(previousBuild, 'server/index.mjs')], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1', HOST: '127.0.0.1', PORT: '3117', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let oldLog = '', oldDelivery = true, fault: null | 'network' | 'syntax' | 'execution' = null, session = ''
  const requests: Array<{ path: string; old: boolean; status: number }> = []
  old.stdout?.on('data', value => { oldLog += value })
  old.stderr?.on('data', value => { oldLog += value })
  // A loopback proxy changes only test asset delivery. RPCs always reach the
  // current server and its disposable DB; no user browser tabs are attached.
  const proxy = createServer(async (req, res) => {
    try {
      const path = req.url!, asset = path.startsWith('/assets/'), useOld = oldDelivery && (asset || path.startsWith('/journal'))
      if (fault && /^\/assets\/index-[^/]+\.js(?:\?.*)?$/.test(path)) {
        const status = fault === 'network' ? 503 : 200
        requests.push({ path, old: false, status })
        res.writeHead(status, { 'content-type': 'application/javascript', 'cache-control': 'no-store' })
        res.end(fault === 'syntax' ? 'export const interrupted = ;' : 'throw new Error("Local Safari entry probe")')
        return
      }
      const target = useOld ? previousOrigin : 'http://127.0.0.1:3100'
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) if (value && !['host', 'connection', 'content-length', 'accept-encoding'].includes(key)) headers.set(key, Array.isArray(value) ? value.join(',') : value)
      if (headers.get('origin') === origin) headers.set('origin', target)
      const response = await fetch(target + path, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: 'manual' })
      requests.push({ path, old: useOld, status: response.status })
      res.statusCode = response.status
      for (const [key, value] of response.headers) if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(key)) res.setHeader(key, value)
      // Preserve successful asset caching. HTML and injected failures stay fresh.
      if (!asset) res.setHeader('cache-control', 'no-store')
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) { res.writeHead(502); res.end(String(error)) }
  })
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch('http://127.0.0.1:4445' + path, { method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000) })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result.value))
    return result.value
  }
  const samples: unknown[] = []
  try {
    await expect.poll(async () => {
      if (old.exitCode !== null) throw new Error(oldLog.slice(-1000))
      try { return (await request.get(previousOrigin + '/journal', { timeout: 1000 })).ok() } catch { return false }
    }, { timeout: 15000 }).toBe(true)
    proxy.listen(3118, '127.0.0.1')
    await once(proxy, 'listening')
    const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari', pageLoadStrategy: 'eager' } } })
    session = '/session/' + created.sessionId
    const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
    const wait = (script: string) => expect.poll(() => execute(script), { timeout: 30_000 }).toBe(true)
    const click = async (selector: string) => {
      const element = await command(session + '/element', { using: 'css selector', value: selector })
      await command(session + '/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/click', {})
    }
    await command(session + '/window/rect', { x: 0, y: 0, width: 1600, height: 1050 })
    await prepareSafariMeasurementWindow(command, session)
    await command(session + '/url', { url: origin + '/journal' })
    await wait('return document.querySelector(".journal-grid-frame")?.getAttribute("aria-busy")==="false"')
    expect(requests.some(item => item.old && /^\/assets\/index-/.test(item.path))).toBe(true)
    expect(requests.some(item => item.path.includes(retiredGuide))).toBe(false)
    oldDelivery = false
    const before = requests.filter(item => item.path === '/user-guide').length
    await execute('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="Руководство пользователя").click()')
    await wait('return [...document.querySelectorAll("input")].some(e=>e.placeholder==="Например: заявка, клеймо")')
    expect(requests.some(item => item.path === '/assets/' + retiredGuide && item.status === 404)).toBe(true)
    expect(requests.filter(item => item.path === '/user-guide').length - before).toBe(1)
    samples.push({ phase: 'version switch', browser: created.capabilities.browserVersion, requests: [...requests] })
    // A fresh loopback origin for each fault avoids successful assets cached
    // by the version-switch phase. Keep the original module dependency graph.
    for (const mode of ['network', 'syntax', 'execution'] as const) {
      proxy.closeAllConnections()
      await new Promise<void>(resolve => proxy.close(() => resolve()))
      proxy.listen(0, '127.0.0.1')
      await once(proxy, 'listening')
      const address = proxy.address()
      if (!address || typeof address === 'string') throw new Error('Expected an owned loopback port')
      origin = 'http://127.0.0.1:' + address.port
      fault = mode
      console.log('SAFARI_ENTRY_PROBE', mode, origin)
      const requestStart = requests.length
      await command(session + '/url', { url: origin + '/journal' })
      await wait('return document.getElementById("app-bootstrap-recovery")?.hidden===false')
      expect(requests.slice(requestStart).some(item => /^\/assets\/index-/.test(item.path))).toBe(true)
      const failedRequests = requests.filter(item => /^\/assets\/index-/.test(item.path)).length
      fault = null
      await click('#app-bootstrap-retry')
      const ready = 'return document.querySelector(".journal-grid-frame")?.getAttribute("aria-busy")==="false"'
      let recovered = false
      try { await wait(ready); recovered = true } catch {
        await writeFile(info.outputPath('safari-' + mode + '-retry-failure.json'), JSON.stringify(await execute('return {url:location.href,text:document.body.innerText,hidden:document.hidden,resources:performance.getEntriesByType("resource").map(e=>({name:e.name,bytes:e.transferSize}))}'), null, 2))
      }
      expect.soft(recovered, mode + ': explicit reload must recover after the server fault is removed').toBe(true)
      const hidden = await execute('return document.hidden')
      let recoveredAfterNewSession: boolean | null = null
      if (!recovered) {
        await command(session, undefined, 'DELETE')
        session = ''
        const fresh = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari', pageLoadStrategy: 'eager' } } })
        session = '/session/' + fresh.sessionId
        await command(session + '/url', { url: origin + '/journal' })
        try { await wait(ready); recoveredAfterNewSession = true } catch { recoveredAfterNewSession = false }
      }
      samples.push({ phase: mode, failedRequests, recovered, recoveredAfterNewSession, hidden })
      console.log('SAFARI_ENTRY_RESULT', JSON.stringify(samples.at(-1)))
    }
  } catch (error) {
    if (session) {
      try {
        const diagnostic = await command(session + '/execute/sync', { script: 'return {url:location.href,text:document.body.innerText,hidden:document.hidden,readyState:document.readyState,resources:performance.getEntriesByType("resource").map(e=>({name:e.name,bytes:e.transferSize}))}', args: [] })
        await writeFile(info.outputPath('safari-update-failure.json'), JSON.stringify(diagnostic, null, 2))
        await writeFile(info.outputPath('safari-update-failure.png'), Buffer.from(await command(session + '/screenshot'), 'base64'))
      } catch { /* Keep the original failure if the failed browser is unavailable. */ }
    }
    throw error
  } finally {
    if (session) await command(session, undefined, 'DELETE')
    if (proxy.listening) { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())) }
    if (old.exitCode === null && old.signalCode === null) {
      const exited = once(old, 'exit'); old.kill('SIGTERM')
      const timer = setTimeout(() => old.kill('SIGKILL'), 10_000)
      try { await exited } finally { clearTimeout(timer) }
    }
    await writeFile(info.outputPath('safari-update-and-faults.json'), JSON.stringify({ samples, requests, oldLog }, null, 2))
  }
})
