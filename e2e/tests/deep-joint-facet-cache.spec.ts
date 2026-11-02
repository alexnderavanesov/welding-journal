import { expect, test, type Page, type Request } from '@playwright/test'
import { createHash } from 'node:crypto'
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { setupPopupFixture, cleanupPopupFixture, popupMarker, type PopupFact } from '../deep-popup-fixture'
import { deserializeRpcPayload, deserializeRpcResponse, rpcName, serializeRpcData } from '../rpc'
import type { JournalFilterPage, JournalFilterRequest } from '../../src/lib/journal-filter-options'
import type { JournalRevision } from '../../src/lib/journal-server-grid'

const enabled = process.env.DEEP_JOINT_FACET_CACHE === '1'
const cpuEnabled = process.env.DEEP_JOINT_FACET_CPU === '1'
if (cpuEnabled && !enabled) throw new Error('CPU diagnostics require the existing exact facet trace/replay profile')
test.skip(!enabled, 'Opt-in exact popup HTTP replay with bounded SQL shape/timing trace; not browser acceptance timing')
test.use({ trace: 'off', video: 'off' })
const fragment = 'F000'
const root = '[data-weld-report-grid="weldingJournal"]'
const names = { first: 'readJournalFilterPage_createServerFn_handler', match: 'readJournalFilterPage_createServerFn_handler',
  select: 'selectJournalFilterValues_createServerFn_handler' } as const
type Kind = keyof typeof names
type Selection = { revision: JournalRevision; values: string[] }
type Result = JournalFilterPage | Selection
type Captured = { endpoint: string; data: JournalFilterRequest; result: Result }
type SqlTrace = { sequence: number; operation: string; start: number; end?: number; milliseconds?: number;
  sqlShapeSha256: string; parameterShapeSha256: string; completion?: string; rows?: number | null; columns?: number | null; error?: unknown }
type RequestTrace = { id: string; rpc: string; start: number; end?: number; milliseconds?: number; completion?: string; status?: number; sql: SqlTrace[] }
type Trace = { version: string; label: string; requests: RequestTrace[]; statements: number }
type CpuMetadata = { version: string; label: string; status: string; captureValid?: boolean; stopCause?: string;
  clockMapping?: { valid: boolean; offsetBoundsMs: number[]; widthMs: number | null };
  profile?: { file: string; written: boolean; bytes: number; samples: number; timeDeltas: number } }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
let facts: PopupFact[] = [], setupStarted = false

test.beforeAll(async () => {
  if (!enabled) return
  test.setTimeout(600000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  expect(process.env.DEEP_POPUP_ROWS).toBe('200000')
  expect(process.env.DEEP_JOINT_FACET_LABEL).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/)
  expect(process.env.E2E_AUDIT_OUTPUT_DIR).toBeTruthy()
  expect(resolve(process.env.E2E_AUDIT_OUTPUT_DIR!)).not.toBe(resolve('.output'))
  if (cpuEnabled) {
    expect(resolve(process.env.E2E_AUDIT_OUTPUT_DIR!)).toBe(resolve('outputs/deep-optimization-2026-11-01/candidate-6-output'))
    expect(process.env.DEEP_JOINT_FACET_LABEL).toBe('joint-facet-cpu-candidate6-200000')
    expect(process.env.E2E_BASELINE_SCHEMA_TIME).toBeUndefined()
    expect(process.env.AUDIT_CPU_PROFILE).toBeUndefined(); expect(process.env.AUDIT_HEAP_PROFILE).toBeUndefined()
  }
  setupStarted = true
  facts = await setupPopupFixture()
})
test.afterAll(async () => {
  if (!setupStarted) return
  test.setTimeout(600000)
  await cleanupPopupFixture()
})

