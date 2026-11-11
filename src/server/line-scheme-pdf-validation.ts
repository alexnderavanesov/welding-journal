import { fork, execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const MAX_RSS_BYTES = 512 * 1024 * 1024
const VALIDATION_TIMEOUT_MS = 120_000
const PROBE_INTERVAL_MS = 100
const RESOURCE_ERROR = 'Не удалось безопасно проверить PDF. Файл слишком сложный или повреждён.'
const VALIDATION_ERROR = 'Не удалось проверить PDF. Повторите загрузку.'
const errors: Record<string, string> = {
  size: 'Загрузите исправный PDF размером до 100 МБ.',
  invalid: 'Не удалось прочитать PDF: файл повреждён или защищён паролем.',
  encrypted: 'Файл защищён паролем. Загрузите PDF без пароля.',
  tree: 'Не удалось прочитать PDF: повреждён список страниц.',
  pages: 'PDF должен содержать от 1 до 100 страниц.',
  box: 'Не удалось прочитать PDF: повреждена страница.',
}

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

export async function validateSchemePdf(path: string, maxBytes: number, maxPages: number, signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted()
  const { pdfValidationWorkerUrl } = await import('./line-scheme-pdf-worker.mjs')
  signal?.throwIfAborted()
  // Never inherit server inspectors/loaders/NODE_OPTIONS or database secrets.
  const child = fork(new URL(pdfValidationWorkerUrl), [], {
    execArgv: ['--max-old-space-size=256'],
    env: { LINE_SCHEME_PDF_WORKER: '1', NODE_ENV: 'production' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  let failure: Error | undefined, pages: number | undefined, received = false, closed = false
  let probeTimer: ReturnType<typeof setTimeout> | undefined, probe: Promise<void> | undefined
  const probeAbort = new AbortController()
  const stop = (error: Error) => {
    failure ??= error
    if (!closed) child.kill('SIGKILL')
  }
  const abort = () => stop(signal?.reason instanceof Error ? signal.reason : new Error('Проверка PDF отменена.'))
  const parentExit = () => { if (!closed) child.kill('SIGKILL') }
  const onShutdown = (name: 'SIGTERM' | 'SIGINT') => {
    const ownsSignal = process.listenerCount(name) === 1
    stop(new Error('Проверка PDF прервана при остановке сервера.'))
    if (ownsSignal) {
      process.off(name, name === 'SIGTERM' ? onTerminate : onInterrupt)
      process.kill(process.pid, name)
    }
  }
  const onTerminate = () => onShutdown('SIGTERM')
  const onInterrupt = () => onShutdown('SIGINT')
  const onError = () => stop(new Error(VALIDATION_ERROR))
  const onMessage = (message: unknown) => {
    if (received || !message || typeof message !== 'object') { stop(new Error(VALIDATION_ERROR)); return }
    received = true
    const result = message as { ok?: unknown; pages?: unknown; reason?: unknown; peakRssBytes?: unknown }
    if (typeof result.peakRssBytes !== 'number' || !Number.isFinite(result.peakRssBytes) || result.peakRssBytes <= 0) { stop(new Error(VALIDATION_ERROR)); return }
    if (result.peakRssBytes > MAX_RSS_BYTES) { stop(new Error(RESOURCE_ERROR)); return }
    if (result.ok !== true) { stop(new Error(typeof result.reason === 'string' ? errors[result.reason] ?? VALIDATION_ERROR : VALIDATION_ERROR)); return }
    if (!Number.isSafeInteger(result.pages) || (result.pages as number) < 1 || (result.pages as number) > maxPages) { stop(new Error(VALIDATION_ERROR)); return }
    pages = result.pages as number
  }
  const poll = () => {
    probe = (async () => {
      try {
        if (!child.pid) throw new Error('Missing worker process')
        const rss = await workerRss(child.pid, probeAbort.signal)
        // A probe already in flight can finish after the checked worker reply.
        // Darwin may then report 0 even before ps observes the exit-state flag.
        // Keep rejecting over-budget samples and require the actual close below.
        if (!closed && rss !== null && (!Number.isFinite(rss) || rss < 0 || (rss === 0 && pages === undefined) || rss > MAX_RSS_BYTES)) stop(new Error(RESOURCE_ERROR))
      } catch {
        if (!closed && !failure && !received) stop(new Error(VALIDATION_ERROR))
      }
      if (!closed && !failure && !received) probeTimer = setTimeout(poll, PROBE_INTERVAL_MS)
    })()
  }
  const timeout = setTimeout(() => stop(new Error('Проверка PDF заняла слишком много времени. Повторите загрузку.')), VALIDATION_TIMEOUT_MS)
  child.on('message', onMessage)
  child.on('error', onError)
  process.once('exit', parentExit)
  // Run before an existing once-handler removes itself. Never replace the
  // server's graceful shutdown, or swallow the default exit when it has none.
  process.prependListener('SIGTERM', onTerminate)
  process.prependListener('SIGINT', onInterrupt)
  signal?.addEventListener('abort', abort, { once: true })
  const completion = new Promise<number>((resolve, reject) => {
    child.once('close', (code) => {
      closed = true
      probeAbort.abort()
      clearTimeout(timeout)
      clearTimeout(probeTimer)
      child.off('message', onMessage)
      child.off('error', onError)
      process.off('exit', parentExit)
      process.off('SIGTERM', onTerminate)
      process.off('SIGINT', onInterrupt)
      signal?.removeEventListener('abort', abort)
      // Releasing the serial queue before the process/probe closes would allow
      // concurrent parsers or leave ps processes behind after an upload.
      void (probe ?? Promise.resolve()).then(() => {
        if (failure) reject(failure)
        else if (code !== 0 || pages === undefined) reject(new Error(VALIDATION_ERROR))
        else resolve(pages)
      })
    })
  })
  if (signal?.aborted) abort()
  else {
    probeTimer = setTimeout(poll, PROBE_INTERVAL_MS)
    try { child.send({ path, maxBytes, maxPages }, error => { if (error) onError() }) }
    catch { onError() }
  }
  return completion
}
