// Isolated audit-wrapper control only. No application imports, query changes,
// breakpoints, cache manipulation or profiler activation on application RPCs.
import { Session } from 'node:inspector'
import { createHash } from 'node:crypto'
import { writeFileSync, renameSync } from 'node:fs'

export async function createJointFacetCpuControl({ countsFile, label }) {
  const origin = 'http://127.0.0.1:3100', prefix = '/__e2e/joint-facet-cpu/'
  const metadataFile = countsFile.replace(/counts\.json$/, 'joint-facet-cpu.json')
  const profileFile = countsFile.replace(/counts\.json$/, 'joint-facet.cpuprofile')
  const maxBytes = 32 * 1024 * 1024, maxDurationMs = 240000, commandAckTimeoutMs = 10000
  const session = new Session()
  session.connect()
  const metadata = { version: 'joint-facet-cpu-v1', label, status: 'idle', node: process.version, v8: process.versions.v8,
    samplingIntervalUs: 1000, maxDurationMs, maxBytes, commandAckTimeoutMs,
    scope: 'Whole serial replay, after untimed bootstrap/first idle. Includes all requests, idle, runtime/trace work; not acceptance timing.',
    clockRule: 'performance.now milliseconds brackets each Inspector command; profile timestamps/timeDeltas are V8 microseconds. No assumed shared origin.',
    start: null, stop: null, stopCause: null, profile: null, clockMapping: null }
  const save = () => {
    writeFileSync(metadataFile + '.tmp', JSON.stringify(metadata))
    renameSync(metadataFile + '.tmp', metadataFile)
  }
  let disconnected = false
  const disconnect = () => {
    if (disconnected) return
    disconnected = true
    try { session.disconnect() } catch { metadata.disconnectFailed = true }
  }
  // Every command owns its ACK deadline, including stop after the recording
  // watchdog has been cleared. Settle first so disconnect's pending-callback
  // errors cannot replace the timeout; late callbacks are ignored.
  const post = (method, params = {}) => new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (error) reject(error); else resolve(result)
    }
    const timer = setTimeout(() => {
      metadata.error ??= 'inspector-command-ack-timeout'
      metadata.commandTimeout = { method, atMs: performance.now(), timeoutMs: commandAckTimeoutMs }
      metadata.captureValid = false
      finish(new Error('inspector-command-ack-timeout'))
      disconnect()
    }, commandAckTimeoutMs)
    try { session.post(method, params, finish) } catch (error) { finish(error) }
  })
  try {
    await post('Profiler.enable')
    await post('Profiler.setSamplingInterval', { interval: metadata.samplingIntervalUs })
  } catch (error) {
    metadata.status = 'error'; metadata.error ??= 'inspector-setup-failed'; metadata.captureValid = false
    disconnect(); save(); throw error
  }
  save()
  let startPromise, stopPromise, watchdog
  const start = () => {
    if (metadata.status !== 'idle') return Promise.reject(new Error('invalid-start-state'))
    metadata.status = 'starting'
    startPromise = (async () => {
      metadata.start = { callBeforeMs: performance.now(), ackMs: null }
      // Bound from submission, not from ACK. A stalled Inspector command must
      // not silently turn this into an unbounded profiling session.
      watchdog = setTimeout(() => {
        if (metadata.status === 'starting') {
          metadata.stopCause = 'watchdog-before-start-ack'; metadata.error = 'inspector-start-ack-timeout'
          disconnect() // rejects the pending Inspector callback
        } else void stop('watchdog').catch(() => {})
      }, maxDurationMs)
      watchdog.unref()
      try {
        await post('Profiler.start')
        metadata.start.ackMs = performance.now()
        metadata.status = 'running'
        save()
      } catch (error) {
        metadata.status = 'error'; metadata.error ??= 'inspector-start-failed'
        clearTimeout(watchdog); disconnect(); save(); throw error
      }
    })()
    return startPromise
  }
  const stop = cause => {
    if (stopPromise) return stopPromise // watchdog/client-finally cannot stop twice
    if (!startPromise) return Promise.reject(new Error('not-started'))
    stopPromise = (async () => {
      try {
        await startPromise
        clearTimeout(watchdog)
        metadata.status = 'stopping'; metadata.stopCause = cause
        metadata.stop = { callBeforeMs: performance.now(), ackMs: null }
        const { profile } = await post('Profiler.stop')
        metadata.stop.ackMs = performance.now()
        const encoded = JSON.stringify(profile), bytes = Buffer.byteLength(encoded)
        const startTimeMs = profile.startTime / 1000, endTimeMs = profile.endTime / 1000
        const startBounds = [metadata.start.callBeforeMs - startTimeMs, metadata.start.ackMs - startTimeMs]
        const stopBounds = [metadata.stop.callBeforeMs - endTimeMs, metadata.stop.ackMs - endTimeMs]
        const lower = Math.max(startBounds[0], stopBounds[0]), upper = Math.min(startBounds[1], stopBounds[1])
        const timestampsValid = Number.isFinite(startTimeMs) && Number.isFinite(endTimeMs) && endTimeMs >= startTimeMs
        const intervalsValid = timestampsValid && lower <= upper
        metadata.clockMapping = { startBoundsMs: startBounds, stopBoundsMs: stopBounds,
          offsetBoundsMs: [lower, upper], widthMs: intervalsValid ? upper - lower : null,
          valid: intervalsValid && upper - lower <= 10, maxWidthMs: 10,
          rule: 'Map sample time (startTime+cumulative timeDeltas)/1000 + offset. Only assign a sample to a request/SQL interval when it lies inside for every allowed offset; retain ambiguous boundary samples separately.' }
        metadata.profile = { file: 'joint-facet.cpuprofile', bytes, written: false, startTime: profile.startTime,
          endTime: profile.endTime, samples: profile.samples?.length ?? 0, timeDeltas: profile.timeDeltas?.length ?? 0,
          nodes: profile.nodes?.length ?? 0, sha256: createHash('sha256').update(encoded).digest('hex') }
        if (bytes > maxBytes) {
          metadata.status = 'error'; metadata.error = 'profile-exceeds-32MiB-no-truncation'
        } else {
          writeFileSync(profileFile + '.tmp', encoded)
          renameSync(profileFile + '.tmp', profileFile)
          metadata.profile.written = true
          metadata.status = 'stopped'
        }
        metadata.captureValid = metadata.status === 'stopped' && cause === 'completed' &&
          metadata.stop.callBeforeMs - metadata.start.callBeforeMs <= maxDurationMs &&
          metadata.profile.samples > 0 && metadata.profile.samples === metadata.profile.timeDeltas
      } catch (error) {
        metadata.status = 'error'; metadata.error ??= 'inspector-stop-failed'; metadata.captureValid = false
        throw error
      } finally {
        clearTimeout(watchdog); disconnect(); save()
      }
      return metadata
    })()
    return stopPromise
  }
  // This synchronously claims only two wrapper-owned paths. Application
  // requests still use the original synchronous Server.emit and pg contracts.
  return (request, response) => {
    if (!String(request.url ?? '').startsWith(prefix)) return false
    const reply = (status, value) => {
      if (response.destroyed || response.writableEnded) return
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify(value))
    }
    const action = request.url.slice(prefix.length)
    const cause = request.headers['x-e2e-facet-cpu-stop-cause']
    const valid = ['start', 'stop'].includes(action) && request.method === 'POST' &&
      request.headers.host === '127.0.0.1:3100' && request.headers.origin === origin &&
      request.headers['sec-fetch-site'] === 'same-origin' && request.headers['x-e2e-facet-cpu-label'] === label &&
      ['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) &&
      !request.headers['transfer-encoding'] && ['0', undefined].includes(request.headers['content-length']) &&
      (action === 'start' ? cause === undefined : ['completed', 'test-finally'].includes(cause))
    if (!valid) { request.resume(); reply(400, { error: 'invalid-profile-control' }); return true }
    if (action === 'start' && metadata.status !== 'idle' || action === 'stop' && !startPromise) {
      reply(409, { error: 'invalid-profile-state' }); return true
    }
    void (action === 'start' ? start() : stop(cause)).then(() => {
      reply(metadata.status === 'error' ? 500 : 200, metadata)
    }, () => reply(500, { error: 'profile-control-failed', status: metadata.status }))
    return true
  }
}
