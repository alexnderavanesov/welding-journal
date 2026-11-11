/** Opt-in disaster rehearsal with synthetic data only. No production targets. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, stat } from 'node:fs/promises'
import { openSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { parse } from 'dotenv'
import pg from 'pg'
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'
import { PDFDocument } from 'pdf-lib'
import { readSchemeS3Config } from '../src/server/line-scheme-storage'
import { createS3SchemeFileStore } from '../src/server/line-scheme-s3'
import { sourceName, targetName, localBase, postgresContainer, command, captureBackup,
  validateBackup, fingerprint, restoreFiles, verifyRestored } from './s3-backup-archive'

assert.deepEqual(process.argv.slice(2), ['--allow-test-writes'])
assert.equal(command('git', ['branch', '--show-current']).trim(), 'main')
assert.match(command('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim(), /^unix:\/\//)
assert.match(command('docker', ['port', postgresContainer, '5432/tcp']), /:5432\b/)
await new Promise<void>((resolve, reject) => { const server = createServer(); server.once('error', reject)
  server.listen(3109, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve())) })
const settings = parse(await readFile('.env.s3-test.local')), config = readSchemeS3Config(settings, 'S3_TEST')
assert.equal(config.endpoint, 'https://s3.ru-1.storage.selcloud.ru'); assert.equal(config.region, 'ru-1')
assert.equal(config.bucket, 'welding-journal-schemes-test'); assert.equal(settings.S3_TEST_FORCE_PATH_STYLE, 'false')
for (const name of Object.keys(process.env)) if (/^(E2E_|AUDIT_|DEEP_)/.test(name)) delete process.env[name]
Object.assign(process.env, { WELDING_ENV_LOADED: '1', E2E_DATABASE_PROFILE: 'line-scheme-s3-backup', E2E_PORT: '3109',
  DATABASE_URL: localBase + sourceName, LINE_SCHEME_STORAGE_DRIVER: 's3', LINE_SCHEME_S3_ENDPOINT: config.endpoint,
  LINE_SCHEME_S3_REGION: config.region, LINE_SCHEME_S3_BUCKET: config.bucket,
  LINE_SCHEME_S3_ACCESS_KEY_ID: config.accessKeyId, LINE_SCHEME_S3_SECRET_ACCESS_KEY: config.secretAccessKey })
await mkdir('outputs', { recursive: true })
const output = await mkdtemp(resolve('outputs/s3-backup-2026-11-11-'))
const temporary = await mkdtemp(join(tmpdir(), 'welding-e2e-templates-s3-backup-'))
const counts = await mkdtemp(join(tmpdir(), 'welding-e2e-sql-'))
Object.assign(process.env, { E2E_S3_REPORT_DIR: output, DOCUMENT_TEMPLATE_STORAGE_PATH: temporary,
  LINE_SCHEME_STORAGE_PATH: join(temporary, 'unused-local-pdfs'), AUDIT_SQL_COUNTS: '1',
  AUDIT_SQL_COUNTS_FILE: join(counts, 'counts.json'), E2E_USE_PRODUCTION_BUILD: '1' })
const { dropE2eDatabase, withE2eDatabase } = await import('./database')
const store = createS3SchemeFileStore(config)
const s3 = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: false, maxAttempts: 1,
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } })
const admin = new pg.Client({ connectionString: localBase + 'postgres' })
const ownKeys = new Set<string>()
let sourceReady = false, sourceDropped = false, targetOid: number | undefined, target: pg.Client | undefined
let container: Awaited<ReturnType<typeof import('./s3-linux-container').startS3LinuxContainer>> | undefined
let succeeded = false, stage = 'preflight'
const report: Record<string, unknown> = { kind: 'synthetic-s3-backup-restore', output, productionAccess: false }
const save = () => writeFile(join(output, 'report.json'), JSON.stringify({ ...report, stage, succeeded }, null, 2) + '\n', { mode: 0o600 })
const inventory = () => writeFile(join(output, 'ownership.json'), JSON.stringify({ sourceName, targetName, targetOid,
  bucket: config.bucket, keys: [...ownKeys] }, null, 2) + '\n', { mode: 0o600 })
await admin.connect()
try {
  for (const name of [sourceName, targetName]) assert.equal((await admin.query('select oid from pg_database where datname=$1', [name])).rowCount, 0, `Refuse existing ${name}`)
  const { default: setup } = await import('./global-setup')
  await setup(); sourceReady = true
  const { prepareE2eAuthentication } = await import('./authentication')
  await prepareE2eAuthentication(temporary)
  stage = 'create synthetic revisions'
  console.log(command(process.execPath, ['--import', 'tsx', 'e2e/seed-s3-backup.ts']).trim())
  for (const row of await withE2eDatabase(async db => (await db.query<{ key: string }>('select key from line_scheme_files')).rows)) ownKeys.add(row.key)
  const sentinelKey = `${randomUUID()}.pdf`; ownKeys.add(sentinelKey); await inventory()
  const pdf = await PDFDocument.create(); pdf.addPage(); const sentinel = await pdf.save()
  await store.upload(sentinelKey, new ReadableStream({ start(c) { c.enqueue(sentinel); c.close() } }))
  const archive = join(output, 'backup')
  stage = 'capture consistent database and PDF backup'
  const { manifest, before } = await withE2eDatabase(db => captureBackup(db, store, archive, async key => {
    const response = await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))
    assert.match(response.Metadata?.sha256 ?? '', /^[a-f0-9]{64}$/)
    return response.Metadata!.sha256
  }))
  assert.equal(manifest.objects.length, 3); assert.equal(manifest.objects.filter(entry => entry.active).length, 1)
  assert(!manifest.objects.some(entry => entry.key === sentinelKey))
  assert.deepEqual(await validateBackup(archive), manifest)
  assert.deepEqual(await withE2eDatabase(fingerprint), before, 'Backup must not modify source facts')
  await writeFile(join(output, 'database-fingerprint.json'), JSON.stringify(before, null, 2) + '\n', { mode: 0o600 })
  report.backup = { pdfCount: 3, archivedPdfCount: 2, bytes: manifest.objects.reduce((sum, file) => sum + file.size, 0), dumpBytes: manifest.database.size,
    tables: Object.keys(before).filter(key => key.startsWith('public.') || key.startsWith('drizzle.')).length,
    databaseAndInventoryShareSnapshot: true, writersStopped: true }
  console.log('PASS complete backup: database snapshot + all active/archive PDF bytes and checksums')

  stage = 'reject incomplete and corrupted backups'
  const missing = join(output, 'negative-missing-file'); await cp(archive, missing, { recursive: true })
  await rm(join(missing, 'pdf', manifest.objects[0].key)); await assert.rejects(() => validateBackup(missing), /ENOENT/)
  const corrupt = join(output, 'negative-corrupt-file'); await cp(archive, corrupt, { recursive: true })
  const damagedPath = join(corrupt, 'pdf', manifest.objects[0].key), damaged = await readFile(damagedPath)
  damaged[Math.floor(damaged.length / 2)] ^= 1; await writeFile(damagedPath, damaged)
  await assert.rejects(() => validateBackup(corrupt), /PDF backup checksum mismatch/)
  const corruptDump = join(output, 'negative-corrupt-dump'); await cp(archive, corruptDump, { recursive: true })
  const dumpPath = join(corruptDump, 'database.dump'), dumpBytes = await readFile(dumpPath)
  dumpBytes[dumpBytes.length - 1] ^= 1; await writeFile(dumpPath, dumpBytes)
  await assert.rejects(() => validateBackup(corruptDump), /Database backup checksum mismatch/)
  const brokenRemote = manifest.objects[0]
  await store.remove(brokenRemote.key)
  const incomplete = join(output, 'negative-incomplete-capture')
  await assert.rejects(() => withE2eDatabase(db => captureBackup(db, store, incomplete, async () => brokenRemote.sha256)))
  assert.equal(await stat(join(incomplete, 'manifest.json')).then(() => true, () => false), false)
  // Leave the source object missing: the next phase loses every source object
  // and the source DB, proving recovery doesn't read either source or versions.
  for (const path of [missing, corrupt, corruptDump, incomplete]) await rm(path, { recursive: true })
  report.negativeBackupChecks = { missingPdf: true, sameSizeCorruptedPdf: true, corruptedDump: true, incompleteCaptureHasNoFinalManifest: true }
  console.log('PASS missing PDF, corrupted PDF/dump and incomplete capture rejected')

  stage = 'simulate loss of source database and referenced objects'
  for (const entry of manifest.objects) { await store.remove(entry.key); await assert.rejects(() => store.size(entry.key), /не найден/) }
  await dropE2eDatabase(); sourceDropped = true
  assert.equal((await admin.query('select oid from pg_database where datname=$1', [sourceName])).rowCount, 0)
  await admin.query(`create database ${targetName}`)
  targetOid = (await admin.query('select oid from pg_database where datname=$1', [targetName])).rows[0].oid
  assert(targetOid); await inventory()
  target = new pg.Client({ connectionString: localBase + targetName }); await target.connect()
  assert.equal((await target.query("select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n, 0)
  stage = 'restore database into empty owned target'
  await validateBackup(archive)
  const input = openSync(join(archive, 'database.dump'), 'r')
  try { command('docker', ['exec', '-i', postgresContainer, 'pg_restore', '-U', 'welding', '-d', targetName,
    '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction'], { stdio: [input, 'pipe', 'pipe'] }) }
  finally { closeSync(input) }
  assert.deepEqual(await fingerprint(target), before, 'All restored tables, sequence values and column definitions must match')
  await assert.rejects(() => verifyRestored(target!, store, manifest), /не найден/)
  report.databaseRestoredExactly = true; report.databaseWithoutPdfDetected = true
  const incompleteManifest = join(output, 'negative-inventory'); await cp(archive, incompleteManifest, { recursive: true })
  await writeFile(join(incompleteManifest, 'manifest.json'), JSON.stringify({ ...manifest, objects: manifest.objects.filter(e => e.active) }))
  await assert.rejects(() => restoreFiles(target!, store, incompleteManifest), /every restored revision/)
  await rm(incompleteManifest, { recursive: true })
  report.omittedArchiveDetected = true
  console.log('PASS exact database restore; missing PDF and omitted archive prevent completion')

  const collisionKey = manifest.objects[0].key
  await store.upload(collisionKey, new ReadableStream({ start(c) { c.enqueue(sentinel); c.close() } }))
  await assert.rejects(() => restoreFiles(target!, store, archive))
  const collision = await store.read(collisionKey), collisionBytes: Buffer[] = []
  for await (const chunk of collision.stream) collisionBytes.push(Buffer.from(chunk))
  assert.deepEqual(Buffer.concat(collisionBytes), Buffer.from(sentinel), 'Conflicting object must not be overwritten')
  for (const entry of manifest.objects.slice(1)) await assert.rejects(() => store.size(entry.key), /не найден/)
  await store.remove(collisionKey)
  report.conflictingObjectPreservedAndRestoreStopped = true

  stage = 'resume partial object restore and verify all hashes'
  assert.deepEqual(await restoreFiles(target, store, archive, 1), { restored: 1, skipped: 0 })
  await assert.rejects(() => verifyRestored(target!, store, manifest), /не найден/)
  assert.deepEqual(await restoreFiles(target, store, archive), { restored: 2, skipped: 1 })
  assert.deepEqual(await restoreFiles(target, store, archive), { restored: 0, skipped: 3 })
  await verifyRestored(target, store, manifest)
  assert.deepEqual(await fingerprint(target), before)
  const control = await store.read(sentinelKey), controlBytes: Buffer[] = []
  for await (const chunk of control.stream) controlBytes.push(Buffer.from(chunk))
  assert.deepEqual(Buffer.concat(controlBytes), Buffer.from(sentinel))
  report.objectRestore = { resumed: true, idempotentRepeat: true, allHashesMatch: true, unrelatedControlObjectUnchanged: true }
  console.log('PASS partial restore resumes; repeat writes nothing; unrelated test object unchanged')

  stage = 'open restored application in browsers'
  Object.assign(process.env, { E2E_DATABASE_PROFILE: 'line-scheme-s3-restore', DATABASE_URL: localBase + targetName,
    E2E_S3_LINUX: '1', E2E_CHROME: '1', E2E_S3_BACKUP_DIR: archive })
  const { startS3LinuxContainer } = await import('./s3-linux-container')
  container = await startS3LinuxContainer(counts, archive, output)
  const { runPlaywright } = await import('./playwright-process')
  for (const browser of ['chromium', 'webkit']) {
    process.env.E2E_BROWSER = browser
    assert.equal(await runPlaywright(['--config', 'e2e/s3-restore.config.ts', 'line-scheme-restore.spec.ts',
      '--output', join(output, browser)]), 0, `${browser} restored site check failed`)
  }
  await container.inspectTemporaryFiles()
  await writeFile(join(output, 'runtime-counts.json'), await readFile(join(counts, 'counts.json')))
  report.browserChecks = { chrome: true, webkit: true }
  succeeded = true; stage = 'verified'
} catch (error) {
  report.failure = error instanceof Error ? error.message : 'Unknown verification failure'
  throw error
} finally {
  await save()
  await container?.stop()
  await target?.end()
  if (sourceReady && !sourceDropped) {
    for (const row of await withE2eDatabase(async db => (await db.query<{ key: string }>('select key from line_scheme_files')).rows)) ownKeys.add(row.key)
  }
  await inventory()
  // Never list or clear the bucket. On an S3 failure, leave DBs and inventory
  // available instead of erasing the evidence needed to retry cleanup.
  for (const key of ownKeys) { await store.remove(key); await assert.rejects(() => store.size(key), /не найден/) }
  await dropE2eDatabase()
  if (targetOid !== undefined) {
    const row = (await admin.query('select oid from pg_database where datname=$1', [targetName])).rows[0]
    if (row) { assert.equal(row.oid, targetOid); await admin.query(`drop database ${targetName} with (force)`) }
  }
  assert.equal((await admin.query('select datname from pg_database where datname=any($1::text[])', [[sourceName, targetName]])).rowCount, 0)
  await admin.end(); s3.destroy()
  await rm(temporary, { recursive: true, force: true }); await rm(counts, { recursive: true, force: true })
  await writeFile(join(output, 'cleanup.json'), JSON.stringify({ databasesAbsent: true, currentObjectsConfirmedMissing: ownKeys.size,
    historicalVersionsMayRemain: true, containerRemoved: true, backupRetainedLocally: true }, null, 2) + '\n', { mode: 0o600 })
  console.log(`S3_BACKUP_REPORT=${output}`)
}
