import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'
import { PDFDocument } from 'pdf-lib'
import { assertSafeE2eDatabaseUrl, withE2eDatabase } from '../e2e/database'

assert.equal(process.env.E2E_DATABASE_PROFILE, 'line-scheme-s3')
assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
assert.equal(process.env.LINE_SCHEME_STORAGE_DRIVER, 's3')
assert.equal(process.env.LINE_SCHEME_S3_BUCKET, 'welding-journal-schemes-test')
const baseline = process.argv.includes('--baseline')
const { getSchemeFileStore } = await import('../src/server/line-scheme-storage')
const { cleanupSchemeFiles } = await import('../src/server/line-scheme-write')
const { closeDatabase } = await import('../src/db')
const store = await getSchemeFileStore(), key = `${randomUUID()}.pdf`
const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save()
// Register ownership before a remote write, so the runner can recover from any failure.
await withE2eDatabase(db => db.query("insert into line_scheme_files(key,state) values($1,'deleting')", [key]))
await store.upload(key, new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } }))
const send = S3Client.prototype.send
let entered!: () => void
const atS3 = new Promise<void>(resolve => { entered = resolve })
// Delays only this synthetic key, in this test process; real S3 and real PostgreSQL still execute.
S3Client.prototype.send = async function(this: S3Client, command: unknown, options?: { abortSignal?: AbortSignal }) {
  if (command instanceof HeadObjectCommand && command.input.Key === key) {
    entered()
    await delay(4_000, undefined, { signal: options?.abortSignal })
  }
  return (send as Function).call(this, command, options)
} as typeof send
try {
  const started = performance.now()
  const operation = cleanupSchemeFiles().then(() => null, (error: unknown) => error)
  await atS3
  const locked = await withE2eDatabase(async db => {
    await db.query('begin')
    try { await db.query('select key from line_scheme_files where key=$1 for update nowait', [key]); return false }
    catch (error) { if ((error as { code?: string }).code === '55P03') return true; throw error }
    finally { await db.query('rollback') }
  })
  const failure = await operation, elapsedMs = Math.round(performance.now() - started)
  const evidence = { mode: baseline ? 'before' : 'after', rowLockedDuringS3: locked, elapsedMs, cleanupInterrupted: !!failure }
  await writeFile(join(process.env.E2E_S3_REPORT_DIR!, baseline ? 'cleanup-before.json' : 'cleanup-after.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence))
  if (baseline) { assert.equal(locked, true); assert(elapsedMs >= 4_000); assert.equal(failure, null) }
  else {
    assert.equal(locked, false); assert(elapsedMs < 3_500); assert(failure)
    S3Client.prototype.send = send
    const pending = await withE2eDatabase(async db => (await db.query('select state,expires_at from line_scheme_files where key=$1', [key])).rows[0])
    assert.equal(pending.state, 'deleting'); assert.equal(pending.expires_at, null)
    await cleanupSchemeFiles()
    await assert.rejects(() => store.size(key), /не найден/)
    assert.equal(await withE2eDatabase(async db => (await db.query('select key from line_scheme_files where key=$1', [key])).rowCount), 0)
    console.log('PASS interrupted cleanup retries and acknowledges a successful deletion')
    const { cleanupSchemeFilesInStore } = await import('../src/server/line-scheme-file-cleanup')
    const { requireDb } = await import('../src/db')
    const db = requireDb()
    const ownFile = async () => {
      const key = `${randomUUID()}.pdf`
      await withE2eDatabase(db => db.query("insert into line_scheme_files(key,state) values($1,'deleting')", [key]))
      await store.upload(key, new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } }))
      return key
    }
    const concurrentKey = await ownFile()
    let begin!: () => void, release!: () => void
    const entered = new Promise<void>(resolve => { begin = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    let firstDeletes = 0, secondDeletes = 0
    const first = cleanupSchemeFilesInStore(db, { ...store, remove: async (key, signal) => { firstDeletes++; begin(); await gate; await store.remove(key, signal) } }, 5_000)
    await entered
    try {
      await cleanupSchemeFilesInStore(db, { ...store, remove: async (key, signal) => { secondDeletes++; await store.remove(key, signal) } })
      assert.equal(secondDeletes, 0)
    } finally { release() }
    await first
    assert.equal(firstDeletes, 1); await assert.rejects(() => store.size(concurrentKey), /не найден/)
    console.log('PASS concurrent workers do not delete the same object twice')

    const waitingKey = await ownFile()
    let waiting!: () => void
    const waitingStarted = new Promise<void>(resolve => { waiting = resolve })
    S3Client.prototype.send = async function(this: S3Client, command: unknown, options?: { abortSignal?: AbortSignal }) {
      if (command instanceof HeadObjectCommand && command.input.Key === waitingKey) {
        waiting(); await delay(4_000, undefined, { signal: options?.abortSignal })
      }
      return (send as Function).call(this, command, options)
    } as typeof send
    const earlier = cleanupSchemeFiles().then(() => null, (error: unknown) => error)
    await waitingStarted
    try {
      const laterKey = await ownFile()
      await cleanupSchemeFiles()
      await assert.rejects(() => store.size(laterKey), /не найден/)
      assert(await earlier)
    } finally { S3Client.prototype.send = send; await earlier }
    await cleanupSchemeFiles()
    console.log('PASS a concurrent mutation cleans its new key while an earlier pass is waiting')

    const lostAckKey = await ownFile()
    await assert.rejects(() => cleanupSchemeFilesInStore(db, { ...store, remove: async (key, signal) => { await store.remove(key, signal); throw new Error('Simulated lost cleanup acknowledgement') } }), /отложена/)
    assert.equal(await withE2eDatabase(async db => (await db.query('select state from line_scheme_files where key=$1', [lostAckKey])).rows[0]?.state), 'deleting')
    await cleanupSchemeFilesInStore(db, store)
    assert.equal(await withE2eDatabase(async db => (await db.query('select key from line_scheme_files where key=$1', [lostAckKey])).rowCount), 0)
    console.log('PASS already-removed S3 object recovers after acknowledgement failure')

    const expiredKey = await ownFile()
    await withE2eDatabase(db => db.query("update line_scheme_files set expires_at=now()+interval '1 minute' where key=$1", [expiredKey]))
    let removals = 0
    const observed = { ...store, remove: async (key: string, signal?: AbortSignal) => { removals++; await store.remove(key, signal) } }
    await cleanupSchemeFilesInStore(db, observed); assert.equal(removals, 0)
    await withE2eDatabase(db => db.query("update line_scheme_files set expires_at=now()-interval '1 minute' where key=$1", [expiredKey]))
    await cleanupSchemeFilesInStore(db, observed); assert.equal(removals, 1)
    console.log('PASS live leases are skipped and abandoned leases expire')

    // Referential protection applies even to inconsistent historical lifecycle states.
    const retainedKey = await ownFile(), revisionId = randomUUID()
    await withE2eDatabase(async db => {
      const line = (await db.query("insert into line_programs(project_title,subtitle_code,line) values('S3 cleanup retained','CLEAN','KEEP') returning id")).rows[0].id
      const bundle = (await db.query("insert into line_scheme_bundles(line_program_id,project_title,subtitle_code,line) values($1,'S3 cleanup retained','CLEAN','KEEP') returning id", [line])).rows[0].id
      await db.query("insert into line_scheme_revisions(id,bundle_id,file_key,file_name,size,page_count,author_id,author_name) values($1,$2,$3,'retained.pdf',$4,1,'test','test')", [revisionId,bundle,retainedKey,bytes.length])
    })
    for (const state of ['ready','deleting','staging']) {
      await withE2eDatabase(db => db.query("update line_scheme_files set state=$2,expires_at=now()-interval '1 minute' where key=$1", [retainedKey,state]))
      let touched = false
      await cleanupSchemeFilesInStore(db, { ...store, remove: async () => { touched = true; throw new Error('Referenced object must not be touched') } })
      assert.equal(touched, false); assert.equal(await store.size(retainedKey), bytes.length)
    }
    await withE2eDatabase(db => db.query("update line_scheme_files set state='ready',expires_at=null where key=$1", [retainedKey]))
    console.log('PASS active/referenced PDF survives every cleanup candidate state')
  }
} finally {
  S3Client.prototype.send = send
  await closeDatabase()
}
