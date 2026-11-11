/** Local synthetic rehearsal helpers, not a production backup command. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { openSync, closeSync, fsyncSync, createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile, rename, open } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform, Readable } from 'node:stream'
import { spawnSync } from 'node:child_process'
import type pg from 'pg'
import type { SchemeFileStore } from '../src/server/line-scheme-files'

export const sourceName = 'welding_tracker_s3_backup_20261111'
export const targetName = 'welding_tracker_s3_restore_20261111'
export const localBase = 'postgresql://welding:welding@127.0.0.1:5432/'
export const postgresContainer = 'welding-tracker-postgres'
type Entry = { key: string; size: number; pageCount: number; revisionId: string; bundleId: number; active: boolean; sha256: string }
export type BackupManifest = { kind: 'synthetic-s3-backup-v1'; createdAt: string; sourceDatabase: typeof sourceName;
  bucket: 'welding-journal-schemes-test'; database: { file: 'database.dump'; size: number; sha256: string }; objects: Entry[] }

export function command(program: string, args: string[], options: Parameters<typeof spawnSync>[2] = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 120_000, ...options })
  assert.equal(result.status, 0, `${program} failed: ${result.error?.message ?? ''} ${result.stderr ?? ''}`)
  return String(result.stdout ?? '')
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function checksum(path: string) {
  const digest = createHash('sha256'); let size = 0
  for await (const chunk of createReadStream(path)) { digest.update(chunk); size += chunk.length }
  return { size, sha256: digest.digest('hex') }
}
export async function referencedFiles(db: pg.Client) {
  return (await db.query<Omit<Entry, 'sha256'>>(`select r.file_key as key,r.size,r.page_count as "pageCount",
    r.id as "revisionId",r.bundle_id as "bundleId",(b.active_revision_id=r.id) as active
    from line_scheme_revisions r join line_scheme_bundles b on b.id=r.bundle_id order by r.file_key`)).rows
}
export async function fingerprint(db: pg.Client) {
  const result: Record<string, unknown> = {}
  const tables = (await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','drizzle') order by 1,2")).rows
  for (const { schemaname, tablename } of tables) {
    assert.match(tablename, /^[a-z_0-9]+$/)
    result[`${schemaname}.${tablename}`] = (await db.query(`select count(*)::int n, md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text),'')) hash from ${schemaname}."${tablename}" t`)).rows[0]
  }
  result.sequences = (await db.query("select schemaname,sequencename,last_value from pg_sequences where schemaname in ('public','drizzle') order by 1,2")).rows
  const columns = (await db.query("select table_schema,table_name,column_name,data_type,udt_name,is_nullable,column_default from information_schema.columns where table_schema in ('public','drizzle') order by 1,2,3")).rows
  result.columnDefinitionsSha256 = hash(Buffer.from(JSON.stringify(columns)))
  return result
}

export async function captureBackup(db: pg.Client, store: SchemeFileStore, directory: string,
  remoteDigest: (key: string) => Promise<string>) {
  assert.equal((await db.query('select current_database() as name')).rows[0].name, sourceName)
  await mkdir(directory, { mode: 0o700 }); await mkdir(join(directory, 'pdf'), { mode: 0o700 })
  // No application/writer is running against this owned source. The exported
  // snapshot also keeps the dump and the exact PDF inventory on one DB view.
  await db.query('begin isolation level repeatable read read only')
  try {
    const before = await fingerprint(db)
    const entries = await referencedFiles(db)
    const snapshot = (await db.query('select pg_export_snapshot() as id')).rows[0].id
    assert.match(snapshot, /^[0-9A-F-]+$/i)
    const dump = join(directory, 'database.dump'), fd = openSync(dump, 'wx', 0o600)
    try {
      command('docker', ['exec', postgresContainer, 'pg_dump', '-U', 'welding', '-d', sourceName, '-Fc', '--no-owner', '--no-acl', `--snapshot=${snapshot}`], { stdio: ['ignore', fd, 'pipe'] })
      fsyncSync(fd)
    } finally { closeSync(fd) }
    const objects: Entry[] = []
    for (const entry of entries) {
      assert.match(entry.key, /^[a-f0-9-]{36}\.pdf$/)
      const expectedDigest = await remoteDigest(entry.key)
      const source = await store.read(entry.key)
      assert.equal(source.size, entry.size)
      const digest = createHash('sha256'); let size = 0
      const path = join(directory, 'pdf', entry.key)
      await pipeline(source.stream, new Transform({ transform(chunk, _encoding, done) {
        size += chunk.length; digest.update(chunk); done(null, chunk)
      } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }))
      const sha256 = digest.digest('hex')
      assert.equal(size, entry.size); assert.equal(sha256, expectedDigest, 'S3 bytes differ from upload checksum')
      const file = await open(path, 'r+'); try { await file.sync() } finally { await file.close() }
      objects.push({ ...entry, sha256 })
    }
    const manifest: BackupManifest = { kind: 'synthetic-s3-backup-v1', createdAt: new Date().toISOString(), sourceDatabase: sourceName,
      bucket: 'welding-journal-schemes-test', database: { file: 'database.dump', ...await checksum(dump) }, objects }
    // A failed/incomplete copy never receives the final manifest.
    await writeFile(join(directory, 'manifest.partial.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(join(directory, 'manifest.partial.json'), join(directory, 'manifest.json'))
    return { manifest, before }
  } finally { await db.query('rollback') }
}

export async function validateBackup(directory: string): Promise<BackupManifest> {
  const manifest: BackupManifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  assert.equal(manifest.kind, 'synthetic-s3-backup-v1')
  assert.equal(manifest.sourceDatabase, sourceName); assert.equal(manifest.bucket, 'welding-journal-schemes-test')
  assert.equal(manifest.database.file, 'database.dump')
  assert.deepEqual(await checksum(join(directory, manifest.database.file)), { size: manifest.database.size, sha256: manifest.database.sha256 }, 'Database backup checksum mismatch')
  assert(Array.isArray(manifest.objects))
  const keys = new Set<string>()
  for (const entry of manifest.objects) {
    assert.match(entry.key, /^[a-f0-9-]{36}\.pdf$/)
    assert(!keys.has(entry.key), 'Duplicate PDF in manifest'); keys.add(entry.key)
    assert.deepEqual(await checksum(join(directory, 'pdf', entry.key)), { size: entry.size, sha256: entry.sha256 }, 'PDF backup checksum mismatch')
  }
  return manifest
}

export async function assertInventory(db: pg.Client, manifest: BackupManifest) {
  assert.equal((await db.query('select current_database() as name')).rows[0].name, targetName)
  assert.deepEqual(await referencedFiles(db), manifest.objects.map(({ sha256, ...entry }) => entry), 'Backup inventory must cover every restored revision, including archives')
}

export async function restoreFiles(db: pg.Client, store: SchemeFileStore, directory: string, stopAfter?: number) {
  const manifest = await validateBackup(directory)
  await assertInventory(db, manifest)
  const missing: Entry[] = []
  let skipped = 0
  // Preflight every existing key before any write. Never overwrite an unrelated
  // or different object at a restored key, even when its byte length matches.
  for (const entry of manifest.objects) {
    let present
    try { present = await store.read(entry.key) }
    catch (error) { if (error instanceof Error && error.message.includes('не найден')) { missing.push(entry); continue } throw error }
    const digest = createHash('sha256'); let size = 0
    for await (const chunk of present.stream) { digest.update(chunk); size += chunk.length }
    assert.equal(size, entry.size); assert.equal(digest.digest('hex'), entry.sha256, 'Existing S3 object differs; refusing overwrite')
    skipped++
  }
  let restored = 0
  for (const entry of missing) {
    if (stopAfter !== undefined && restored === stopAfter) break
    const file = createReadStream(join(directory, 'pdf', entry.key))
    const result = await store.upload(entry.key, Readable.toWeb(file) as ReadableStream<Uint8Array>)
    assert.deepEqual(result, { size: entry.size, pageCount: entry.pageCount, digest: entry.sha256 }); restored++
  }
  return { restored, skipped }
}

export async function verifyRestored(db: pg.Client, store: SchemeFileStore, manifest: BackupManifest) {
  await assertInventory(db, manifest)
  for (const entry of manifest.objects) {
    const { stream, size } = await store.read(entry.key)
    assert.equal(size, entry.size)
    const digest = createHash('sha256')
    for await (const chunk of stream) digest.update(chunk)
    assert.equal(digest.digest('hex'), entry.sha256)
  }
}
