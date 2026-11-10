// @vitest-environment node
import { fork } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

it.each([
  ['default', 'SIGTERM'], ['default', 'SIGINT'], ['existing-once', 'SIGTERM'], ['existing-once', 'SIGINT'],
] as const)('stops a busy parser on parent %s shutdown by %s', async (mode, signal) => {
  // Only this disposable harness receives signals, never the test runner.
  const directory = await mkdtemp(join(tmpdir(), 'scheme-worker-shutdown-'))
  const started = join(directory, 'started'), handled = join(directory, 'handled')
  const source = await readFile(new URL('./line-scheme-pdf-validation.ts', import.meta.url), 'utf8')
  await writeFile(join(directory, 'controller.mjs'), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
  await writeFile(join(directory, 'line-scheme-pdf-worker.mjs'), `import { writeFileSync } from 'node:fs';
    import { fileURLToPath } from 'node:url';
    export const pdfValidationWorkerUrl = import.meta.url;
    if (process.env.LINE_SCHEME_PDF_WORKER === '1' && process.send && process.argv[1] === fileURLToPath(import.meta.url)) {
      process.once('message', job => {
        writeFileSync(job.path, String(process.pid));
        const until = Date.now() + 3000;
        while (Date.now() < until) {} // IPC disconnect cannot interrupt this.
        process.send({ok:true,pages:1,peakRssBytes:process.resourceUsage().maxRSS*1024},()=>process.exit(0));
      });
    }`)
  await writeFile(join(directory, 'parent.mjs'), `import { writeFileSync } from 'node:fs';
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    // Isolate shutdown behaviour from macOS sandbox ps permissions.
    const exec = cp.execFile;
    cp.execFile = (file,args,options,callback) => file === '/bin/ps'
      ? queueMicrotask(()=>callback(null,'65536')) : exec(file,args,options,callback);
    syncBuiltinESMExports();
    const { validateSchemePdf } = await import('./controller.mjs');
    const [mode, signal, marker, handled] = process.argv.slice(2);
    if (mode === 'existing-once') process.once(signal, () => {
      writeFileSync(handled, signal);
      setTimeout(()=>process.exit(0), 40);
    });
    validateSchemePdf(marker,1024,100).catch(()=>{});`)
  const parent = fork(pathToFileURL(join(directory, 'parent.mjs')), [mode, signal, started, handled], {
    execArgv: [], env: { NODE_ENV: 'production' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  const parentClosed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => parent.once('close', (code, signal) => resolve({ code, signal })))
  let workerPid: number | undefined
  try {
    await expect.poll(async () => {
      try { workerPid = Number(await readFile(started, 'utf8')); return !!workerPid } catch { return false }
    }, { timeout: 2000, interval: 10 }).toBe(true)
    parent.kill(signal)
    await expect.poll(() => parent.exitCode !== null || parent.signalCode !== null, { timeout: 1000, interval: 10 }).toBe(true)
    expect(await parentClosed).toEqual(mode === 'default' ? { code: null, signal } : { code: 0, signal: null })
    if (mode === 'existing-once') expect(await readFile(handled, 'utf8')).toBe(signal)
    await expect.poll(() => {
      try { process.kill(workerPid!, 0); return false } catch { return true }
    }, { timeout: 1000, interval: 10 }).toBe(true)
  } finally {
    parent.kill('SIGKILL'); await parentClosed
    if (workerPid) { try { process.kill(workerPid, 'SIGKILL') } catch { /* Already gone. */ } }
    await rm(directory, { recursive: true, force: true })
  }
})
