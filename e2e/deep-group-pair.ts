import { expect, type Page, type TestInfo } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { assertSafeE2eDatabaseUrl, E2E_DATABASE_URL } from './database'
import { deserializeRpcResponse, serializeRpcData } from './rpc'
import type { JournalGridRequest, JournalGridResult } from '../src/lib/journal-server-grid'

type ReadMetric = { calls: number; rows: number; totalMilliseconds: number }
type MemorySample = { uptimeSeconds: number; rss: number; heapUsed: number; external: number }
type Snapshot = {
  statements: number; operations: Record<string, number>;
  resources: { node: string; heapLimitBytes: number; reads: Record<string, ReadMetric>; samples: MemorySample[];
    slowReads?: Array<{ uptimeSeconds: number; table: string; milliseconds: number; rows: number; columns?: string[] }> }
}
type Endpoint = { name: 'baseline' | 'current'; origin: string; rpc: string; countsFile: string; bundle: string }
const port = 3117, pairCount = 9

async function manifestRpc(bundle: string, origin: string) {
  const directory = join(bundle, 'server')
  const manifests = (await readdir(directory)).filter(name => name.includes('tanstack-start-server-fn-resolver') && name.endsWith('.mjs'))
  expect(manifests).toHaveLength(1)
  const source = await readFile(join(directory, manifests[0]), 'utf8')
  const entries = [...source.matchAll(/"([a-f0-9]{64})":\s*\{\s*functionName:\s*"([^"\n]+)"/g)]
    .filter(match => match[2] === 'readJournalGrid_createServerFn_handler')
  expect(entries).toHaveLength(1)
  return `${origin}/_serverFn/${entries[0][1]}`
}

async function assertUnusedPort() {
  const probe = createServer()
  await new Promise<void>((resolvePromise, reject) => {
    probe.once('error', reject)
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(error => error ? reject(error) : resolvePromise()))
  })
}

async function waitForListener(child: ChildProcess, startError: () => Error | undefined) {
  const deadline = performance.now() + 60_000
  while (performance.now() < deadline) {
    if (startError()) throw startError()
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Owned secondary server exited before readiness; see group-pair-secondary.log')
    const connected = await new Promise<boolean>(resolvePromise => {
      const socket = createConnection({ host: '127.0.0.1', port })
      const done = (value: boolean) => { socket.destroy(); resolvePromise(value) }
      socket.once('connect', () => done(true)); socket.once('error', () => done(false))
      socket.setTimeout(1000, () => done(false))
    })
    if (connected) return
    await delay(100)
  }
  throw new Error('Owned secondary server did not listen within 60 seconds')
}

async function stopOwnedChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  let exited = false
  const exit = new Promise<void>(resolvePromise => child.once('exit', () => { exited = true; resolvePromise() }))
  child.kill('SIGTERM')
  await Promise.race([exit, delay(10_000, undefined, { ref: false })])
  if (!exited) { child.kill('SIGKILL'); await Promise.race([exit, delay(5000, undefined, { ref: false })]) }
  if (!exited) throw new Error('Owned secondary process did not stop; preserving its diagnostics')
}

function caseVariant(project: string, ordinal: number) {
  let bit = 0
  return [...project].map(character => /[a-z]/i.test(character)
    ? ordinal & (1 << bit++) ? character.toUpperCase() : character.toLowerCase() : character).join('')
}

