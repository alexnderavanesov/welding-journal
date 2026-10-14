import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import type { Browser, BrowserContext, Page, Request } from '@playwright/test'
import pg from 'pg'
import { E2E_DATABASE_URL, assertSafeE2eDatabaseUrl } from './database'
import { rpcName } from './rpc'

const exec = promisify(execFile)
export function observeMixedClient(context: BrowserContext, role: string) {
  const calls: Array<{ name: string; milliseconds: number; bytes: number; status: number }> = []
  const errors: string[] = [], expectedFailures: string[] = [], pending = new Map<Request, number>()
  const injectedNetworkFailures = new WeakSet<Request>()
  const navigationReads = new Map<Page, Set<Request>>()
  const abandonedOnNavigation: string[] = []
  const sizes: Promise<void>[] = []
  let peakInFlight = 0, rpcStarted = 0
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message))
    page.on('crash', () => errors.push('page crashed'))
    page.on('domcontentloaded', () => {
      // Chromium can close an old document's fetch socket on hard navigation
      // without emitting requestfailed/loadingFailed (covered by a real browser
      // regression). Retire only reads captured BEFORE that navigation started,
      // never writes, same-document navigation, or the new document's requests.
      for (const request of navigationReads.get(page) ?? []) {
        if (pending.delete(request)) abandonedOnNavigation.push(rpcName(request.url()))
      }
      navigationReads.delete(page)
    })
  })
  context.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame()) {
      const page = request.frame().page(), reads = navigationReads.get(page) ?? new Set<Request>()
      for (const old of pending.keys()) {
        if (old.frame().page() === page && (old.method() === 'GET' || rpcName(old.url()).startsWith('refreshDispatcherTaskSnapshot'))) reads.add(old)
      }
      navigationReads.set(page, reads)
    }
    if (!request.url().includes('/_serverFn/')) return
    rpcStarted++
    pending.set(request, performance.now()); peakInFlight = Math.max(peakInFlight, pending.size)
  })
  context.on('requestfailed', request => {
    if (!pending.delete(request)) return
    const failure = `${rpcName(request.url())}: ${request.failure()?.errorText}`
    // Only the exact request explicitly marked by the fault injector is exempt.
    // Earlier cancelled reads must neither consume that exemption nor cause a
    // genuine first write failure to be silently accepted.
    if (injectedNetworkFailures.delete(request) && request.failure()?.errorText === 'net::ERR_FAILED') expectedFailures.push(failure)
    else if (request.failure()?.errorText === 'net::ERR_ABORTED' && request.method() === 'GET') expectedFailures.push(failure)
    else errors.push(failure)
  })
  context.on('requestfinished', request => {
    const start = pending.get(request)
    if (start === undefined) return
    pending.delete(request)
    sizes.push((async () => {
      const response = await request.response()
      const entry = { name: rpcName(request.url()), milliseconds: Math.round(performance.now() - start),
        bytes: (await request.sizes()).responseBodySize, status: response?.status() ?? 0 }
      calls.push(entry)
      if (entry.status >= 400) errors.push(`${entry.name}: HTTP ${entry.status}`)
    })().catch(error => { errors.push(String(error)) }))
  })
  return { calls, errors, expectedFailures, pending,
    expectInjectedNetworkFailure(request: Request) {
      if (!pending.has(request)) throw new Error('Fault injection must mark the exact active request')
      injectedNetworkFailures.add(request)
    },
    async summary() {
    await Promise.all(sizes)
    const sorted = calls.map(call => call.milliseconds).sort((a, b) => a - b)
    return { role, rpc: calls.length, rpcStarted, peakInFlight, bytes: calls.reduce((total, call) => total + call.bytes, 0),
      maxResponseBytes: Math.max(0, ...calls.map(call => call.bytes)),
      p95Milliseconds: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0,
      maxMilliseconds: sorted.at(-1) ?? 0,
      byName: Object.fromEntries([...new Set(calls.map(call => call.name))].map(name => [name, calls.filter(call => call.name === name).length])),
      transferByName: Object.fromEntries([...new Set(calls.map(call => call.name))].map(name => {
        const matching = calls.filter(call => call.name === name)
        return [name, { bytes: matching.reduce((sum, call) => sum + call.bytes, 0), maxBytes: Math.max(...matching.map(call => call.bytes)) }]
      })),
      pending: [...pending.keys()].map(request => rpcName(request.url())), errors, expectedFailures, abandonedOnNavigation }
  } }
}

