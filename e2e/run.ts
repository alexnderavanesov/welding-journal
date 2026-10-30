import { runPlaywright } from './playwright-process'
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
  const verifyFixture = await prepareE2eDatabase()
  if (process.env.AUDIT_SQL_COUNTS === '1') {
    process.env.AUDIT_SQL_COUNTS_FILE = join(await mkdtemp(join(tmpdir(), 'welding-e2e-sql-')), 'counts.json')
  }
  const { prepareE2eAuthentication } = await import('./authentication')
  await prepareE2eAuthentication(templateDirectory)
  exitCode = await runPlaywright(process.argv.slice(2))
  try {
    await verifyFixture?.()
  } catch (error) {
    exitCode = 1
    throw error
  }
} finally {
  await dropE2eDatabase()
  if (templateDirectory && exitCode === 0) await rm(templateDirectory, { recursive: true })
  else if (templateDirectory) process.stderr.write(`E2E template files preserved for diagnostics: ${templateDirectory}\n`)
}

process.exitCode = exitCode
