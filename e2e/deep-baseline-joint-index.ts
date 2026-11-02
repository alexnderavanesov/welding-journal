import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { E2E_DATABASE_URL, assertSafeE2eDatabaseUrl, withE2eDatabase } from './database'

const schemaTime = 1793350023807
const indexName = 'weld_joints_joint_choice_idx'
const migrationSql = `CREATE INDEX "weld_joints_joint_choice_idx" ON "weld_joints" USING btree (lower(trim(coalesce("joint"::text, ''))));`
// Deliberately exact, not an expression rewriter. Confirm this deparse against
// the generated migration's first local application before using the opt-in.
const indexDefinition = `CREATE INDEX weld_joints_joint_choice_idx ON public.weld_joints USING btree (lower(TRIM(BOTH FROM COALESCE(joint, ''::text))))`
const hashAlgorithm = 'sha256-jsonl-relative-path-and-file-sha256-v1'
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const within = (path: string, directory: string) => path === directory || path.startsWith(directory + sep)

/** Stable content manifest; no mtime/absolute-path dependence. Reject all
 * symlinks (including internal ones) and special files instead of following
 * anything outside the saved bundle. May be used to record the expected hash. */
export async function hashDeepBaselineBuild(directory: string) {
  const root = resolve(directory), files: string[] = []
  assert.ok((await lstat(root)).isDirectory(), 'Saved output must be a real directory, not a symlink')
  async function collect(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name)
      if (entry.isDirectory()) await collect(file)
      else {
        assert.ok(entry.isFile(), `Saved output contains a symlink or special file: ${relative(root, file)}`)
        files.push(relative(root, file).split(sep).join('/'))
      }
    }
  }
  await collect(root)
  assert.ok(files.includes('server/index.mjs'), 'Saved output has no production server entry')
  assert.ok(files.some(file => file.startsWith('public/')), 'Saved output has no browser assets')
  const hash = createHash('sha256')
  let bytes = 0
  for (const file of files.sort()) {
    const contents = await readFile(join(root, file))
    bytes += contents.length
    hash.update(JSON.stringify([file, sha256(contents)]) + '\n')
  }
  return { sha256: hash.digest('hex'), files: files.length, bytes, algorithm: hashAlgorithm }
}

/** Only called after this process created/migrated/prepared its disposable DB
 * and installed the explicit old release marker. This is one diagnostic
 * index removal, never a general migration rollback or a production helper. */