export async function sampleMixedResources(browser: Browser) {
  assertSafeE2eDatabaseUrl(E2E_DATABASE_URL)
  const observer = new pg.Client({ connectionString: E2E_DATABASE_URL, application_name: 'mixed-audit-observer' })
  await observer.connect()
  const session = await browser.newBrowserCDPSession()
  let pending: Promise<void> | undefined
  let samples = 0, browserPeakKiB = 0, connectionsPeak = 0, activePeak = 0, blockedPeak = 0, parallelWorkersPeak = 0, transactionAgePeakSeconds = 0
  const errors: string[] = []
  const cgroup = async () => {
    const { stdout } = await exec('docker', ['exec', 'welding-mixed-resource-20261009', 'node', '-e',
      `const fs=require('node:fs');console.log(JSON.stringify(Object.fromEntries(['memory.peak','memory.events','cpu.stat','cpu.max','memory.max','memory.swap.max'].map(n=>[n,fs.readFileSync('/sys/fs/cgroup/'+n,'utf8').trim()]))))`])
    return JSON.parse(stdout) as Record<string, string>
  }
  const firstCgroup = await cgroup()
  const sample = async () => {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo')
    const { stdout } = await exec('ps', ['-o', 'rss=', '-p', processInfo.map(process => process.id).join(',')])
    browserPeakKiB = Math.max(browserPeakKiB, stdout.trim().split(/\s+/).reduce((sum, value) => sum + Number(value), 0))
    const { rows: [database] } = await observer.query(`select count(*) filter(where backend_type='client backend')::int as connections,
      count(*) filter(where state='active' and backend_type='client backend')::int as active,
      count(*) filter(where backend_type='parallel worker')::int as parallel_workers,
      count(*) filter(where wait_event_type='Lock')::int as blocked,
      coalesce(max(extract(epoch from clock_timestamp()-xact_start)),0)::float8 as transaction_age
      from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()`)
    connectionsPeak = Math.max(connectionsPeak, database.connections)
    activePeak = Math.max(activePeak, database.active)
    blockedPeak = Math.max(blockedPeak, database.blocked)
    parallelWorkersPeak = Math.max(parallelWorkersPeak, database.parallel_workers)
    transactionAgePeakSeconds = Math.max(transactionAgePeakSeconds, database.transaction_age)
    samples++
  }
  const timer = setInterval(() => {
    if (!pending) pending = sample().catch(error => { errors.push(String(error)) }).finally(() => { pending = undefined })
  }, 500)
  return async () => {
    clearInterval(timer); await pending
    // The container runner also cleans up a crashed process. Its last atomic
    // telemetry file survives on the host for postmortem; it is not a final peak.
    let postmortem = false
    const lastCgroup = await cgroup().catch(async () => {
      postmortem = true
      return (JSON.parse(await readFile(process.env.AUDIT_SQL_COUNTS_FILE!, 'utf8')) as { resources: { cgroup: Record<string, string> } }).resources.cgroup
    })
    const server = JSON.parse(await readFile(process.env.AUDIT_SQL_COUNTS_FILE!, 'utf8'))
    await session.detach(); await observer.end()
    return { sampleIntervalMs: 500, samples, browserProcessSumPeakMiB: Math.round(browserPeakKiB / 1024),
      connectionsPeak, activePeak, blockedPeak, parallelWorkersPeak, transactionAgePeakSeconds: Math.round(transactionAgePeakSeconds * 100) / 100,
      firstCgroup, lastCgroup, postmortem, server, errors }
  }
}
