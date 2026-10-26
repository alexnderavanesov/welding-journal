import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const playwrightCli = createRequire(import.meta.url).resolve('@playwright/test/cli')

export function runPlaywright(args: string[]) {
  return new Promise<number>((resolve, reject) => {
    // Signal Playwright itself. Killing only a package-manager wrapper can
    // resolve this promise while its tests and detached web server still run.
    const child = spawn(process.execPath, [playwrightCli, 'test', ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    })
    let stopping = false
    const requestStop = () => {
      if (stopping) return
      stopping = true
      // Playwright's task runner tears down webServer on SIGINT. SIGTERM can
      // exit the CLI immediately, skipping those tasks even without pnpm.
      child.kill('SIGINT')
    }
    process.on('SIGINT', requestStop)
    process.on('SIGTERM', requestStop)

    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('exit', (code, signal) => {
      cleanup()
      resolve(code ?? (signal ? 1 : 0))
    })

    function cleanup() {
      process.off('SIGINT', requestStop)
      process.off('SIGTERM', requestStop)
    }
  })
}