export async function applyDeepBaselineJointIndex() {
  if (process.env.E2E_DEEP_JOINT_CHOICE_BASELINE !== '1') return
  assert.equal(process.env.E2E_USE_PRODUCTION_BUILD, '1')
  assert.equal(process.env.AUDIT_SQL_COUNTS, '1', 'Saved baseline requires the production audit runner')
  assert.notEqual(process.env.AUDIT_RESOURCE_CONTAINER, '1')
  assert.equal(process.env.E2E_PORT ?? '3100', '3100')
  assert.equal(process.env.E2E_BASELINE_SCHEMA_TIME, String(schemaTime))
  const output = process.env.E2E_AUDIT_OUTPUT_DIR
  const expectedHash = process.env.E2E_BASELINE_BUILD_SHA256
  assert.ok(output, 'An explicit saved E2E_AUDIT_OUTPUT_DIR is required')
  assert.match(expectedHash ?? '', /^[a-f0-9]{64}$/, 'An independently recorded saved-build SHA256 is required')
  const saved = await realpath(resolve(output)), mutable = resolve('.output')
  const mutableReal = await realpath(mutable).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return mutable
    throw error
  })
  for (const path of [mutable, mutableReal]) {
    assert.ok(!within(saved, path) && !within(path, saved), 'Saved bundle must be separate from mutable .output')
  }
  const build = await hashDeepBaselineBuild(resolve(output))
  assert.equal(build.sha256, expectedHash, 'Saved bundle differs from its recorded baseline hash')

  const journal = JSON.parse(await readFile(resolve('drizzle/meta/_journal.json'), 'utf8')) as {
    dialect: string; entries: Array<{ idx: number; when: number; tag: string }>
  }
  assert.equal(journal.dialect, 'postgresql')
  assert.equal(journal.entries.length, 58, 'Only one migration after the fixed baseline is allowed')
  assert.ok(journal.entries.every((entry, index) => entry.idx === index && Number.isSafeInteger(entry.when)
    && (index === 0 || entry.when > journal.entries[index - 1].when)))
  assert.deepEqual(journal.entries[56] && { when: journal.entries[56].when, tag: journal.entries[56].tag },
    { when: schemaTime, tag: '0056_strange_ma_gnuci' })
  const next = journal.entries[57]
  assert.match(next.tag, /^0057_[a-z0-9_]+$/)
  const generatedSql = await readFile(resolve('drizzle', `${next.tag}.sql`), 'utf8')
  assert.equal(generatedSql.trim().replace(/\s+/g, ' '), migrationSql,
    'The sole subsequent migration must contain exactly the agreed CREATE INDEX, with no other statements')
  const migrationHash = sha256(generatedSql)
  assertSafeE2eDatabaseUrl(E2E_DATABASE_URL)
  const url = new URL(E2E_DATABASE_URL)
  assert.equal(url.port, '5432')

  await withE2eDatabase(async client => {
    await client.query('begin')
    try {
      assert.equal((await client.query('select current_database() as name')).rows[0]?.name, 'welding_tracker_e2e')
      const applied = (await client.query('select created_at::text as time, hash from drizzle.__drizzle_migrations order by created_at')).rows
      assert.deepEqual(applied.map(row => Number(row.time)), journal.entries.map(entry => entry.when))
      assert.equal(applied.at(-1)?.hash, migrationHash, 'Applied index migration differs from its generated SQL')
      const marker = (await client.query("select value from app_settings where key='maintenance:release:line-program:v1'")).rows
      assert.equal(marker.length, 1)
      assert.deepEqual(JSON.parse(marker[0].value), { status: 'complete', schemaTime })
      const indexes = (await client.query(`select ns.nspname as index_schema, tabns.nspname as table_schema,
        tab.relname as table_name, am.amname as method, i.indisunique as is_unique,
        i.indisvalid as is_valid, i.indisready as is_ready, i.indisexclusion as is_exclusion,
        i.indnatts as columns, i.indnkeyatts as keys, i.indpred is null as no_predicate,
        pg_get_indexdef(idx.oid, 0, false) as definition
        from pg_class idx join pg_namespace ns on ns.oid=idx.relnamespace
        join pg_index i on i.indexrelid=idx.oid join pg_class tab on tab.oid=i.indrelid
        join pg_namespace tabns on tabns.oid=tab.relnamespace join pg_am am on am.oid=idx.relam
        where ns.nspname='public' and idx.relname=$1`, [indexName])).rows
      assert.deepEqual(indexes, [{ index_schema: 'public', table_schema: 'public', table_name: 'weld_joints',
        method: 'btree', is_unique: false, is_valid: true, is_ready: true, is_exclusion: false,
        columns: 1, keys: 1, no_predicate: true, definition: indexDefinition }], 'Unexpected baseline index definition')
      await client.query('drop index public.weld_joints_joint_choice_idx')
      assert.equal((await client.query("select to_regclass('public.weld_joints_joint_choice_idx') as id")).rows[0]?.id, null)
      await client.query('commit')
      process.stdout.write(`[deep-joint-choice-baseline] ${JSON.stringify({ schemaTime, output: saved, build,
        migration: { tag: next.tag, time: next.when, sha256: migrationHash }, indexName,
        indexDefinitionSha256: sha256(indexes[0].definition), indexPresent: false })}\n`)
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
}
