import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Browser } from '@playwright/test'
import pg from 'pg'
import { assertSafeE2eDatabaseUrl, E2E_DATABASE_URL } from './database'

const exec = promisify(execFile)

/** Opt-in local audit telemetry only. RSS is sampled, not an exact OS peak. */
export async function sampleLocalAuditResources(browser: Browser) {
  const port = Number(process.env.E2E_PORT || 3100)
  if (port !== 3100) throw new Error('Resource audit expects the isolated E2E server on port 3100')
  const { stdout } = await exec('lsof', ['-t', '-iTCP:3100', '-sTCP:LISTEN'])
  const serverIds = new Set(stdout.trim().split(/\s+/).map(Number))
  if (!serverIds.size || [...serverIds].some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Cannot identify E2E server')
  const session = await browser.newBrowserCDPSession()
  assertSafeE2eDatabaseUrl(E2E_DATABASE_URL)
  const observer = new pg.Client({ connectionString: E2E_DATABASE_URL, application_name: 'audit-observer' })
  await observer.connect()
  let pending: Promise<void> | undefined
  let serverPeakKiB = 0, browserPeakKiB = 0, samples = 0
  let connectionsPeak = 0, activePeak = 0, blockedPeak = 0, parallelWorkersPeak = 0, transactionAgePeakSeconds = 0
  const errors: string[] = []
  const sample = async () => {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo')
    const browserIds = new Set(processInfo.map(process => process.id))
    const ids = [...new Set([...serverIds, ...browserIds])]
    const { stdout: processes } = await exec('ps', ['-o', 'pid=,rss=', '-p', ids.join(',')])
    let serverKiB = 0, browserKiB = 0
    for (const line of processes.trim().split('\n')) {
      const [pid, rss] = line.trim().split(/\s+/).map(Number)
      if (serverIds.has(pid)) serverKiB += rss
      if (browserIds.has(pid)) browserKiB += rss
    }
    serverPeakKiB = Math.max(serverPeakKiB, serverKiB)
    browserPeakKiB = Math.max(browserPeakKiB, browserKiB)
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
  try { await sample() } catch (error) { await observer.end(); await session.detach(); throw error }
  const timer = setInterval(() => {
    if (!pending) pending = sample().catch(error => { errors.push(String(error)) }).finally(() => { pending = undefined })
  }, 500)
  return async () => {
    clearInterval(timer)
    await pending
    await sample().catch(error => { errors.push(String(error)) })
    await session.detach()
    await observer.end()
    return { sampleIntervalMs: 500, samples, serverPeakMiB: Math.round(serverPeakKiB / 1024),
      browserProcessSumPeakMiB: Math.round(browserPeakKiB / 1024), connectionsPeak, activePeak,
      blockedPeak, parallelWorkersPeak, transactionAgePeakSeconds: Math.round(transactionAgePeakSeconds * 100) / 100, errors }
  }
}
