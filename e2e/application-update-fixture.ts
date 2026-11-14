import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, type APIRequestContext } from '@playwright/test'
import { E2E_DATABASE_URL, assertSafeE2eDatabaseUrl, withE2eDatabase } from './database'

const markerKey = 'maintenance:release:line-program:v1'
const oldSchemaTime = 1793350023807
const newSchemaTime = 1793562133675
const indexSql = `CREATE INDEX "weld_joints_joint_choice_idx" ON "weld_joints" USING btree (lower(trim(coalesce("joint"::text, ''))));`
export const previousAccountPath = '/account?tab=profile'
export type CapturedPreviousHtml = { body: Buffer; headers: Record<string, string> }
type SchemaJournal = { entries: Array<{ idx: number; when: number; tag: string }> }
type CaptureInput = { request: APIRequestContext; oldOrigin: string; oldEntry: string; diagnosticPath: string }

/** Current-build comparisons may share the exact compiled release contract.
 * Prove that fact against both artifacts and the owned DB; never rewrite its
 * marker. A historical index-only transition retains its stricter path below. */
async function captureMatchingSchemaAccountHtml(input: CaptureInput, journal: SchemaJournal): Promise<CapturedPreviousHtml> {
  const diagnostics: Record<string, unknown> = {
    protocol: 'captured-old-html-current-rpc-same-schema-v2',
    path: previousAccountPath, oldEntry: input.oldEntry,
  }
  try {
    assert.ok(process.env.AUDIT_OLD_BUILD, 'Same-schema capture requires the saved build path')
    const oldBuild = resolve(process.env.AUDIT_OLD_BUILD)
    const currentBuild = resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output')
    assert.notEqual(oldBuild, currentBuild)
    const contract = async (build: string) => {
      const directory = resolve(build, 'server/_ssr')
      const files = (await readdir(directory)).filter(file => /^release-readiness-[^/]+\.mjs$/.test(file))
      assert.equal(files.length, 1, 'Expected one actual compiled release-readiness contract')
      const source = await readFile(resolve(directory, files[0]), 'utf8')
      assert.ok(source.includes(markerKey))
      assert.match(source, /REQUIRED_SCHEMA_TIME\s*=\s*_journal_default\.entries\.at\(-1\)\.when/)
      const embedded = source.match(/\bentries:\s*(\[[\s\S]*?\])\s*\n};/)
      assert.ok(embedded, 'The compiled contract must retain its migration journal')
      assert.deepEqual(JSON.parse(embedded[1]), journal.entries, 'Compiled and source migration journals must match exactly')
      return { source, file: files[0], sha256: createHash('sha256').update(source).digest('hex') }
    }
    const [oldContract, currentContract] = await Promise.all([contract(oldBuild), contract(currentBuild)])
    assert.equal(oldContract.source, currentContract.source, 'Same-schema mode requires byte-identical compiled release contracts')
    const schemaTime = journal.entries.at(-1)!.when
    const marker = JSON.stringify({ status: 'complete', schemaTime })
    const migration = await readFile(resolve('drizzle', `${journal.entries.at(-1)!.tag}.sql`), 'utf8')
    diagnostics.schemaTime = schemaTime
    diagnostics.migrationCount = journal.entries.length
    diagnostics.compiledContracts = { old: { file: oldContract.file, sha256: oldContract.sha256 },
      current: { file: currentContract.file, sha256: currentContract.sha256 } }
    let html!: CapturedPreviousHtml
    await withE2eDatabase(async client => {
      assert.equal((await client.query('select current_database() as name')).rows[0]?.name, 'welding_tracker_e2e')
      const applied = (await client.query('select created_at::text as time, hash from drizzle.__drizzle_migrations order by created_at')).rows
      assert.deepEqual(applied.map(row => Number(row.time)), journal.entries.map(entry => entry.when))
      assert.equal(applied.at(-1)?.hash, createHash('sha256').update(migration).digest('hex'))
      const before = (await client.query('select value from app_settings where key=$1', [markerKey])).rows
      assert.deepEqual(before, [{ value: marker }])
      const response = await input.request.get(input.oldOrigin + previousAccountPath, {
        headers: { accept: 'text/html' }, maxRedirects: 0, timeout: 30_000,
      })
      assert.equal(response.status(), 200, 'The saved server must produce genuine previous-build HTML')
      const headers = response.headers(), body = await response.body()
      assert.match(headers['content-type'] ?? '', /text\/html/)
      assert.ok(body.includes(Buffer.from('/assets/' + input.oldEntry)), 'Captured HTML must reference the saved entry module')
      html = { body, headers: Object.fromEntries(Object.entries(headers).filter(([key]) =>
        !['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'set-cookie'].includes(key))) }
      html.headers['cache-control'] = 'no-store'
      diagnostics.html = { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }
      assert.deepEqual((await client.query('select value from app_settings where key=$1', [markerKey])).rows, before,
        'The release marker must remain unchanged while capturing HTML')
      diagnostics.markerUnchanged = true
    })
    await expect.poll(async () => {
      const old = await input.request.get(input.oldOrigin + '/health/ready', { timeout: 5_000 })
      const current = await input.request.get('http://127.0.0.1:3100/health/ready', { timeout: 5_000 })
      const result = { oldStatus: old.status(), oldReady: (await old.json()).ready,
        currentStatus: current.status(), currentReady: (await current.json()).ready }
      diagnostics.health = result
      return result
    }, { timeout: 20_000 }).toEqual({ oldStatus: 200, oldReady: true, currentStatus: 200, currentReady: true })
    const asset = await input.request.get(input.oldOrigin + '/assets/' + input.oldEntry, { timeout: 5_000 })
    assert.equal(asset.status(), 200)
    assert.match(asset.headers()['content-type'] ?? '', /javascript/)
    diagnostics.oldStaticStatus = asset.status()
    return html
  } finally {
    await writeFile(input.diagnosticPath, JSON.stringify(diagnostics, null, 2))
  }
}

/** The legacy diagnostic supports exactly one additive index migration after
 * its saved build. No schema/index rollback, gate override or old RPC traffic.
 * Capture real old HTML before any browser action, then restore the marker. */
export async function capturePreviousAccountHtml(input: CaptureInput): Promise<CapturedPreviousHtml> {
  assert.equal(process.env.E2E_USE_PRODUCTION_BUILD, '1')
  assert.equal(process.env.DATABASE_URL, E2E_DATABASE_URL)
  assertSafeE2eDatabaseUrl(E2E_DATABASE_URL)
  assert.equal(input.oldOrigin, 'http://127.0.0.1:3117')
  assert.match(input.oldEntry, /^index-[^/]+\.js$/)
  const journal = JSON.parse(await readFile(resolve('drizzle/meta/_journal.json'), 'utf8')) as SchemaJournal
  if (journal.entries.length !== 58) return captureMatchingSchemaAccountHtml(input, journal)
  assert.equal(journal.entries.length, 58, 'Only the agreed additive index migration may follow this saved build')
  assert.equal(journal.entries[56].when, oldSchemaTime)
  assert.equal(journal.entries[57].when, newSchemaTime)
  assert.match(journal.entries[57].tag, /^0057_[a-z0-9_]+$/)
  const migration = await readFile(resolve('drizzle', `${journal.entries[57].tag}.sql`), 'utf8')
  assert.equal(migration.trim().replace(/\s+/g, ' '), indexSql)
  const currentMarker = JSON.stringify({ status: 'complete', schemaTime: newSchemaTime })
  const previousMarker = JSON.stringify({ status: 'complete', schemaTime: oldSchemaTime })
  const diagnostics: Record<string, unknown> = { protocol: 'captured-old-html-current-rpc-index-only-v1',
    oldSchemaTime, newSchemaTime, path: previousAccountPath, oldEntry: input.oldEntry }
  let html: CapturedPreviousHtml | undefined
  try {
    await withE2eDatabase(async client => {
      assert.equal((await client.query('select current_database() as name')).rows[0]?.name, 'welding_tracker_e2e')
      const applied = (await client.query('select created_at::text as time, hash from drizzle.__drizzle_migrations order by created_at')).rows
      assert.deepEqual(applied.map(row => Number(row.time)), journal.entries.map(entry => entry.when))
      assert.equal(applied.at(-1)?.hash, createHash('sha256').update(migration).digest('hex'))
      assert.equal((await client.query("select to_regclass('public.weld_joints_joint_choice_idx') is not null as present")).rows[0]?.present, true)
      const before = (await client.query('select value from app_settings where key=$1', [markerKey])).rows
      assert.deepEqual(before, [{ value: currentMarker }])
      const changed = await client.query('update app_settings set value=$1 where key=$2 and value=$3', [previousMarker, markerKey, currentMarker])
      assert.equal(changed.rowCount, 1)
      try {
        const response = await input.request.get(input.oldOrigin + previousAccountPath, {
          headers: { accept: 'text/html' }, maxRedirects: 0, timeout: 30_000,
        })
        assert.equal(response.status(), 200, 'The saved server must produce genuine previous-build HTML')
        const headers = response.headers(), body = await response.body()
        assert.match(headers['content-type'] ?? '', /text\/html/)
        assert.ok(body.includes(Buffer.from('/assets/' + input.oldEntry)), 'Captured HTML must reference the saved entry module')
        html = { body, headers: Object.fromEntries(Object.entries(headers).filter(([key]) =>
          !['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'set-cookie'].includes(key))) }
        html.headers['cache-control'] = 'no-store'
        diagnostics.html = { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }
      } finally {
        const restored = await client.query('update app_settings set value=$1 where key=$2 and value=$3', [currentMarker, markerKey, previousMarker])
        assert.equal(restored.rowCount, 1, 'Refuse to overwrite an unexpectedly changed release marker')
        assert.deepEqual((await client.query('select value from app_settings where key=$1', [markerKey])).rows, before)
        diagnostics.markerRestored = true
      }
    })
    // Neither a cached old "ready" nor a cached current "blocked" verdict is
    // evidence of the restored boundary. Expire the production 5-second cache.
    await delay(5_100)
    await expect.poll(async () => {
      const old = await input.request.get(input.oldOrigin + '/health/ready', { timeout: 5_000 })
      const current = await input.request.get('http://127.0.0.1:3100/health/ready', { timeout: 5_000 })
      const result = { oldStatus: old.status(), oldReady: (await old.json()).ready,
        currentStatus: current.status(), currentReady: (await current.json()).ready }
      diagnostics.restoredHealth = result
      return result
    }, { timeout: 20_000 }).toEqual({ oldStatus: 503, oldReady: false, currentStatus: 200, currentReady: true })
    // Nitro serves known static assets before its SSR/release gate. Assert it
    // on the actual saved bundle while its application requests are blocked.
    const asset = await input.request.get(input.oldOrigin + '/assets/' + input.oldEntry, { timeout: 5_000 })
    assert.equal(asset.status(), 200)
    assert.match(asset.headers()['content-type'] ?? '', /javascript/)
    diagnostics.oldStaticStatus = asset.status()
    assert.ok(html)
    return html
  } finally {
    await writeFile(input.diagnosticPath, JSON.stringify(diagnostics, null, 2))
  }
}
