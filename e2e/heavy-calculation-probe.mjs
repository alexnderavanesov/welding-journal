// Explicit disposable-database diagnostics. Loaded only by audit-server.mjs;
// no application code, data values, query changes or cache manipulation.
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { writeFileSync, renameSync } from 'node:fs'
import { Server } from 'node:http'
import { Session } from 'node:inspector'

export function installHeavyCalculationProbe(pg, countsFile) {
  const performanceProfile = process.env.E2E_DATABASE_PROFILE === 'precommit-performance'
  const database = performanceProfile ? 'welding_tracker_precommit_perf_e2e' : 'welding_tracker_e2e'
  assert.equal(process.env.DATABASE_URL, `postgresql://welding:welding@127.0.0.1:5432/${database}`)
  assert.equal(process.env.PORT, performanceProfile ? '3177' : '3100')
  assert.equal(process.env.AUDIT_PRIORITY_SPEED, '1')
  assert.notEqual(process.env.AUDIT_CPU_PROFILE, '1')
  const scope = new AsyncLocalStorage(), originalQuery = pg.Client.prototype.query, originalEmit = Server.prototype.emit
  const labels = new Set(['journal-initial', 'heatTreatment-root-1-0', 'heatTreatment-child-0',
    'statistics-general-0', 'statistics-lnk-0', 'statistics-welders-0'])
  let busy = false
  pg.Client.prototype.query = function (...args) {
    const current = scope.getStore()
    if (!current || current.sql.length >= 4096) return originalQuery.apply(this, args)
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text ?? ''
    const parameters = Array.isArray(args[1]) ? args[1] : args[0]?.values ?? []
    const entry = { operation: /^\s*(\w+)/.exec(text)?.[1], shape: createHash('sha256').update(text).digest('hex'),
      table: /\b(?:from|into|update)\s+((?:"[^"]+"|\w+)(?:\.(?:"[^"]+"|\w+))?)/i.exec(text)?.[1],
      parameters: parameters.map(value => Array.isArray(value) ? { array: value.length } : typeof value === 'string' ? { text: value.length } : typeof value) }
    current.sql.push(entry)
    const started = performance.now()
    const finish = (error, result) => { entry.ms = performance.now() - started; entry.rows = result?.rowCount; entry.columns = result?.fields?.length; if (error) entry.error = error.code ?? error.name }
    const callback = typeof args.at(-1) === 'function' ? args.at(-1) : undefined
    const forwarded = callback ? [...args.slice(0, -1), function (...values) { finish(values[0], values[1]); return callback.apply(this, values) }] : args
    try {
      const result = originalQuery.apply(this, forwarded)
      if (!callback && result?.then) result.then(value => finish(undefined, value), error => finish(error))
      return result
    } catch (error) { finish(error); throw error }
  }
  Server.prototype.emit = function (event, ...args) {
    const label = event === 'request' ? args[0]?.headers['x-e2e-heavy-profile'] : undefined
    if (!label) return originalEmit.call(this, event, ...args)
    assert(labels.has(label) && args[0].method === 'POST' && /^\/_serverFn\/[a-f0-9]{64}$/.test(args[0].url))
    assert(!busy, 'Heavy calculation profiles must run serially')
    busy = true
    const [request, response] = args, session = new Session()
    session.connect()
    const post = method => new Promise((resolve, reject) => session.post(method, (error, value) => error ? reject(error) : resolve(value)))
    const record = { label, node: process.version, sql: [] }, started = performance.now()
    const target = countsFile.replace(/counts\.json$/, `heavy-${label}`)
    const save = () => { writeFileSync(target + '.json.tmp', JSON.stringify(record)); renameSync(target + '.json.tmp', target + '.json') }
    let stopping = false
    const stop = async () => {
      if (stopping) return
      stopping = true
      record.ms = performance.now() - started; record.status = response.statusCode
      try {
        const { profile } = await post('Profiler.stop')
        const encoded = JSON.stringify(profile)
        assert(Buffer.byteLength(encoded) < 32 * 1024 * 1024)
        writeFileSync(target + '.cpuprofile', encoded)
      } catch (error) { record.error = String(error) }
      finally { session.disconnect(); save(); busy = false }
    }
    void (async () => {
      try {
        await post('Profiler.enable'); await post('Profiler.start')
        response.once('finish', stop); response.once('close', stop)
        scope.run(record, () => originalEmit.call(this, event, request, response))
      } catch (error) { record.error = String(error); response.statusCode = 500; response.end('Diagnostic setup failed'); await stop() }
    })()
    return true
  }
}
