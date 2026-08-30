import { spawn } from 'node:child_process'

import { dropE2eDatabase } from './database'
import prepareE2eDatabase from './global-setup'

let exitCode = 1

try {
  await prepareE2eDatabase()
  exitCode = await runPlaywright(process.argv.slice(2))
} finally {
  await dropE2eDatabase()
}

process.exitCode = exitCode

function runPlaywright(args: string[]) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'playwright', 'test', ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    })
    const forwardSignal = (signal: NodeJS.Signals) => child.kill(signal)
    const onInterrupt = () => forwardSignal('SIGINT')
    const onTerminate = () => forwardSignal('SIGTERM')
    process.once('SIGINT', onInterrupt)
    process.once('SIGTERM', onTerminate)

    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('exit', (code, signal) => {
      cleanup()
      resolve(code ?? (signal ? 1 : 0))
    })

    function cleanup() {
      process.off('SIGINT', onInterrupt)
      process.off('SIGTERM', onTerminate)
    }
  })
}