/** SQL intervals can overlap; their sum is not the SQL portion of HTTP wall time. */
function timingBreakdown(trace: RequestTrace) {
  expect(trace.completion).toBe('finish'); expect(trace.status).toBe(200)
  expect(trace.end).toBeGreaterThan(trace.start)
  expect(trace.sql.length, 'Existing access/freshness SQL must be observable for every target request').toBeGreaterThan(0)
  const intervals = trace.sql.map(sql => {
    expect(sql.error).toBeUndefined()
    expect(['promise', 'callback']).toContain(sql.completion)
    expect(sql.end).toBeGreaterThanOrEqual(sql.start)
    expect(sql.sqlShapeSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(sql.parameterShapeSha256).toMatch(/^[a-f0-9]{64}$/)
    return [Math.max(trace.start, sql.start), Math.min(trace.end!, sql.end!)] as const
  }).filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0])
  let covered = 0, through = trace.start, overlap = false
  for (const [start, end] of intervals) {
    if (start < through) overlap = true
    covered += Math.max(0, end - Math.max(start, through)); through = Math.max(through, end)
  }
  return { serverWallMs: trace.milliseconds, sqlSpanSumMs: trace.sql.reduce((sum, sql) => sum + sql.milliseconds!, 0),
    sqlIntervalUnionWithinHttpMs: covered, overlappingStatements: overlap,
    wallOutsideObservedSqlMs: trace.milliseconds! - covered,
    lateSqlCompletions: trace.sql.filter(sql => sql.end! > trace.end!).length }
}

async function capture(page: Page, kind: Kind, action: () => Promise<unknown>): Promise<Captured> {
  const matches = (request: Request) => rpcName(request.url()) === names[kind] && request.method() === 'POST'
  const [request] = await Promise.all([page.waitForRequest(matches, { timeout: 240000 }), action()])
  const response = await request.response()
  expect(response).not.toBeNull(); expect(response!.ok()).toBe(true)
  const payload = deserializeRpcPayload(request.postData()!) as { data: JournalFilterRequest }
  const reply = await deserializeRpcResponse(await response!.text()) as { result: Result; error?: unknown }
  expect(reply.error).toBeUndefined()
  const endpoint = new URL(request.url()); endpoint.search = ''
  expect(endpoint.origin).toBe('http://127.0.0.1:3100')
  return { endpoint: endpoint.toString(), data: payload.data, result: reply.result }
}

