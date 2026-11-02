import { expect, test } from '@playwright/test'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prepareSafariMeasurementWindow } from '../safari-foreground'
import { setupDeepOpeningFixture, cleanupDeepOpeningFixture, total, documentCount, templateBytes } from '../deep-report-opening-fixture'
import { installOpeningProbe } from '../deep-report-opening-probe'
import { deserializeRpcResponse, rpcName, serializeRpcData } from '../rpc'

const enabled = process.env.DEEP_REPORT_COLD_SAFARI === '1'
test.skip(!enabled, 'Opt-in four-report cold-origin comparison in one installed Safari session')
test.use({ trace: 'off', video: 'off' })
const reports = [
  { name: 'journal', report: 'weldingJournal', path: '/journal' },
  { name: 'lnk', report: 'lnk', path: '/lnk' },
  { name: 'psto', report: 'heatTreatment', path: '/psto' },
  { name: 'documents', report: null, path: '/documents' },
] as const

test.beforeAll(async () => {
  if (!enabled) return
  test.setTimeout(600_000)
  expect(total).toBe(9000)
  expect(documentCount).toBe(250)
  await setupDeepOpeningFixture()
})
test.afterAll(async () => {
  if (!enabled) return
  test.setTimeout(600_000)
  await cleanupDeepOpeningFixture()
})

