import { devices, expect, test, type Request } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { auditSqlCount, auditSqlDetails } from '../audit-sql'
import { chromePopupBrowser, type PopupBrowser, type PopupProbeTarget } from '../deep-popup-browser'
import { cleanupPopupFixture, setupPopupFixture, type PopupFact } from '../deep-popup-fixture'
import { runPopupScenarios } from '../deep-popup-scenarios'
import { observeMixedClient } from '../mixed-resource-telemetry'
import { rpcName } from '../rpc'

const enabled = process.env.DEEP_POPUP_RPC_ACCOUNTING === '1'
test.skip(!enabled, 'Opt-in whole-flow RPC/SQL accounting on the unchanged Chrome popup workflow')
test.use({ trace: 'off', video: 'off' })
let facts: PopupFact[] = []

test.beforeAll(async () => {
  if (!enabled) return
  test.setTimeout(180_000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  expect(process.env.DEEP_POPUP_ROWS).toBe('9000')
  expect(process.env.DEEP_POPUP_ROUNDS).toBe('1')
  expect(process.env.DEEP_POPUP_REPORTS).toBe('lnk,psto')
  // The existing validator requires a positive value. Its representative loop
  // only runs for journal: this exact subset executes zero repeated cases.
  expect(process.env.DEEP_POPUP_REPEAT_ROUNDS).toBe('1')
  expect(process.env.DEEP_POPUP_LABEL).toBeTruthy()
  const file = process.env.AUDIT_SQL_COUNTS_FILE ?? ''
  expect(basename(file)).toBe('counts.json')
  expect(dirname(file).startsWith(join(tmpdir(), 'welding-e2e-sql-'))).toBe(true)
  facts = await setupPopupFixture()
})
test.afterAll(async () => {
  if (!enabled) return
  test.setTimeout(180_000)
  await cleanupPopupFixture()
})

type Counters = { statements: number; rpcStatements: Record<string, number> }
async function counters(): Promise<Counters> {
  const value = await auditSqlDetails() as (Counters & { dispatcherCalculations: unknown[] }) | undefined
  expect(value).toBeDefined()
  expect(Number.isSafeInteger(value!.statements) && value!.statements >= 0).toBe(true)
  expect(value!.rpcStatements).toBeDefined()
  return { statements: value!.statements, rpcStatements: { ...value!.rpcStatements } }
}
type Rpc = {
  id: number; name: string; path: string; method: string
  startedNodeMs: number; endedNodeMs?: number; startedWindow: number | null; endedWindow?: number | null
  state: 'pending' | 'finished' | 'failed'; status?: number; failure?: string | null
  transportTiming?: ReturnType<Request['timing']>
}
type PhaseWindow = {
  index: number; target: Pick<PopupProbeTarget, 'kind' | 'event' | 'count'>
  installedNodeMs: number; collectedNodeMs?: number; phase?: string
  browserUiReadyMs?: number
  resources?: Array<{ name: string; start: number; end: number; bytes: number; startedAfterUiReady: boolean; endedAfterUiReady: boolean }>
}

test('whole-flow popup accounting distinguishes started, cancelled and late-completed reads from UI-ready samples', async ({ browser, browserName }, info) => {
  expect(browserName).toBe('chromium')
  test.setTimeout(600_000)
  const origin = new URL(String(info.project.use.baseURL))
  expect(origin.origin).toBe('http://127.0.0.1:3100')
  const context = await browser.newContext({ ...devices['Desktop Chrome'], baseURL: origin.origin, storageState: process.env.E2E_AUTH_STATE,
    ...(process.env.E2E_DEVICE_SCALE_FACTOR ? { deviceScaleFactor: Number(process.env.E2E_DEVICE_SCALE_FACTOR) } : {}),
    viewport: { width: 1600, height: 1050 } })
  // The shared observer records exact allowed read cancellations and separately
  // retains reads Chromium abandons at navigation without a terminal event.
  const telemetry = observeMixedClient(context, 'popup-rpc-accounting')
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  const started = performance.now(), clock = () => performance.now() - started
  const records = new Map<Request, Rpc>(), windows: PhaseWindow[] = [], consoleErrors: string[] = []
  let activeWindow: number | null = null, before: Counters | undefined, after: Counters | undefined
  let workflowEndedNodeMs: number | undefined, drainedNodeMs: number | undefined, complete = false
  let sqlBeforeReadNodeMs: number | undefined, sqlAfterReadNodeMs: number | undefined
  let pendingAtWorkflowEnd: number[] = [], failure: string | undefined
  const diagnostics: string[] = []
  const onRequest = (request: Request) => {
    if (!request.url().startsWith(origin.origin + '/_serverFn/')) return
    records.set(request, { id: records.size + 1, name: rpcName(request.url()), path: new URL(request.url()).pathname,
      method: request.method(), startedNodeMs: clock(), startedWindow: activeWindow, state: 'pending' })
  }
  const onFinished = (request: Request) => {
    const row = records.get(request)
    if (row) Object.assign(row, { state: 'finished', endedNodeMs: clock(), endedWindow: activeWindow, transportTiming: request.timing() })
  }
  const onFailed = (request: Request) => {
    const row = records.get(request)
    if (row) Object.assign(row, { state: 'failed', endedNodeMs: clock(), endedWindow: activeWindow,
      failure: request.failure()?.errorText ?? null, transportTiming: request.timing() })
  }
  page.on('request', onRequest)
  page.on('requestfinished', onFinished)
  page.on('requestfailed', onFailed)
  page.on('response', response => { const row = records.get(response.request()); if (row) row.status = response.status() })
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  const base = chromePopupBrowser(page)
  const observed: PopupBrowser = { ...base, execute: async (script, ...args) => {
    const target = args[0] as Partial<PopupProbeTarget> | undefined
    if (target && typeof target.root === 'string' && target.kind && target.event && script.includes('deepPopupProbe')) {
      activeWindow = windows.length
      windows.push({ index: activeWindow, installedNodeMs: clock(), target: { kind: target.kind, event: target.event, count: target.count } })
    }
    // Execute the exact existing script once. No added browser calls, fetch
    // interception, response-body parsing or changes to readiness predicates.
    const result = await base.execute(script, ...args)
    if (activeWindow !== null && typeof result?.milliseconds === 'number' && Array.isArray(result.resources)) {
      const window = windows[activeWindow]
      window.collectedNodeMs = clock(); window.browserUiReadyMs = result.milliseconds
      window.resources = result.resources.filter((row: { url: string }) => row.url.includes('/_serverFn/'))
        .map((row: { url: string; start: number; end: number; bytes: number }) => ({ name: rpcName(row.url),
          start: row.start, end: row.end, bytes: row.bytes,
          startedAfterUiReady: row.start > result.milliseconds, endedAfterUiReady: row.end > result.milliseconds }))
      activeWindow = null
    }
    return result
  } }
  try {
    // Match the final flush before any browser navigation: startup/readiness
    // SQL must not enter the delta merely because its telemetry arrived late.
    await auditSqlCount()
    before = await counters()
    sqlBeforeReadNodeMs = clock()
    await runPopupScenarios(observed, facts, info)
    workflowEndedNodeMs = clock()
    pendingAtWorkflowEnd = [...records.values()].filter(row => row.state === 'pending').map(row => row.id)
    // No drain between actions: retain the original navigation/regroup/cancel
    // timing. This single final quiet interval is outside every popup timing.
    let seen = -1, quietSince = performance.now()
    await expect.poll(() => {
      if (telemetry.pending.size || telemetry.rpcStarted !== seen) {
        seen = telemetry.rpcStarted; quietSince = performance.now(); return false
      }
      return performance.now() - quietSince >= 500
    }, { timeout: 30_000, intervals: [50], message: 'Whole popup workflow has no live/new RPC for 500ms' }).toBe(true)
    drainedNodeMs = clock()
    await telemetry.summary()
    await auditSqlCount() // Existing 650ms telemetry flush, outside action timings.
    after = await counters()
    sqlAfterReadNodeMs = clock()
    expect(telemetry.pending.size, 'No live RPC after the final telemetry flush').toBe(0)
    expect(after.statements).toBeGreaterThan(before.statements)
    for (const [id, value] of Object.entries(before.rpcStatements)) expect(after.rpcStatements[id] ?? 0).toBeGreaterThanOrEqual(value)
    const scenario = JSON.parse(await readFile(info.outputPath('priority-popup-chrome.json'), 'utf8'))
    expect(scenario.selectedReports).toEqual(['lnk', 'psto'])
    expect(scenario.rounds).toBe(1); expect(scenario.representative.rounds).toBe(0)
    expect(scenario.samples).toHaveLength(windows.length)
    scenario.samples.forEach((sample: { phase: string; milliseconds: number }, index: number) => {
      windows[index].phase = sample.phase
      expect(windows[index].browserUiReadyMs).toBe(sample.milliseconds)
    })
    expect(windows.filter(window => window.phase?.endsWith(':open'))).toHaveLength(14)
    expect(records.size).toBe(telemetry.rpcStarted)
    const range = [...records.values()].filter(row => row.name.startsWith('summarizeJournalGridRange_'))
    expect(range.length, 'The diagnostic must exercise the reported range RPC').toBeGreaterThan(0)
    const rangeId = range[0].path.split('/').at(-1)!
    expect((after.rpcStatements[rangeId] ?? 0) - (before.rpcStatements[rangeId] ?? 0), 'Range reads must reach the audited server').toBeGreaterThan(0)
    expect(telemetry.errors).toEqual([])
    for (const cancelled of telemetry.expectedFailures) expect(cancelled).toMatch(
      /^(?:readJournalGrid|getJournalReportSummary|getDispatcherTaskContext|readReportOutputSnapshot|summarizeJournalGridArea|summarizeJournalGridRange|summarizeJournalGridSelection)(?:_[^:]*)?: net::ERR_ABORTED$/,
    )
    complete = true
  } catch (error) {
    failure = error instanceof Error ? error.stack : String(error)
    throw error
  } finally {
    // Preserve partial evidence on failure. Never navigate/abort to manufacture
    // an empty pending set; retain every missing terminal browser event.
    if (!after) after = await counters().catch(error => { diagnostics.push(String(error)); return undefined })
    const summary = await telemetry.summary().catch(error => { diagnostics.push(String(error)); return undefined })
    const rows = [...records].map(([request, row]) => ({ ...row,
      unresolvedAfterNavigation: row.state === 'pending' && !telemetry.pending.has(request) }))
    const rpcKeys = [...new Set([...Object.keys(before?.rpcStatements ?? {}), ...Object.keys(after?.rpcStatements ?? {})])].sort()
    const sql = before && after ? { before, after, statementDelta: after.statements - before.statements,
      perRpc: rpcKeys.map(key => ({ id: key, name: rpcName(origin.origin + '/_serverFn/' + key),
        before: before!.rpcStatements[key] ?? 0, after: after!.rpcStatements[key] ?? 0,
        delta: (after!.rpcStatements[key] ?? 0) - (before!.rpcStatements[key] ?? 0) })) } : undefined
    try {
      await writeFile(info.outputPath('popup-rpc-accounting.json'), JSON.stringify({
        protocol: 'popup-wholeflow-rpc-accounting-v1', complete, failure, diagnostics,
        label: process.env.DEEP_POPUP_LABEL, bundle: process.env.E2E_AUDIT_OUTPUT_DIR,
        rows: 9000, reports: ['lnk', 'psto'], matrixRounds: 1, representativeRounds: 0,
        countsFile: process.env.AUDIT_SQL_COUNTS_FILE, scenarioArtifact: 'priority-popup-chrome.json',
        clocks: { node: 'All *NodeMs relative to this observer start; phase windows bracket existing probe calls, not exact action events.',
          browser: 'browserUiReadyMs and resources.start/end are browser performance.now deltas from that phase trigger. Compare only within a phase.',
          transport: 'Playwright request.timing is retained separately; startTime is epoch milliseconds and remaining fields are relative to it. No cross-clock subtraction.' },
        limits: 'Whole-flow started/finished/failed include initialization, actions, gaps and final drain. SQL counts submissions, not row work or CPU. Raw missing terminal events stay pending/unresolved-after-navigation; they are not claimed to be confirmed aborts. Console error messages are retained verbatim, including the installed AG Grid license banner; runtime exceptions, HTTP errors and unexpected network failures fail the test.',
        workflowEndedNodeMs, drainedNodeMs, sqlBeforeReadNodeMs, sqlAfterReadNodeMs, pendingAtWorkflowEnd,
        pendingAtCapture: rows.filter(row => row.state === 'pending').map(row => row.id),
        wholeFlow: summary, requests: rows, phaseWindows: windows, consoleErrors, sql,
      }, null, 2))
    } finally {
      page.off('request', onRequest); page.off('requestfinished', onFinished); page.off('requestfailed', onFailed)
      await context.close()
    }
  }
})
