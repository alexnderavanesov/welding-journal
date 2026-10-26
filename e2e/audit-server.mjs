// Opt-in instrumentation of the unchanged production bundle. No SQL or values
// are logged; only submission counts are written to a fresh temporary file.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { writeFileSync, renameSync, readFileSync } from 'node:fs'
import { getHeapStatistics } from 'node:v8'
import { Session } from 'node:inspector'
import { channel } from 'node:diagnostics_channel'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const resourceContainer = process.env.AUDIT_RESOURCE_CONTAINER === '1'
assert.equal(process.env.DATABASE_URL, `postgresql://welding:welding@${resourceContainer ? 'host.docker.internal' : '127.0.0.1'}:5432/welding_tracker_e2e`)
assert.equal(process.env.PORT, resourceContainer ? '3000' : '3100')
assert.equal(process.env.E2E_USE_PRODUCTION_BUILD, '1')
const root = resolve('.output/server')
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
const counts = { statements: 0, operations: {} }
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
pg.Client.prototype.query = function (...args) {
  counts.statements++
  const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text
  const operation = /^\s*(\w+)/.exec(sql ?? '')?.[1]?.toUpperCase() ?? 'OTHER'
  counts.operations[operation] = (counts.operations[operation] ?? 0) + 1
  const result = original.apply(this, args)
  if (resources && result?.then && operation === 'SELECT') {
    const table = /\bfrom\s+"(\w+)"/i.exec(sql ?? '')?.[1] ?? 'metadata'
    const kind = table === 'weld_joints' && /join\s+"line_programs"/i.test(sql) ? 'weld_joints_join_line_programs' : table
    const started = performance.now()
    // Count only sizes/durations and schema table names, never SQL or values.
    result.then(reply => {
      const reading = resources.reads[kind] ??= { calls: 0, rows: 0, maxRows: 0, maxWideRows: 0, maxColumns: 0, maxMilliseconds: 0 }
      reading.calls++; reading.rows += reply.rowCount ?? 0
      reading.maxRows = Math.max(reading.maxRows, reply.rowCount ?? 0)
      reading.maxColumns = Math.max(reading.maxColumns, reply.fields?.length ?? 0)
      if ((reply.fields?.length ?? 0) > 10) reading.maxWideRows = Math.max(reading.maxWideRows, reply.rowCount ?? 0)
      reading.maxMilliseconds = Math.max(reading.maxMilliseconds, Math.round(performance.now() - started))
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
}
flush()
// Tests discover this process-owned path through its environment-free marker.
console.log(`AUDIT_SQL_COUNTS=${file}`)
setInterval(flush, 500).unref()
process.on('exit', flush)
await import(pathToFileURL(join(root, 'index.mjs')).href)
