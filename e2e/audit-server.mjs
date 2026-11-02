// Opt-in instrumentation of the unchanged production bundle. Normal runs log
// counts only. Explicit isolated group/wide-date fixture diagnostics below
// additionally capture their narrowly matched SQL and parameters. The separate
// joint-facet trace records timing/shape hashes only, never SQL or bind values.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { writeFileSync, renameSync, readFileSync } from 'node:fs'
import { getHeapStatistics } from 'node:v8'
import { Session } from 'node:inspector'
import { channel } from 'node:diagnostics_channel'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const resourceContainer = process.env.AUDIT_RESOURCE_CONTAINER === '1'
assert.equal(process.env.DATABASE_URL, `postgresql://welding:welding@${resourceContainer ? 'host.docker.internal' : '127.0.0.1'}:5432/welding_tracker_e2e`)
assert.equal(process.env.PORT, resourceContainer ? '3000' : '3100')
assert.equal(process.env.E2E_USE_PRODUCTION_BUILD, '1')
// Saved comparison bundles live outside Vite's mutable .output directory.
// This changes only the local audit runner and keeps the dev server usable.
const root = resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output', 'server')
const candidates = (await readdir(join(root, '_ssr'))).filter(name => /^db-.*\.mjs$/.test(name))
const sources = await Promise.all(candidates.map(name => readFile(join(root, '_ssr', name), 'utf8')))
const implementations = sources.filter(source => source.includes('async function createDatabase()'))
assert.equal(implementations.length, 1, 'Expected one database implementation, excluding re-export facades')
const source = implementations[0]
const imports = source.match(/\[drizzleModule, pgModule,[\s\S]*?Promise\.all\(\[([\s\S]*?)\]\)/)?.[1]
const pgPath = [...(imports ?? '').matchAll(/import\("([^"]+)"\)/g)][1]?.[1]
assert.match(pgPath ?? '', /^\.\.\/_libs\/[\w.-]+\.mjs$/)
const pg = (await import(pathToFileURL(resolve(root, '_ssr', pgPath)).href)).default
assert.equal(typeof pg.Client.prototype.query, 'function')
const file = process.env.AUDIT_SQL_COUNTS_FILE
assert(resourceContainer ? file === '/audit-counts/counts.json'
  : file?.startsWith(join(tmpdir(), 'welding-e2e-sql-')) && file.endsWith('/counts.json'))
const counts = { statements: 0, operations: {}, rpcStatements: {} }
const jointFacetTrace = process.env.DEEP_JOINT_FACET_CACHE === '1'
const foundRecheck = process.env.DEEP_POPUP_FOUND_RECHECK === '1'
if (foundRecheck) {
  assert.equal(jointFacetTrace, true)
  assert.equal(process.env.DEEP_PRIORITY_POPUP, '1')
  assert.equal(process.env.DEEP_POPUP_REPORTS, 'journal')
}
let facetTrace, facetScope, facetRpcIds
const flushFacetTrace = () => {
  if (!jointFacetTrace) return
  const target = file.replace(/counts\.json$/, 'joint-facet-trace.json')
  writeFileSync(target + '.tmp', JSON.stringify(facetTrace))
  renameSync(target + '.tmp', target)
}
if (jointFacetTrace) {
  assert.equal(resourceContainer, false)
  assert.equal(process.env.DEEP_POPUP_ROWS, '200000')
  assert.notEqual(process.env.DEEP_FILTER_HTTP_GROUP_REPRO, '1')
  assert.notEqual(process.env.DEEP_WIDE_DATE_CHOICE, '1')
  assert.match(process.env.DEEP_JOINT_FACET_LABEL ?? '', /^[a-z0-9][a-z0-9-]{0,63}$/)
  assert(process.env.E2E_AUDIT_OUTPUT_DIR && resolve(process.env.E2E_AUDIT_OUTPUT_DIR) !== resolve('.output'))
  const manifests = (await readdir(root)).filter(name => name.includes('tanstack-start-server-fn-resolver') && name.endsWith('.mjs'))
  assert.equal(manifests.length, 1)
  const manifest = await readFile(join(root, manifests[0]), 'utf8')
  const names = new Set(['readJournalFilterPage_createServerFn_handler', 'selectJournalFilterValues_createServerFn_handler'])
  facetRpcIds = new Set([...manifest.matchAll(/"([a-f0-9]{64})":\s*\{\s*functionName:\s*"([^"\n]+)"/g)]
    .filter(match => names.has(match[2])).map(match => match[1]))
  assert.equal(facetRpcIds.size, 2)
  facetScope = new AsyncLocalStorage()
  facetTrace = { version: 'joint-facet-http-sql-v1', label: process.env.DEEP_JOINT_FACET_LABEL,
    clock: 'performance.now milliseconds in this server process', requests: [], statements: 0 }
}
let facetCpuControl
if (process.env.DEEP_JOINT_FACET_CPU === '1') {
  assert.equal(jointFacetTrace, true)
  assert.equal(process.env.AUDIT_SQL_COUNTS, '1')
  assert.equal(resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? ''), resolve('outputs/deep-optimization-2026-11-01/candidate-6-output'))
  assert.equal(process.env.DEEP_JOINT_FACET_LABEL, 'joint-facet-cpu-candidate6-200000')
  assert.equal(process.env.E2E_BASELINE_SCHEMA_TIME, undefined)
  assert.notEqual(process.env.E2E_DEEP_JOINT_CHOICE_BASELINE, '1')
  assert(!process.env.AUDIT_CPU_PROFILE && !process.env.AUDIT_HEAP_PROFILE, 'Disable other audit profilers')
  assert(![...process.execArgv, process.env.NODE_OPTIONS ?? ''].some(value => /--(?:cpu-prof|heap-prof|prof)(?:\s|=|$)/.test(value)), 'Disable CLI profilers')
  const { createJointFacetCpuControl } = await import('./joint-facet-cpu.mjs')
  facetCpuControl = await createJointFacetCpuControl({ countsFile: file, label: process.env.DEEP_JOINT_FACET_LABEL })
}
// Keep endpoint budgets independent of other browser tabs and background RPCs.
// Store only the generated RPC identifier and submission count, never payloads.
const rpcScope = new AsyncLocalStorage()
const emit = Server.prototype.emit
Server.prototype.emit = function (event, ...args) {
  if (facetCpuControl && event === 'request' && facetCpuControl(args[0], args[1])) return true
  const rpc = event === 'request' && /^\/_serverFn\/([\w-]+)(?:\?|$)/.exec(args[0]?.url ?? '')?.[1]
  if (jointFacetTrace && rpc && facetRpcIds.has(rpc) && (foundRecheck || args[0]?.headers['x-e2e-facet-trace-id'] !== undefined)) {
    const id = foundRecheck ? `recheck-${facetTrace.requests.length}` : args[0].headers['x-e2e-facet-trace-id']
    assert.match(id, foundRecheck ? /^recheck-\d+$/ : /^facet-c[0-2]-(?:expired|within-16s|across-31s)-(?:first|match|select)$/)
    assert(facetTrace.requests.length < 128 && !facetTrace.requests.some(entry => entry.id === id))
    const entry = { id, rpc, start: performance.now(), sql: [] }
    facetTrace.requests.push(entry)
    const response = args[1]
    let completed = false
    const end = completion => {
      if (completed) return
      completed = true
      entry.end = performance.now(); entry.milliseconds = entry.end - entry.start
      entry.completion = completion; entry.status = response.statusCode
      flushFacetTrace()
    }
    response.once('finish', () => end('finish'))
    response.once('close', () => end('close'))
    return rpcScope.run(rpc, () => facetScope.run(entry, () => emit.call(this, event, ...args)))
  }
  return rpc ? rpcScope.run(rpc, () => emit.call(this, event, ...args)) : emit.call(this, event, ...args)
}
const dispatcherCalculations = []
// Explicit local diagnostic run only; the normal timing run has no profiler.
// Capture through the first substantial calculation, excluding later idle time.
if (process.env.AUDIT_CPU_PROFILE === '1') {
  const profiler = new Session()
  profiler.connect()
  const post = (method) => new Promise((resolve, reject) => profiler.post(method, (error, value) => error ? reject(error) : resolve(value)))
  await post('Profiler.enable')
  await post('Profiler.start')
  const finish = async metrics => {
    if (metrics.milliseconds < 1_000) return
    channel('welding.dispatcher.full-calculation').unsubscribe(finish)
    try {
      const { profile } = await post('Profiler.stop')
      writeFileSync(file.replace(/counts\.json$/, 'dispatcher.cpuprofile'), JSON.stringify(profile))
    } finally { profiler.disconnect() }
  }
  channel('welding.dispatcher.full-calculation').subscribe(finish)
}
channel('welding.dispatcher.full-calculation').subscribe(metrics => {
  dispatcherCalculations.push(metrics)
  if (dispatcherCalculations.length > 20) dispatcherCalculations.shift()
})
const resources = resourceContainer || process.env.AUDIT_MEMORY === '1' ? { heapLimitBytes: getHeapStatistics().heap_size_limit,
  node: process.version, rssPeakBytes: 0, heapUsedPeakBytes: 0, cgroup: {}, samples: [], reads: {} } : undefined
// Diagnostic only: sample allocation stacks without a full, stop-the-world heap
// snapshot. Acceptance runs leave this off and keep the original resource cap.
if (resources && ['1', 'peak'].includes(process.env.AUDIT_HEAP_PROFILE)) {
  const session = new Session()
  session.connect()
  const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)))
  await post('HeapProfiler.startSampling', { samplingInterval: 1024 * 1024 })
  let pending = false, peakCaptured = false
  setInterval(async () => {
    if (pending) return
    if (process.env.AUDIT_HEAP_PROFILE === 'peak') {
      if (peakCaptured || process.memoryUsage().heapUsed < 600 * 1024 ** 2) return
      peakCaptured = true
    }
    pending = true
    try {
      const { profile } = await post('HeapProfiler.getSamplingProfile')
      const allocations = new Map()
      function visit(node, parent = '') {
        const frame = node.callFrame
        const name = `${frame.functionName || '(anonymous)'} @ ${frame.url.split('/').at(-1)}:${frame.lineNumber + 1}`
        const stack = `${parent} > ${name}`.split(' > ').slice(-6).join(' > ')
        if (node.selfSize) allocations.set(stack, (allocations.get(stack) ?? 0) + node.selfSize)
        for (const child of node.children) visit(child, stack)
      }
      visit(profile.head)
      resources.allocations = [...allocations].sort((a, b) => b[1] - a[1]).slice(0, 30)
      resources.allocationUptime = Math.round(process.uptime())
      const total = [...allocations.values()].reduce((sum, bytes) => sum + bytes, 0)
      if (total > (resources.peakAllocationBytes ?? 0)) {
        resources.peakAllocationBytes = total
        resources.peakAllocationStacks = resources.allocations
        resources.peakAllocationUptime = resources.allocationUptime
      }
    } catch (error) { resources.profileError = error.message }
    finally { pending = false }
  }, 1000).unref()
}
const original = pg.Client.prototype.query
// Enabled only for the explicitly labelled synthetic HTTP requests above.
// Keep the original pg promise/return value and callback receiver/arguments.
function traceFacetQuery(client, args, sqlText, operation, request) {
  assert(++facetTrace.statements <= 2048, 'Joint-facet diagnostic statement bound exceeded')
  const shape = value => value === null ? 'null' : value === undefined ? 'undefined'
    : typeof value === 'string' ? { type: 'string', length: value.length }
    : Array.isArray(value) ? { type: 'array', length: value.length, items: value.map(shape) }
    : value instanceof Date ? 'date' : Buffer.isBuffer(value) ? { type: 'buffer', length: value.length }
    : typeof value
  const parameters = Array.isArray(args[1]) ? args[1] : args[0]?.values ?? []
  const hash = value => createHash('sha256').update(value).digest('hex')
  const entry = { sequence: facetTrace.statements, operation, start: performance.now(),
    sqlShapeSha256: hash(sqlText ?? ''), parameterShapeSha256: hash(JSON.stringify(parameters.map(shape))) }
  request.sql.push(entry)
  let completed = false
  const end = (error, reply, completion) => {
    if (completed) return
    completed = true
    entry.end = performance.now(); entry.milliseconds = entry.end - entry.start; entry.completion = completion
    if (error) entry.error = { kind: 'query-error', ...(typeof error.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? { sqlState: error.code } : {}) }
    else if (reply) { entry.rows = reply.rowCount ?? null; entry.columns = reply.fields?.length ?? null }
    if (request.end !== undefined) flushFacetTrace()
  }
  const callback = typeof args.at(-1) === 'function' ? args.at(-1) : undefined
  const forwarded = callback ? [...args.slice(0, -1), function (...values) {
    end(values[0], values[1], 'callback')
    return callback.apply(this, values)
  }] : args
  try {
    const result = original.apply(client, forwarded)
    if (!callback && typeof result?.then === 'function') result.then(reply => end(undefined, reply, 'promise'), error => end(error, undefined, 'promise'))
    else if (!callback) end(undefined, undefined, 'unobserved-query-contract')
    return result
  } catch (error) { end(error, undefined, 'synchronous-throw'); throw error }
}
// Explicit synthetic-fixture diagnostic only. Capture the actual large group
// read and its non-executing plan before it can stall; never enable this during
// acceptance timings or against any database outside the runner guard above.
const groupRepro = process.env.DEEP_FILTER_HTTP_GROUP_REPRO === '1'
if (groupRepro) {
  assert.equal(resourceContainer, false)
  assert.equal(process.env.DEEP_FILTER_HTTP, '1')
  assert.equal(process.env.PORT, '3100')
}
const wideDate = process.env.DEEP_WIDE_DATE_CHOICE === '1'
if (wideDate) {
  assert.equal(resourceContainer, false)
  assert.equal(process.env.PORT, '3100')
  assert.equal(process.env.DEEP_POPUP_ROWS, '200000')
  assert.equal(groupRepro, false)
}
let wideDateSequence = 0
async function captureWideDateLeaf(client, args, sqlText, rpc) {
  assert(!args.some(value => typeof value === 'function'), 'Wide-date capture requires a promise query')
  const parameters = Array.isArray(args[1]) ? args[1] : args[0]?.values ?? []
  const record = { sequence: ++wideDateSequence, backendPid: client.processID, rpc,
    capturedAt: new Date().toISOString(), sql: sqlText, parameters, startedAt: new Date().toISOString() }
  const diagnosticFile = file.replace(/counts\.json$/, 'wide-date-leaf.json')
  const save = () => {
    writeFileSync(diagnosticFile + '.tmp', JSON.stringify(record))
    renameSync(diagnosticFile + '.tmp', diagnosticFile)
  }
  save()
  try {
    // No EXPLAIN, query rewrite or settings changes on the HTTP path.
    const result = await original.apply(client, args)
    record.completedAt = new Date().toISOString()
    record.rows = result.rowCount
    save()
    return result
  } catch (error) {
    record.queryError = error.message
    save()
    throw error
  }
}
let groupReproSequence = 0
async function explainGroupRepro(client, args, sqlText) {
  assert(!args.some(value => typeof value === 'function'), 'Group repro requires a promise query')
  const parameters = Array.isArray(args[1]) ? args[1] : args[0]?.values ?? []
  const record = { sequence: ++groupReproSequence, backendPid: client.processID,
    capturedAt: new Date().toISOString(), sql: sqlText, parameters }
  const diagnosticFile = file.replace(/counts\.json$/, 'group-repro-member.json')
  const save = () => {
    writeFileSync(diagnosticFile + '.tmp', JSON.stringify(record))
    renameSync(diagnosticFile + '.tmp', diagnosticFile)
  }
  save()
  try {
    const plan = await original.call(client, { text: 'EXPLAIN (FORMAT JSON) ' + sqlText, values: parameters })
    record.plan = plan.rows
  } catch (error) {
    record.planError = error.message
    save()
    throw error
  }
  record.startedAt = new Date().toISOString()
  save()
  try {
    const result = await original.apply(client, args)
    record.completedAt = new Date().toISOString()
    record.rows = result.rowCount
    save()
    return result
  } catch (error) {
    record.queryError = error.message
    save()
    throw error
  }
}
pg.Client.prototype.query = function (...args) {
  counts.statements++
  const rpc = rpcScope.getStore()
  if (rpc) counts.rpcStatements[rpc] = (counts.rpcStatements[rpc] ?? 0) + 1
  const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text
  const operation = /^\s*(\w+)/.exec(sql ?? '')?.[1]?.toUpperCase() ?? 'OTHER'
  counts.operations[operation] = (counts.operations[operation] ?? 0) + 1
  const captureWideDate = wideDate && rpc && operation === 'SELECT'
    && sql.includes('"weld_joints".xmin::text as "row_version"') && sql.includes('union all')
    && (Array.isArray(args[1]) ? args[1] : args[0]?.values ?? []).includes('%E2E-DEEP-POPUP%')
  const facetRequest = jointFacetTrace ? facetScope.getStore() : undefined
  const result = facetRequest ? traceFacetQuery(this, args, sql, operation, facetRequest)
    : captureWideDate ? captureWideDateLeaf(this, args, sql, rpc)
    : groupRepro && operation === 'SELECT' && sql.includes('"row_groupKey"') && sql.includes('"journal_root_state"')
    ? explainGroupRepro(this, args, sql) : original.apply(this, args)
  if (resources && result?.then && operation === 'SELECT') {
    const table = /\bfrom\s+"(\w+)"/i.exec(sql ?? '')?.[1] ?? 'metadata'
    const kind = table === 'weld_joints' && /join\s+"line_programs"/i.test(sql) ? 'weld_joints_join_line_programs' : table
    const started = performance.now()
    // Count only sizes/durations and schema table names, never SQL or values.
    result.then(reply => {
      const reading = resources.reads[kind] ??= { calls: 0, rows: 0, totalMilliseconds: 0, maxRows: 0, maxWideRows: 0, maxColumns: 0, maxMilliseconds: 0 }
      reading.calls++; reading.rows += reply.rowCount ?? 0
      reading.totalMilliseconds += performance.now() - started
      reading.maxRows = Math.max(reading.maxRows, reply.rowCount ?? 0)
      reading.maxColumns = Math.max(reading.maxColumns, reply.fields?.length ?? 0)
      if ((reply.fields?.length ?? 0) > 10) reading.maxWideRows = Math.max(reading.maxWideRows, reply.rowCount ?? 0)
      reading.maxMilliseconds = Math.max(reading.maxMilliseconds, Math.round(performance.now() - started))
      const milliseconds = performance.now() - started
      if (milliseconds >= 100) {
        resources.slowReads ??= []
        resources.slowReads.push({ table: kind, milliseconds, rows: reply.rowCount, columns: reply.fields?.map(field => field.name), uptimeSeconds: process.uptime() })
        if (resources.slowReads.length > 100) resources.slowReads.shift()
      }
    }, () => {})
  }
  return result
}
const flush = () => {
  if (resources) {
    const memory = process.memoryUsage()
    resources.rssPeakBytes = Math.max(resources.rssPeakBytes, memory.rss)
    resources.heapUsedPeakBytes = Math.max(resources.heapUsedPeakBytes, memory.heapUsed)
    if (resourceContainer) resources.cgroup = Object.fromEntries(['memory.peak', 'memory.events', 'cpu.stat', 'cpu.max', 'memory.max', 'memory.swap.max']
      .map(name => [name, readFileSync('/sys/fs/cgroup/' + name, 'utf8').trim()]))
    resources.externalPeakBytes = Math.max(resources.externalPeakBytes ?? 0, memory.external)
    resources.samples.push({ uptimeSeconds: Math.round(process.uptime() * 10) / 10, rss: memory.rss, heapUsed: memory.heapUsed, external: memory.external })
    if (resources.samples.length > 120) resources.samples.shift()
  }
  writeFileSync(file + '.tmp', JSON.stringify({ ...counts, dispatcherCalculations, ...(resources ? { resources } : {}) }))
  renameSync(file + '.tmp', file)
  if (jointFacetTrace) flushFacetTrace()
}
flush()
// Tests discover this process-owned path through its environment-free marker.
console.log(`AUDIT_SQL_COUNTS=${file}`)
setInterval(flush, 500).unref()
process.on('exit', flush)
await import(pathToFileURL(join(root, 'index.mjs')).href)