test('installed Safari: three verified cold origins per report and one warm reload each', async ({ request }, info) => {
  test.setTimeout(1_200_000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(info.project.use.baseURL).toBe('http://127.0.0.1:3100')
  const upstream = 'http://127.0.0.1:3100'
  const samples: object[] = [], preparation: object[] = [], diagnostics: object[] = []
  const expectedCounts = new Map<string, number>()
  const deliveries: Array<{ origin: string; path: string; status: number; bytes: number; durationMs: number }> = []
  const ports = new Set<number>()
  let origin = '', session = '', browserVersion = '', activePhase = 'server-preparation'
  const proxy = createServer(async (req, res) => {
    const started = performance.now(), requestOrigin = `http://${req.headers.host}`
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (value && !['host', 'connection', 'content-length', 'accept-encoding'].includes(key)) {
          headers.set(key, Array.isArray(value) ? value.join(',') : value)
        }
      }
      if (headers.get('origin') === requestOrigin) headers.set('origin', upstream)
      const response = await fetch(upstream + req.url, {
        method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: 'manual',
      })
      const body = Buffer.from(await response.arrayBuffer())
      deliveries.push({ origin: requestOrigin, path: new URL(req.url!, upstream).pathname,
        status: response.status, bytes: body.length, durationMs: performance.now() - started })
      res.statusCode = response.status
      for (const [key, value] of response.headers) {
        if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(key)) res.setHeader(key, value)
      }
      // Keep normal successful-asset caching; a new origin proves delivery.
      res.end(body)
    } catch (error) {
      diagnostics.push({ phase: activePhase, proxyError: String(error) })
      if (!res.headersSent) res.writeHead(502)
      res.end('Local comparison proxy failed')
    }
  })
  const closeProxy = async () => {
    proxy.closeAllConnections()
    if (proxy.listening) await new Promise<void>(done => proxy.close(() => done()))
  }
  const freshOrigin = async () => {
    // A port may be reallocated after close. Reject reuse without calling that
    // browser origin cold; retry the OS allocation while owning the listener.
    for (let attempt = 0; attempt < 20; attempt++) {
      proxy.listen(0, '127.0.0.1')
      await once(proxy, 'listening')
      const address = proxy.address()
      if (!address || typeof address === 'string') throw new Error('Expected owned loopback listener')
      if (!ports.has(address.port)) {
        ports.add(address.port)
        return `http://127.0.0.1:${address.port}`
      }
      await closeProxy()
    }
    throw new Error('Could not allocate a previously unused local origin')
  }
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<any> => {
    const response = await fetch('http://127.0.0.1:4445' + path, { method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000) })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw new Error(`${path}: ${JSON.stringify(result.value)}`)
    return result.value
  }
  const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
  const foreground = async () => expect(await execute('return {visible:!document.hidden,focused:document.hasFocus()}'),
    'Keep the owned local Safari window in the foreground').toEqual({ visible: true, focused: true })

  try {
    // Resolve only the selected saved bundle's RPC names. Prime the actual
    // server and dispatcher through authenticated HTTP, never through current
    // source imports or a browser page whose assets would warm the cold sample.
    const server = resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output', 'server')
    const resolvers = (await readdir(server)).filter(name => name.includes('tanstack-start-server-fn-resolver') && name.endsWith('.mjs'))
    expect(resolvers).toHaveLength(1)
    const source = await readFile(resolve(server, resolvers[0]), 'utf8')
    const functions = new Map([...source.matchAll(/"([a-f0-9]{64})":\s*\{\s*functionName:\s*"([^"\n]+)"/g)]
      .map(match => [match[2], match[1]]))
    const call = async <T,>(name: string, data: unknown): Promise<T> => {
      const id = functions.get(`${name}_createServerFn_handler`)
      expect(id, name).toBeTruthy()
      const started = performance.now()
      const response = await request.post(`${upstream}/_serverFn/${id}`, { data: await serializeRpcData(data),
        headers: { origin: upstream, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
        timeout: 240_000 })
      expect(response.ok(), name).toBe(true)
      const payload = await deserializeRpcResponse(await response.text()) as { result: T; error?: unknown }
      if (payload.error) throw payload.error
      preparation.push({ rpc: name, milliseconds: performance.now() - started })
      return payload.result
    }
    for (const report of reports) {
      if (report.report) {
        const rows = await call<{ rowCount: number; rows: unknown[]; revision: number | string }>('readJournalGrid', {
          report: report.report, columnFilters: {}, groupBy: [], route: [], start: 0, end: 100,
        })
        expect(rows.rows.length).toBeGreaterThan(0)
        expect(rows.rowCount).toBeGreaterThanOrEqual(total)
        const summary = await call<{ total: number }>('getJournalReportSummary', {
          report: report.report, columnFilters: {}, revision: rows.revision,
        })
        expect(summary.total).toBe(rows.rowCount)
        expectedCounts.set(report.name, summary.total)
      } else {
        const docs = await call<{ rows: unknown[]; total: number }>('listRemoteGeneratedDocumentHistoryGrid', {
          type: 'weldingJournal', columnFilters: {}, startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [],
        })
        expect(docs.rows.length).toBeGreaterThan(0)
        expect(docs.total).toBe(documentCount)
        expectedCounts.set(report.name, docs.total)
      }
    }
    console.log('DEEP_COLD_SAFARI_SERVER_READY', JSON.stringify({ counts: Object.fromEntries(expectedCounts), preparation }))
    const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari', pageLoadStrategy: 'eager' } } })
    session = '/session/' + created.sessionId
    browserVersion = created.capabilities.browserVersion
    await command(session + '/window/rect', { x: 0, y: 0, width: 1600, height: 1050 })
    await prepareSafariMeasurementWindow(command, session, 300_000)
    for (let cold = 0; cold < 3; cold++) for (const report of reports) {
      origin = await freshOrigin()
      const root = report.report ? `[data-weld-report-grid="${report.report}"]` : '[data-document-history-grid="generated:weldingJournal"]'
      const target = { name: report.name, path: report.path, root, frame: `${root} .journal-grid-frame`,
        leaf: report.report ? '.ag-row[row-id]:not(.ag-row-group):not(.ag-row-loading)' : '.ag-row[row-id^="document:"]',
        footer: report.report ? '[data-journal-footer]' : '.document-grid-footer' }
      for (let warm = 0; warm <= 1; warm++) {
        activePhase = `${report.name}:${cold}:${warm ? 'warm-reload' : 'verified-cold-origin'}`
        console.log('DEEP_COLD_SAFARI_PHASE', JSON.stringify({ phase: activePhase, state: 'start' }))
        await foreground()
        await execute('window.deepColdPreviousDocument=arguments[0]', activePhase)
        const before = deliveries.length, started = performance.now()
        if (warm) await command(session + '/refresh', {})
        else await command(session + '/url', { url: origin + report.path })
        await execute(`(${installOpeningProbe.toString()})(arguments[0]);
          window.deepColdVisibility={installedAtMs:performance.now(),visible:true,focused:true,frames:0,active:true};
          const tick=()=>{const v=window.deepColdVisibility;if(!v.active)return;v.frames++;v.visible&&=!document.hidden;v.focused&&=document.hasFocus();requestAnimationFrame(tick)};tick()`, target)
        let rowsReadyMs: number | null = null, summaryReadyMs: number | null = null
        await expect.poll(async () => {
          const state = await execute(`if(location.origin!==arguments[0]||location.pathname!==arguments[1].path||window.deepColdPreviousDocument===arguments[2])return null;
            const root=document.querySelector(arguments[1].root),frame=document.querySelector(arguments[1].frame);
            if(!root||!frame||frame.getAttribute('aria-busy')==='true'||frame.hasAttribute('data-journal-updating'))return null;
            const rows=!!root.querySelector(arguments[1].leaf)&&!root.querySelector('.ag-row-loading');
            const text=root.querySelector(arguments[1].footer)?.textContent||'';
            const summary=rows&&!/Подсчёт|Загрузка…/.test(text)&&[...root.querySelectorAll(arguments[1].footer+' span')].some(e=>e.textContent.trim()==='Найдено: '+arguments[3]);
            return {rows,summary}`, origin, target, activePhase, expectedCounts.get(report.name))
          if (state?.rows && rowsReadyMs === null) rowsReadyMs = performance.now() - started
          if (state?.summary && summaryReadyMs === null) summaryReadyMs = performance.now() - started
          return summaryReadyMs !== null
        }, { timeout: 240_000, intervals: [20, 40, 75, 100], message: activePhase }).toBe(true)
        await foreground()
        const metrics = await execute(`const p=window.deepOpeningProbe;p.inspect();p.stop();const v=window.deepColdVisibility;v.active=false;
          const nav=performance.getEntriesByType('navigation')[0];return {visibility:v,gridMs:p.gridMs,firstRowMs:p.firstRowMs,
            readyAfterTransitionMs:p.readyAfterTransitionMs,summaryMs:p.summaryMs,
            navigation:{ttfbMs:nav.responseStart,htmlCompleteMs:nav.responseEnd,domContentLoadedMs:nav.domContentLoadedEventEnd,type:nav.type},
            resources:performance.getEntriesByType('resource').map(e=>({url:e.name,startMs:e.startTime,finishMs:e.responseEnd,
              transferBytes:e.transferSize,encodedBytes:e.encodedBodySize}))}`)
        expect(metrics.visibility.visible).toBe(true)
        expect(metrics.visibility.focused).toBe(true)
        const delivery = deliveries.slice(before).filter(item => item.origin === origin)
        const assets = delivery.filter(item => item.path.startsWith('/assets/') && item.status === 200 && item.bytes > 0)
        if (!warm) {
          expect(delivery.some(item => item.path === report.path && item.status === 200 && item.bytes > 0), `${activePhase}: delivered HTML body`).toBe(true)
          expect(assets.length, `${activePhase}: delivered asset bodies`).toBeGreaterThan(10)
          expect(assets.some(item => /^\/assets\/index-.*\.js$/.test(item.path)), `${activePhase}: delivered entry JS body`).toBe(true)
        }
        const resources = metrics.resources as Array<{ url: string; startMs: number; finishMs: number; transferBytes: number; encodedBytes: number }>
        samples.push({ report: report.name, cold, phase: warm ? 'warm-reload' : 'verified-cold-origin', origin,
          expectedCount: expectedCounts.get(report.name), observedRowsReadyMs: rowsReadyMs, observedSummaryReadyMs: summaryReadyMs,
          ...metrics, delivery, requests: resources.filter(item => item.url.includes('/_serverFn/')).map(item => ({ ...item, name: rpcName(item.url) })) })
        console.log('DEEP_COLD_SAFARI_PHASE', JSON.stringify({ phase: activePhase, state: 'complete', rowsReadyMs, summaryReadyMs, deliveredAssets: assets.length }))
      }
      // Stop the old page's polling before disposing its loopback listener.
      await command(session + '/url', { url: 'about:blank' })
      await closeProxy()
    }
    expect(samples).toHaveLength(24)
    expect(ports.size).toBe(12)
  } catch (error) {
    if (session) {
      try {
        diagnostics.push({ phase: activePhase, state: await execute('return {url:location.href,text:document.body?.innerText,hidden:document.hidden,focused:document.hasFocus()}') })
        await writeFile(info.outputPath('deep-cold-safari-failure.png'), Buffer.from(await command(session + '/screenshot'), 'base64'))
      } catch (diagnosticError) { diagnostics.push({ diagnosticError: String(diagnosticError) }) }
    }
    throw error
  } finally {
    try { if (session) await command(session, undefined, 'DELETE') } finally {
      await closeProxy()
      await writeFile(info.outputPath(`deep-cold-safari-${process.env.DEEP_OPENING_LABEL ?? 'unlabelled'}.json`), JSON.stringify({
        label: process.env.DEEP_OPENING_LABEL ?? 'unlabelled', browser: 'installed Safari', browserVersion, sessions: session ? 1 : 0,
        joints: total, documents: documentCount, templateBytes, coldSamplesPerReport: 3, warmReloadsPerOrigin: 1,
        limitations: ['Cold browser-origin HTTP delivery is proven by received HTML/JS bodies; this is not cold disk, server or database.',
          'Dispatcher, server report modules and SQL caches are primed through actual saved-bundle HTTP before Safari; preparation is outside timings.',
          'The loopback forwarding proxy adds overhead; compare only identical proxy profiles before/after.',
          'DOM readiness is a polling upper bound; observer/RAF visibility begin after eager navigation returns, with the installation offset recorded.',
          'One warm reload checks each origin; twenty warm visits and update/recovery belong to the separate profiles.'],
        preparation, samples, diagnostics,
      }, null, 2))
    }
  }
})