function delta(before: Snapshot, after: Snapshot) {
  const reads = Object.fromEntries(Object.entries(after.resources.reads).map(([table, value]) => {
    const previous = before.resources.reads[table] ?? { calls: 0, rows: 0, totalMilliseconds: 0 }
    return [table, { calls: value.calls - previous.calls, rows: value.rows - previous.rows,
      totalMilliseconds: value.totalMilliseconds - previous.totalMilliseconds }]
  }).filter(([, value]) => (value as ReadMetric).calls > 0)) as Record<string, ReadMetric>
  const lastMemoryTime = before.resources.samples.at(-1)?.uptimeSeconds ?? 0
  const lastSlowTime = before.resources.slowReads?.at(-1)?.uptimeSeconds ?? 0
  return { statements: after.statements - before.statements,
    operations: Object.fromEntries(Object.entries(after.operations).map(([operation, count]) => [operation, count - (before.operations[operation] ?? 0)]).filter(([, count]) => Number(count) > 0)),
    reads, pgClientReadMilliseconds: Object.values(reads).reduce((sum, read) => sum + read.totalMilliseconds, 0),
    memoryBefore: before.resources.samples.at(-1), memoryAfter: after.resources.samples.at(-1),
    memorySamples: after.resources.samples.filter(sample => sample.uptimeSeconds > lastMemoryTime),
    slowReads: after.resources.slowReads?.filter(read => read.uptimeSeconds > lastSlowTime) ?? [] }
}

/** Pair only actual HTTP bundles on the parent's unchanged disposable fixture.
 * The second process is ours, loopback-only, and never runs fixture setup. */