test('journal joint facets: exact popup requests across unchanged 15s/30s freshness windows', async ({ page }, info) => {
  test.setTimeout(900000)
  const traceFile = process.env.AUDIT_SQL_COUNTS_FILE?.replace(/counts\.json$/, 'joint-facet-trace.json')
  expect(traceFile).toBeTruthy()
  const ordered = facts.slice().sort((a, b) => a.joint.localeCompare(b.joint))
  const found = ordered.filter(row => row.joint.includes(fragment))
  const factDigest = hash(ordered), matchedIdsSha256 = hash(found.map(row => row.id)), matchedValuesSha256 = hash(found.map(row => row.joint))
  expect(ordered).toHaveLength(200000); expect(found).toHaveLength(9999)
  const base = { report: 'weldingJournal', fieldKey: 'joint', search: popupMarker, columnFilters: {} } as const
  const orders: Kind[][] = [['first', 'match', 'select'], ['match', 'select', 'first'], ['select', 'first', 'match']]
  const samples: object[] = [], captures: Partial<Record<Kind, Captured>> = {}, checks: object[] = []
  let phase = 'bootstrap', complete = false, failure: string | undefined, trace: Trace | undefined
  let cpuStartAttempted = false, cpuMetadata: CpuMetadata | undefined
  const save = () => writeFile(info.outputPath('joint-facet-cache.json'), JSON.stringify({
    version: 'joint-facet-http-sql-v1', label: process.env.DEEP_JOINT_FACET_LABEL,
    bundle: resolve(process.env.E2E_AUDIT_OUTPUT_DIR!), rows: ordered.length, factDigest,
    expected: { options: ordered.length, matched: found.length, firstPage: 150,
      matchedIdsSha256, matchedValuesSha256 },
    rounds: 3, orders, windows: ['expired: >=31s since preceding request completed', 'within-16s: >=16s since expired trio completed',
      'across-31s: >=31s since expired trio completed'],
    limits: ['Actual UI first-page/F000/Select Found requests captured before replay; exact request objects and revision are reused without approximating column scope.',
      'Only readJournalFilterPage/selectJournalFilterValues are measured over authenticated HTTP, after navigating away to stop browser polling. Not Safari/UI cadence or a reproduction of the complete popup matrix cache history.',
      'Three endpoint orders rotate which request enters an expired window first. No cache clearing, TTL/config changes, SQL rewrites, index DDL or data mutations after setup.',
      'Waits cross existing windows naturally, using observed elapsed times. Setup UI and checks are outside timings. Each saved bundle runs in its own fresh owned server/database.',
      'Explicit diagnostic wrapper adds shape hashing/trace writes. Do not merge these durations with the original acceptance pair.',
      'Client HTTP duration includes complete response bytes, excluding serialization setup and result parsing. Server wall and pg SQL spans use one server clock; overlapping SQL is reported as an interval union, not subtracted as a sum.',
      'Wall outside observed SQL includes pool acquisition, JS/serialization, scheduling and tracing; it is not a pure CPU measurement or proof of cache-hit status.',
      'Full responses equal within a run, including revision. Independent fixture values/counts/order/IDs anchor semantic equality across builds; revision tokens can differ across separately created databases.'],
    ...(cpuEnabled ? { cpu: { enabled: true, startAttempted: cpuStartAttempted, metadata: cpuMetadata,
      primaryWindows: ['facet-c0-expired-first', 'facet-c1-expired-match', 'facet-c2-expired-select'],
      limits: 'Inspector records the entire unchanged27-request replay after the first31s wait; across-31s trios can also recompute. Classify misses from actual200k-row SQL, not window names. Sampling/trace/control overhead affects timings; never substitute them for unprofiled acceptance. Raw CPU profile and raw command-clock bounds are saved separately; only unambiguous clock-mapped samples can be assigned to request intervals.' } } : {}),
    captures, checks, samples, trace, phase, complete, failure,
  }, null, 2))
  const cpuControl = async (action: 'start' | 'stop', cause?: 'completed' | 'test-finally') => {
    const origin = 'http://127.0.0.1:3100'
    const response = await page.request.post(`${origin}/__e2e/joint-facet-cpu/${action}`, { timeout: 30000,
      headers: { origin, 'sec-fetch-site': 'same-origin', 'x-e2e-facet-cpu-label': process.env.DEEP_JOINT_FACET_LABEL!,
        ...(cause ? { 'x-e2e-facet-cpu-stop-cause': cause } : {}) } })
    expect(response.ok(), `Inspector ${action} control must acknowledge completion`).toBe(true)
    return await response.json() as CpuMetadata
  }
  const validate = (kind: Kind, result: Result) => {
    if (kind === 'select') expect((result as Selection).values).toEqual(found.map(row => row.joint))
    else {
      const expected = kind === 'first' ? ordered : found, actual = result as JournalFilterPage
      expect(actual.total).toBe(expected.length); expect(actual.next).toBe(150)
      expect(actual.options).toEqual(expected.slice(0, 150).map(row => ({ value: row.joint, label: row.joint, count: 1 })))
    }
    expect(result.revision).toBeTruthy()
  }
  try {
    await save()
    await page.setViewportSize({ width: 1600, height: 1050 })
    await page.goto('/journal')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(popupMarker)
    await expect(page.locator(root).getByText('Найдено: 200000', { exact: true })).toBeVisible({ timeout: 240000 })
    await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
    const showAll = page.getByRole('dialog').getByRole('button', { name: 'Показать все', exact: true })
    if (await showAll.count()) await showAll.click()
    await page.getByRole('button', { name: 'Закрыть настройки вида', exact: true }).click()
    const header = page.locator(`${root} .ag-header-cell[col-id="joint"]`)
    await header.scrollIntoViewIfNeeded()
    captures.first = await capture(page, 'first', () => header.locator('.ag-header-cell-filter-button').click())
    validate('first', captures.first.result); expect(captures.first.data).toEqual(base)
    const input = page.getByRole('textbox', { name: 'Найти значение фильтра', exact: true })
    await expect(input).toBeFocused()
    captures.match = await capture(page, 'match', () => input.fill(fragment))
    validate('match', captures.match.result)
    expect(captures.match.data).toEqual({ ...base, match: fragment, start: 0, revision: captures.first.result.revision })
    await expect(page.locator('.journal-filter-values')).toHaveAttribute('aria-busy', 'false')
    await expect(page.locator('.journal-filter-option')).toHaveCount(150)
    captures.select = await capture(page, 'select', () => page.locator('.journal-filter').getByRole('button', { name: 'Выбрать найденные', exact: true }).click())
    validate('select', captures.select.result)
    expect(captures.select.data).toEqual({ ...base, match: fragment, revision: captures.first.result.revision })
    for (const kind of ['match', 'select'] as const) expect(captures[kind]!.result.revision).toBe(captures.first.result.revision)
    await expect(page.locator(root).getByText('Найдено: 9999', { exact: true })).toBeVisible({ timeout: 240000 })
    await expect(page.locator(`${root} .journal-grid-frame`)).toHaveAttribute('aria-busy', 'false')
    await expect(page.locator(`${root} .journal-grid-frame`)).not.toHaveAttribute('data-journal-updating', '')
    const visibleIds = await page.locator(`${root} .ag-row[row-id]:not(.ag-row-group):not(.ag-row-loading):not(.ag-opacity-zero)`)
      .evaluateAll(elements => [...new Set(elements.map(element => Number(element.getAttribute('row-id'))))])
    expect(visibleIds.length).toBeGreaterThan(0)
    const expectedIds = new Set(found.map(row => row.id))
    for (const id of visibleIds) expect(expectedIds.has(id)).toBe(true)
    checks.push({ kind: 'untimed-UI-select-found', count: found.length, visibleIds })
    await page.waitForLoadState('networkidle')
    await page.goto('about:blank')
    let lastCompleted = performance.now()
    const equivalence = new Map<Kind, string>(Object.entries(captures).map(([kind, captured]): [Kind, string] => [kind as Kind, hash(captured!.result)]))
    const perform = async (cycle: number, window: string, kind: Kind, anchor: number) => {
      const source = captures[kind]!, id = `facet-c${cycle}-${window}-${kind}`
      phase = id; console.log('DEEP_JOINT_FACET_PHASE', id); await save()
      const body = await serializeRpcData(source.data)
      const started = performance.now(), response = await page.request.post(source.endpoint, { data: body, timeout: 240000,
        headers: { origin: new URL(source.endpoint).origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
          'x-tsr-serverFn': 'true', 'x-e2e-facet-trace-id': id } })
      const bytes = await response.body(), ended = performance.now()
      expect(response.ok()).toBe(true)
      const parsed = await deserializeRpcResponse(bytes.toString('utf8')) as { result: Result; error?: unknown }
      expect(parsed.error).toBeUndefined(); validate(kind, parsed.result)
      const resultSha256 = hash(parsed.result)
      expect(resultSha256).toBe(equivalence.get(kind))
      await expect.poll(async () => {
        trace = JSON.parse(await readFile(traceFile!, 'utf8')) as Trace
        return trace.requests.find(entry => entry.id === id)?.completion
      }, { timeout: 5000 }).toBe('finish')
      const server = trace!.requests.find(entry => entry.id === id)!
      expect(server.rpc).toBe(new URL(source.endpoint).pathname.split('/').at(-1))
      samples.push({ id, cycle, window, kind, milliseconds: ended - started, sinceWindowAnchorMs: started - anchor,
        sincePreviousResponseMs: started - lastCompleted, responseBytes: bytes.length, requestSha256: hash(source.data), resultSha256,
        ...timingBreakdown(server), sqlStatements: server.sql.length })
      checks.push({ id, kind, resultSha256, expectedCount: kind === 'first' ? ordered.length : found.length })
      lastCompleted = ended
      await save()
    }
    for (let cycle = 0; cycle < 3; cycle++) {
      phase = `cycle-${cycle}:wait-for-expired`; await save()
      await delay(Math.max(0, lastCompleted + 31000 - performance.now()))
      if (cpuEnabled && cycle === 0) {
        cpuStartAttempted = true
        cpuMetadata = await cpuControl('start')
        expect(cpuMetadata.status).toBe('running')
        expect(cpuMetadata.label).toBe(process.env.DEEP_JOINT_FACET_LABEL)
      }
      const beforeExpired = lastCompleted
      for (const kind of orders[cycle]) await perform(cycle, 'expired', kind, beforeExpired)
      const windowAnchor = lastCompleted
      for (const [window, milliseconds] of [['within-16s', 16000], ['across-31s', 31000]] as const) {
        phase = `cycle-${cycle}:wait-${window}`; await save()
        await delay(Math.max(0, windowAnchor + milliseconds - performance.now()))
        for (const kind of orders[cycle]) await perform(cycle, window, kind, windowAnchor)
      }
    }
    expect(samples).toHaveLength(27)
    expect(trace!.requests).toHaveLength(27)
    expect(trace!.requests.every(entry => entry.completion === 'finish')).toBe(true)
    expect(trace!.label).toBe(process.env.DEEP_JOINT_FACET_LABEL)
    phase = 'complete'; complete = true
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    let cpuFailure: unknown
    if (cpuEnabled) {
      if (cpuStartAttempted) try { await cpuControl('stop', complete ? 'completed' : 'test-finally') } catch (error) { cpuFailure = error }
      try {
        const metadataFile = traceFile!.replace(/joint-facet-trace\.json$/, 'joint-facet-cpu.json')
        cpuMetadata = JSON.parse(await readFile(metadataFile, 'utf8')) as CpuMetadata
        await copyFile(metadataFile, info.outputPath('joint-facet-cpu.json'))
        if (cpuMetadata.profile?.written) {
          expect(cpuMetadata.profile.file).toBe('joint-facet.cpuprofile')
          const profileFile = traceFile!.replace(/joint-facet-trace\.json$/, cpuMetadata.profile.file)
          const size = (await stat(profileFile)).size
          expect(size).toBe(cpuMetadata.profile.bytes); expect(size).toBeLessThanOrEqual(32 * 1024 * 1024)
          await copyFile(profileFile, info.outputPath('joint-facet.cpuprofile'))
        }
        if (!failure && !cpuFailure) {
          expect(cpuMetadata.captureValid).toBe(true)
          expect(cpuMetadata.stopCause).toBe('completed')
          expect(cpuMetadata.profile?.written).toBe(true)
          expect(cpuMetadata.clockMapping?.valid, 'Preserve raw clocks/profile if exact request-window attribution is unavailable').toBe(true)
        }
      } catch (error) { cpuFailure ??= error }
      if (cpuFailure && !failure) {
        complete = false
        failure = cpuFailure instanceof Error ? cpuFailure.message : String(cpuFailure)
      }
    }
    if (traceFile) try { trace = JSON.parse(await readFile(traceFile, 'utf8')) as Trace } catch { /* Preserve the primary failure. */ }
    await save()
    if (cpuFailure && !complete) {
      // Do not overwrite a replay/oracle exception already in flight.
      if (phase === 'complete') throw cpuFailure
    }
  }
})
