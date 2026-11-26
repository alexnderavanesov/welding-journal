import { PublicRequestError } from '@/lib/public-request-error'
import { fork, execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const MAX_RSS_BYTES = 512 * 1024 * 1024
const VALIDATION_TIMEOUT_MS = 120_000
const PROBE_INTERVAL_MS = 100
/** RSS is observed by the parent, so a synchronous inflate cannot block it.
 * This is a sampled guard with possible overshoot, not a hard OS memory quota. */
async function workerRss(pid: number, signal: AbortSignal): Promise<number | null> {
  if (process.platform === 'linux') {
    const status = await readFile(`/proc/${pid}/status`, { encoding: 'utf8', signal })
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)
    // An exiting zombie has no VmRSS; the close event still decides success.
    if (!match && /^State:\s+Z\b/m.test(status)) return null
    if (!match) throw new Error('Missing worker RSS')
    return Number(match[1]) * 1024
  }
  if (process.platform === 'darwin') return new Promise((resolve, reject) => {
    execFile('/bin/ps', ['-o', 'rss=,stat=', '-p', String(pid)], { encoding: 'utf8', timeout: 1000, maxBuffer: 1024, signal }, (error, stdout) => {
      if (error) { reject(error); return }
      const match = /^(\d+)\s+(\S+)$/.exec(stdout.trim())
      if (!match) { reject(new Error('Missing worker RSS')); return }
      const rss = Number(match[1]) * 1024, state = match[2]
      // Darwin can release task memory before Node receives close: ps reports
      // zero RSS with Z (zombie) or E (exiting). This is not validation success;
      // the checked IPC result, peak RSS and successful close are still required.
      if (rss === 0 && (state.startsWith('Z') || state.slice(1).includes('E'))) { resolve(null); return }
      resolve(rss)
    })
  })
  throw new Error('Unsupported worker memory monitor')
}

// PDF and Excel validators may overlap. One parent handler preserves the normal
// signal disposition while asking every active child to stop.
const shutdownTasks = new Set<() => void>()
function onShutdown(signal: 'SIGTERM' | 'SIGINT') {
  const ownsSignal = process.listenerCount(signal) === 1
  for (const stop of shutdownTasks) stop()
  if (ownsSignal) {
    process.off(signal, signal === 'SIGTERM' ? onTerminate : onInterrupt)
    process.kill(process.pid, signal)
  }
}
const onTerminate = () => onShutdown('SIGTERM')
const onInterrupt = () => onShutdown('SIGINT')

export function runFileValidation<T>(
  url: URL, flag: string, job: object, invalid: string, complex: string,
  decode: (result: Record<string, unknown>) => T, signal?: AbortSignal, loader: string[] = [],
): Promise<T> {
  signal?.throwIfAborted()
  // Never inherit server inspectors/loaders/NODE_OPTIONS or database secrets.
  const child = fork(url, [], {
    execArgv: ['--max-old-space-size=256', ...loader],
    env: { [flag]: '1', NODE_ENV: 'production' },
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  let failure: Error | undefined, value: T | undefined, received = false, closed = false
  let probeTimer: ReturnType<typeof setTimeout> | undefined, probe: Promise<void> | undefined
  const probeAbort = new AbortController()
  const stop = (error: Error) => {
    failure ??= error
    if (!closed) child.kill('SIGKILL')
  }
  const abort = () => stop(signal?.reason instanceof Error ? signal.reason : new PublicRequestError('Проверка файла отменена.'))
  const parentExit = () => { if (!closed) child.kill('SIGKILL') }
  const stopOnShutdown = () => stop(new Error('Проверка файла прервана при остановке сервера.'))
  const onError = () => stop(new PublicRequestError(invalid))
  const onMessage = (message: unknown) => {
    if (received || !message || typeof message !== 'object') { stop(new PublicRequestError(invalid)); return }
    received = true
    const result = message as Record<string, unknown>
    if (typeof result.peakRssBytes !== 'number' || !Number.isFinite(result.peakRssBytes) || result.peakRssBytes <= 0) { stop(new PublicRequestError(invalid)); return }
    if (result.peakRssBytes > MAX_RSS_BYTES) { stop(new PublicRequestError(complex)); return }
    try { value = decode(result) }
    catch (error) { stop(error instanceof PublicRequestError ? error : new PublicRequestError(invalid)) }
  }
  const poll = () => {
    probe = (async () => {
      try {
        if (!child.pid) throw new Error('Missing worker process')
        const rss = await workerRss(child.pid, probeAbort.signal)
        // A probe already in flight can finish after the checked worker reply.
        // Darwin may then report 0 even before ps observes the exit-state flag.
        // Keep rejecting over-budget samples and require the actual close below.
        if (!closed && rss !== null && (!Number.isFinite(rss) || rss < 0 || (rss === 0 && value === undefined) || rss > MAX_RSS_BYTES)) stop(new PublicRequestError(complex))
      } catch {
        if (!closed && !failure && !received) stop(new PublicRequestError(invalid))
      }
      if (!closed && !failure && !received) probeTimer = setTimeout(poll, PROBE_INTERVAL_MS)
    })()
  }
  const timeout = setTimeout(() => stop(new PublicRequestError('Проверка файла заняла слишком много времени. Повторите загрузку.')), VALIDATION_TIMEOUT_MS)
  child.on('message', onMessage)
  child.on('error', onError)
  process.once('exit', parentExit)
  // Run before an existing once-handler removes itself. Never replace the
  // server's graceful shutdown, or swallow the default exit when it has none.
  if (!shutdownTasks.size) {
    process.prependListener('SIGTERM', onTerminate)
    process.prependListener('SIGINT', onInterrupt)
  }
  shutdownTasks.add(stopOnShutdown)
  signal?.addEventListener('abort', abort, { once: true })
  const completion = new Promise<T>((resolve, reject) => {
    child.once('close', (code) => {
      closed = true
      probeAbort.abort()
      clearTimeout(timeout)
      clearTimeout(probeTimer)
      child.off('message', onMessage)
      child.off('error', onError)
      process.off('exit', parentExit)
      shutdownTasks.delete(stopOnShutdown)
      if (!shutdownTasks.size) {
        process.off('SIGTERM', onTerminate)
        process.off('SIGINT', onInterrupt)
      }
      signal?.removeEventListener('abort', abort)
      // Releasing the serial queue before the process/probe closes would allow
      // concurrent parsers or leave ps processes behind after an upload.
      void (probe ?? Promise.resolve()).then(() => {
        if (failure) reject(failure)
        else if (code !== 0 || value === undefined) reject(new PublicRequestError(invalid))
        else resolve(value)
      })
    })
  })
  if (signal?.aborted) abort()
  else {
    probeTimer = setTimeout(poll, PROBE_INTERVAL_MS)
    try { child.send(job, error => { if (error) onError() }) }
    catch { onError() }
  }
  return completion
}
