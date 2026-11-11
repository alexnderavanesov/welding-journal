/** Explicit, isolated S3 integration runner; never used by ordinary E2E runs. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { parse } from 'dotenv'
import { readSchemeS3Config } from '../src/server/line-scheme-storage'
import { createS3SchemeFileStore } from '../src/server/line-scheme-s3'

const args = process.argv.slice(2)
assert(args.shift() === '--allow-test-writes', 'Explicit --allow-test-writes is required')
assert(args.length <= 1 && (!args[0] || ['--baseline-cleanup', '--linux'].includes(args[0])), 'Unknown S3 runner argument')
const baseline = args[0] === '--baseline-cleanup'
const linux = args[0] === '--linux'
if (linux) process.env.E2E_S3_LINUX = '1'
const settings = parse(await readFile(resolve('.env.s3-test.local'))), config = readSchemeS3Config(settings, 'S3_TEST')
assert.equal(config.endpoint, 'https://s3.ru-1.storage.selcloud.ru'); assert.equal(config.region, 'ru-1')
assert.equal(config.bucket, 'welding-journal-schemes-test'); assert.equal(settings.S3_TEST_FORCE_PATH_STYLE, 'false')
Object.assign(process.env, { E2E_DATABASE_PROFILE: 'line-scheme-s3', WELDING_ENV_LOADED: '1',
  E2E_PORT: '3107', LINE_SCHEME_STORAGE_DRIVER: 's3', LINE_SCHEME_S3_ENDPOINT: config.endpoint,
  LINE_SCHEME_S3_REGION: config.region, LINE_SCHEME_S3_BUCKET: config.bucket,
  LINE_SCHEME_S3_ACCESS_KEY_ID: config.accessKeyId, LINE_SCHEME_S3_SECRET_ACCESS_KEY: config.secretAccessKey })
const { E2E_DATABASE_URL, dropE2eDatabase, withE2eDatabase } = await import('./database')
process.env.DATABASE_URL = E2E_DATABASE_URL
const temporary = await mkdtemp(join(tmpdir(), 'welding-e2e-templates-s3-'))
process.env.DOCUMENT_TEMPLATE_STORAGE_PATH = temporary
process.env.LINE_SCHEME_STORAGE_PATH = join(temporary, 'line-schemes')
process.env.E2E_USE_PRODUCTION_BUILD = '1'
process.env.AUDIT_SQL_COUNTS = '1'
const sqlDirectory = await mkdtemp(join(tmpdir(), 'welding-e2e-sql-'))
process.env.AUDIT_SQL_COUNTS_FILE = join(sqlDirectory, 'counts.json')
const output = resolve(linux ? 'outputs/s3-linux-2026-11-11' : 'outputs/s3-integration-2026-11-11'); await mkdir(output, { recursive: true })
process.env.E2E_S3_REPORT_DIR = output
async function child(script: string, args: string[] = [], environment: NodeJS.ProcessEnv = {}) {
  const code = await new Promise<number>((resolve, reject) => {
    const processChild = spawn(process.execPath, ['--import', 'tsx', script, ...args], { env: { ...process.env, ...environment }, stdio: 'inherit' })
    processChild.once('error', reject); processChild.once('exit', code => resolve(code ?? 1))
  })
  assert.equal(code, 0, `Failed: ${script}`)
}
let ready = false, succeeded = false
let container: Awaited<ReturnType<typeof import('./s3-linux-container').startS3LinuxContainer>> | undefined
try {
  const { default: setup } = await import('./global-setup')
  await setup(); ready = true
  const { prepareE2eAuthentication } = await import('./authentication')
  await prepareE2eAuthentication(temporary)
  console.log('S3 integration: fresh isolated database and local authentication ready')
  if (baseline) await child('scripts/verify-line-scheme-s3-cleanup.ts', ['--baseline'])
  else {
    if (linux) {
      const { PDFDocument } = await import('pdf-lib')
      const pdf = await PDFDocument.create(); pdf.addPage()
      const fixtures = join(temporary, 'linux-fixtures'); await mkdir(fixtures)
      await writeFile(join(fixtures, 'probe.pdf'), await pdf.save())
      const { startS3LinuxContainer } = await import('./s3-linux-container')
      container = await startS3LinuxContainer(sqlDirectory, fixtures, output)
      container.probe()
      await writeFile(join(output, 'linux-probe.json'), await readFile(join(sqlDirectory, 'linux-probe.json')))
    } else {
      // Recheck the shared cleanup contract with local filesystem failures first.
      // This phase precedes every S3 write and owns this otherwise empty PDF registry.
      await withE2eDatabase(async db => assert.equal((await db.query('select key from line_scheme_files')).rowCount, 0))
      await child('scripts/verify-line-schemes.ts', [], { LINE_SCHEME_STORAGE_DRIVER: 'local' })
      await withE2eDatabase(async db => {
        assert.equal((await db.query('select id from line_scheme_revisions')).rowCount, 0)
        await db.query('delete from line_scheme_files')
      })
      await rm(process.env.LINE_SCHEME_STORAGE_PATH!, { recursive: true, force: true })
      await child('scripts/verify-line-scheme-s3-cleanup.ts')
    }
    const { runPlaywright } = await import('./playwright-process')
    const configuration = linux ? ['--config', 'e2e/s3-linux.config.ts'] : []
    process.env.E2E_CHROME = '1'
    assert.equal(await runPlaywright([...configuration, 'line-schemes.spec.ts', 'line-scheme-network.spec.ts', 'line-scheme-s3.spec.ts',
      'line-scheme-draft-navigation.spec.ts', 'line-scheme-large-file.spec.ts',
      '--output', join(output, `chrome-${Date.now()}`)]), 0, 'Chrome S3 workflows failed')
    await writeFile(join(output, 'chrome-sql-s3-counts.json'), await readFile(process.env.AUDIT_SQL_COUNTS_FILE))
    process.env.E2E_BROWSER = 'webkit'
    assert.equal(await runPlaywright([...configuration, 'line-schemes.spec.ts', '--output', join(output, `webkit-${Date.now()}`)]), 0, 'WebKit S3 workflow failed')
    await container?.inspectTemporaryFiles()
  }
  succeeded = true
} finally {
  await container?.stop()
  // Only keys recorded in this freshly-created owned DB, never a bucket-wide listing/deletion.
  // If object cleanup fails, preserve the DB so its object inventory is not lost.
  if (ready) {
    const keys = await withE2eDatabase(async db => (await db.query<{ key: string }>('select key from line_scheme_files')).rows)
    const store = createS3SchemeFileStore(config)
    for (const { key } of keys) await store.remove(key)
    await writeFile(join(output, baseline ? 'baseline-cleanup-summary.json' : 'cleanup-summary.json'), JSON.stringify({
      at: new Date().toISOString(), succeeded, database: new URL(E2E_DATABASE_URL).pathname.slice(1),
      bucket: config.bucket, removedCurrentObjects: keys.map(row => row.key), historicalVersionsMayRemain: true,
    }, null, 2) + '\n')
  }
  await dropE2eDatabase()
  await rm(temporary, { recursive: true, force: true })
  await rm(sqlDirectory, { recursive: true, force: true })
  console.log('S3 integration: own current objects, temporary files and disposable database cleaned')
}