export async function measurePairedJournalGroups(page: Page, info: TestInfo, fixture: { project: string; total: number; mixed: boolean }) {
  const primaryVariant = process.env.DEEP_GROUP_PAIR_PRIMARY_VARIANT ?? 'current'
  expect(['baseline', 'current']).toContain(primaryVariant)
  const secondaryVariant = primaryVariant === 'baseline' ? 'current' : 'baseline'
  const cases = (process.env.DEEP_GROUP_PAIR_CASES ?? 'project,lines,nested').split(',').map(value => value.trim())
  expect(cases.length).toBeGreaterThan(0)
  expect(new Set(cases).size).toBe(cases.length)
  expect(cases.every(value => ['project', 'lines', 'nested'].includes(value))).toBe(true)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  expect(process.env.AUDIT_MEMORY, 'Both processes need identical lightweight read/memory telemetry').toBe('1')
  expect(process.env.AUDIT_RESOURCE_CONTAINER).not.toBe('1')
  expect(process.env.AUDIT_CPU_PROFILE).not.toBe('1')
  expect(['1', 'peak']).not.toContain(process.env.AUDIT_HEAP_PROFILE)
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  expect(process.env.DATABASE_URL).toBe(E2E_DATABASE_URL)
  const currentOrigin = new URL(String(info.project.use.baseURL)).origin
  expect(currentOrigin).toBe('http://127.0.0.1:3100')
  expect(process.env.BETTER_AUTH_URL).toBe(currentOrigin)
  expect(Boolean(process.env.BETTER_AUTH_SECRET)).toBe(true)
  const archiveRoot = await realpath(resolve('outputs/deep-optimization-2026-11-01'))
  const secondaryBundle = await realpath(resolve(process.env.DEEP_GROUP_PAIR_BUILD!))
  const primaryBundle = await realpath(resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output'))
  for (const bundle of [primaryBundle, secondaryBundle]) {
    const archiveRelative = relative(archiveRoot, bundle)
    expect(archiveRelative.startsWith('..') || isAbsolute(archiveRelative)).toBe(false)
  }
  expect(secondaryBundle).not.toBe(primaryBundle)
  const primaryCounts = process.env.AUDIT_SQL_COUNTS_FILE!
  expect(primaryCounts.startsWith(join(tmpdir(), 'welding-e2e-sql-')) && primaryCounts.endsWith('/counts.json')).toBe(true)
  await assertUnusedPort()
  const temporary = await mkdtemp(join(tmpdir(), 'welding-e2e-sql-pair-'))
  const wrapper = info.outputPath('group-pair-secondary-audit.mjs')
  await mkdir(dirname(wrapper), { recursive: true })
  const source = await readFile(new URL('./audit-server.mjs', import.meta.url), 'utf8')
  const guard = "assert.equal(process.env.PORT, resourceContainer ? '3000' : '3100')"
  expect(source.split(guard)).toHaveLength(2)
  await writeFile(wrapper, source.replace(guard, "assert.equal(process.env.PORT, resourceContainer ? '3000' : '3117')"))
  const secondaryOrigin = `http://127.0.0.1:${port}`
  const endpoints: Endpoint[] = [
    { name: primaryVariant as Endpoint['name'], origin: currentOrigin, rpc: await manifestRpc(primaryBundle, currentOrigin), countsFile: primaryCounts, bundle: primaryBundle },
    { name: secondaryVariant, origin: secondaryOrigin, rpc: await manifestRpc(secondaryBundle, secondaryOrigin), countsFile: join(temporary, 'counts.json'), bundle: secondaryBundle },
  ]
  const log = createWriteStream(info.outputPath('group-pair-secondary.log'), { flags: 'a' })
  let startError: Error | undefined
  const child = spawn(process.execPath, [wrapper], { cwd: process.cwd(), env: { ...process.env,
    HOST: '127.0.0.1', PORT: String(port), BETTER_AUTH_URL: secondaryOrigin,
    E2E_AUDIT_OUTPUT_DIR: secondaryBundle, AUDIT_SQL_COUNTS_FILE: endpoints[1].countsFile,
  }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.on('error', error => { startError = error; log.write(`Spawn error: ${error.message}\n`) })
  child.stdout?.pipe(log, { end: false }); child.stderr?.pipe(log, { end: false })
  const samples: object[] = [], pairs: object[] = [], progress: object[] = []
  let stage = 'secondary-start', revision: JournalGridResult['revision'] | undefined, complete = false
  const save = () => writeFile(info.outputPath('group-pair-cost.json'), JSON.stringify({
    fixture, pairCount, cases, primaryVariant, complete, stage, endpoints, progress, samples, pairs,
    conditions: ['Same owned database, unchanged facts/revision, separate saved/current Node processes; sequential requests only.',
      'Browser navigated to about:blank before pairs; authenticated APIRequestContext cookies remain available to both loopback ports.',
      'Two untimed full-summary warmups per process; nine unique case variants preserve SQL membership and force fresh summaries.',
      'Cold reads must return at least the entire fixture through weld_joints; identical warm repeats must not read that full set.',
      '650ms telemetry-flush waits, serialization and result assertions are outside HTTP timings. Both processes enable AUDIT_MEMORY only.',
      'pg client durations include transport/driver/event-loop work, not PostgreSQL executor time alone. RSS/heap samples have 500ms cadence.',
      'No forced GC, CPU profiler, schema/settings changes, production access or production-bundle edits.'],
  }, null, 2))
  const snapshot = async (endpoint: Endpoint) => {
    await delay(650)
    const value = JSON.parse(await readFile(endpoint.countsFile, 'utf8')) as Snapshot
    expect(value.resources?.reads).toBeDefined(); expect(value.resources?.samples.length).toBeGreaterThan(0)
    return value
  }
  const request = async (endpoint: Endpoint, data: JournalGridRequest) => {
    const body = await serializeRpcData(data)
    const started = performance.now()
    const response = await page.request.post(endpoint.rpc, { data: body,
      headers: { origin: endpoint.origin, referer: `${endpoint.origin}/journal`, 'sec-fetch-site': 'same-origin',
        'content-type': 'application/json', 'x-tsr-serverFn': 'true' }, timeout: 240_000 })
    const text = await response.text(), httpMilliseconds = performance.now() - started
    expect(response.ok()).toBe(true)
    const payload = await deserializeRpcResponse(text) as { result: JournalGridResult; error?: Error }
    if (payload.error) throw payload.error
    const result = payload.result
    expect(result.rows.reduce((sum, row) => sum + row.journalGroup!.recordCount, 0)).toBe(fixture.total)
    expect(result.rows.reduce((sum, row) => sum + row.journalGroup!.summary.joints, 0)).toBe(fixture.mixed ? fixture.total * 3 / 8 : fixture.total)
    expect(result.rows.reduce((sum, row) => sum + (row.journalGroup!.summary.wdi ?? 0), 0)).toBe(fixture.mixed ? fixture.total * 21 / 8 : fixture.total)
    if (revision === undefined) revision = result.revision
    else expect(result.revision).toBe(revision)
    return { result, httpMilliseconds, responseBytes: Buffer.byteLength(text) }
  }
  const caseRequest = (scope: string, name: string): JournalGridRequest => ({ report: 'weldingJournal',
    columnFilters: { projectTitle: '=' + scope }, start: 0, end: 1000,
    groupBy: name === 'project' ? ['projectTitle'] : name === 'lines' ? ['line'] : ['projectTitle', 'line'],
    route: name === 'nested' ? [fixture.project] : [] })
  try {
    await waitForListener(child, () => startError)
    const authenticated = await page.request.get(`${secondaryOrigin}/api/auth/get-session`, { timeout: 60_000 })
    expect(authenticated.ok()).toBe(true)
    const session = await authenticated.json() as { user?: { id?: string } }
    expect(typeof session.user?.id, 'The secondary server must accept the existing local fixture session').toBe('string')
    await page.waitForLoadState('networkidle')
    await page.goto('about:blank')
    for (const endpoint of endpoints) for (const [index, name] of ['project', 'lines'].entries()) {
      stage = `warmup:${endpoint.name}:${name}`
      await request(endpoint, caseRequest(caseVariant(fixture.project, 512 + index), name))
    }
    const scopes = Array.from({ length: pairCount }, (_, round) => caseVariant(fixture.project, round + 1))
    expect(new Set(scopes).size).toBe(pairCount)
    expect(scopes.every(scope => scope.toLowerCase() === fixture.project.toLowerCase())).toBe(true)
    for (let round = 0; round < pairCount; round++) for (const name of cases) {
      const data = caseRequest(scopes[round], name), outputs: JournalGridResult[] = []
      for (const endpoint of round % 2 ? [...endpoints].reverse() : endpoints) {
        stage = `${round}:${name}:${endpoint.name}:cold`
        progress.push({ stage, at: new Date().toISOString() }); await save()
        const before = await snapshot(endpoint), cold = await request(endpoint, data), after = await snapshot(endpoint)
        const coldDelta = delta(before, after)
        samples.push({ round, name, scope: scopes[round], variant: endpoint.name, temperature: 'cold',
          httpMilliseconds: cold.httpMilliseconds, responseBytes: cold.responseBytes, ...coldDelta })
        expect(coldDelta.reads.weld_joints?.rows ?? 0, `${stage}: summary cache must miss, not merely the group-page cache`).toBeGreaterThanOrEqual(fixture.total)
        expect(cold.result.rowCount).toBe(name === 'project' ? 1 : Math.ceil(fixture.total / 800))
        outputs.push(cold.result)
        stage = `${round}:${name}:${endpoint.name}:warm`
        const warm = await request(endpoint, data), warmAfter = await snapshot(endpoint), warmDelta = delta(after, warmAfter)
        samples.push({ round, name, scope: scopes[round], variant: endpoint.name, temperature: 'warm',
          httpMilliseconds: warm.httpMilliseconds, responseBytes: warm.responseBytes, ...warmDelta })
        expect(warm.result).toEqual(cold.result)
        expect(warmDelta.reads.weld_joints?.rows ?? 0, `${stage}: same-query warm read must reuse the summary`).toBeLessThan(fixture.total)
        await save()
      }
      expect(outputs[1], `${round}/${name}: complete current/baseline result`).toEqual(outputs[0])
      pairs.push({ round, name, scope: scopes[round], data, result: outputs[0], equivalent: true })
      console.log('DEEP_GROUP_PAIR', JSON.stringify({ round, name, equivalent: true, samples: samples.length }))
      await save()
    }
    complete = true; stage = 'complete'
  } finally {
    try { await save() } finally {
      try { await stopOwnedChild(child) } finally {
        log.end()
        if (child.exitCode !== null || child.signalCode !== null || !child.pid) await rm(temporary, { recursive: true, force: true })
      }
    }
  }
}
