// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import { validateSchemePdf } from './line-scheme-pdf-validation'

const worker = vi.hoisted(() => ({ url: '' }))
vi.mock('./line-scheme-pdf-worker.mjs', () => ({ get pdfValidationWorkerUrl() { return worker.url } }))
// This case proves actual OS process cancellation, not an RSS threshold. Keep
// its unrelated memory probe independent of a test runner's ps permissions.
vi.mock('node:child_process', async original => ({
  ...await original<typeof import('node:child_process')>(),
  execFile: (_path: unknown, _args: unknown, _options: unknown, callback: (error: null, value: string) => void) => callback(null, '65536'),
}))
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, readFile: (...args: Parameters<typeof fs.readFile>) => String(args[0]).startsWith('/proc/') ? Promise.resolve('VmRSS:\t65536 kB\n') : fs.readFile(...args) }
})

it('kills an actually busy child and reaps it before rejecting caller cancellation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scheme-worker-cancel-'))
  const path = join(directory, 'busy.mjs'), started = join(directory, 'started')
  const abort = new AbortController()
  let result: Promise<number | Error> | undefined
  let pid: number | undefined
  try {
    await writeFile(path, `import { writeFileSync } from 'node:fs';
      process.once('message', job => {
        writeFileSync(job.path, String(process.pid));
        const until = Date.now() + 2000;
        while (Date.now() < until) {} // Deliberately cannot receive an IPC abort.
        process.send({ok:true,pages:1,peakRssBytes:process.resourceUsage().maxRSS*1024},()=>process.exit(0));
      });`)
    worker.url = pathToFileURL(path).href
    result = validateSchemePdf(started, 1024, 100, abort.signal).catch((error: Error) => error)
    await expect.poll(async () => {
      try { pid = Number(await readFile(started, 'utf8')); return !!pid } catch { return false }
    }, { timeout: 1500, interval: 10 }).toBe(true)
    const before = performance.now()
    abort.abort(new Error('operator cancelled'))
    expect(await result).toEqual(new Error('operator cancelled'))
    expect(performance.now() - before).toBeLessThan(1000)
    expect(() => process.kill(pid!, 0)).toThrow()
  } finally {
    abort.abort()
    await result
    if (pid) { try { process.kill(pid, 'SIGKILL') } catch { /* Already reaped. */ } }
    await rm(directory, { recursive: true, force: true })
  }
})
