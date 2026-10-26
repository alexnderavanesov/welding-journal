import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'

const directory = await mkdtemp(join(tmpdir(), 'welding-lifecycle-'))
const port = 3109
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { if (e.code === 'ESRCH') return false; throw e } }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const portOpen = () => new Promise(resolve => { const socket = net.connect(port, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true) }); socket.once('error', () => resolve(false)) })
if (await portOpen()) throw new Error(`Refusing to use occupied lifecycle port ${port}`)
let failed = false
try {
  for (const mode of ['success', 'failure', 'startup-failure', 'interrupt', 'interrupt-sigint', 'startup-interrupt']) {
    const pidFile = join(directory, `${mode}.pid`)
    let log = '', signalled = false
    const runner = spawn(process.execPath, ['--import', 'tsx', 'e2e/lifecycle/runner.ts'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LIFECYCLE_MODE: mode, LIFECYCLE_PORT: String(port), LIFECYCLE_PID_FILE: pidFile },
    })
    const collect = data => {
      log += data
      const stop = mode.startsWith('interrupt') && log.includes('LIFECYCLE_READY') ||
        mode === 'startup-interrupt' && log.includes('LIFECYCLE_SERVER_READY')
      if (stop && !signalled) { signalled = true; runner.kill(mode === 'interrupt-sigint' ? 'SIGINT' : 'SIGTERM') }
    }
    runner.stdout.on('data', collect); runner.stderr.on('data', collect)
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { runner.kill('SIGTERM'); reject(new Error(`Lifecycle runner stuck: ${mode}\n${log}`)) }, 25_000)
      runner.once('error', reject)
      runner.once('exit', (code, signal) => { clearTimeout(timeout); resolve({ code, signal }) })
    })
    const serverPid = Number(await readFile(pidFile, 'utf8').catch(error => { throw new Error(`${error.message}\n${log}`) }))
    if (!Number.isSafeInteger(serverPid) || serverPid <= 1) throw new Error('Invalid owned fixture PID; refusing cleanup by PID')
    for (let attempt = 0; attempt < 50 && alive(serverPid); attempt++) await delay(100)
    const leaked = alive(serverPid), listening = await portOpen()
    const ok = !leaked && !listening && (mode === 'success' ? result.code === 0 : result.code !== 0)
    console.log(JSON.stringify({ mode, ...result, leaked, listening, ok }))
    if (!ok) {
      failed = true
      console.error(log)
      // Only the PID written by OUR fixture is eligible for cleanup.
      if (leaked) process.kill(serverPid, 'SIGTERM')
      for (let attempt = 0; attempt < 50 && alive(serverPid); attempt++) await delay(100)
      if (alive(serverPid)) process.kill(serverPid, 'SIGKILL')
    }
  }
} finally { await rm(directory, { recursive: true, force: true }) }
process.exitCode = failed ? 1 : 0
