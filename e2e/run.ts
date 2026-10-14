import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dropE2eDatabase } from './database'
import prepareE2eDatabase from './global-setup'

let exitCode = 1
let templateDirectory: string | undefined

try {
  // Database isolation alone is insufficient: template replacement removes old
  // file versions. Every runner must also own an empty, disposable file store.
  templateDirectory = await mkdtemp(join(tmpdir(), 'welding-e2e-templates-'))
  process.env.DOCUMENT_TEMPLATE_STORAGE_PATH = templateDirectory
  await prepareE2eDatabase()
  if (process.env.AUDIT_SQL_COUNTS === '1') {
    process.env.AUDIT_SQL_COUNTS_FILE = join(await mkdtemp(join(tmpdir(), 'welding-e2e-sql-')), 'counts.json')
  }
  exitCode = await runPlaywright(process.argv.slice(2))
} finally {
  await dropE2eDatabase()
  if (templateDirectory && exitCode === 0) await rm(templateDirectory, { recursive: true })
  else if (templateDirectory) process.stderr.write(`E2E template files preserved for diagnostics: ${templateDirectory}\n`)
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
