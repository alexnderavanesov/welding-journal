// Exercise the actual production chunks under Linux/Node 22, without installing
// dependencies or copying source/credentials into the image.
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

assert.equal(process.platform, 'linux')
assert.match(process.version, /^v22\./)
assert.equal(process.env.E2E_S3_LINUX, '1')
assert.equal(process.env.DATABASE_URL, 'postgresql://welding:welding@host.docker.internal:5432/welding_tracker_s3_e2e_20261111')
assert.equal(process.env.LINE_SCHEME_STORAGE_DRIVER, 's3')
assert.equal(process.env.LINE_SCHEME_S3_ENDPOINT, 'https://s3.ru-1.storage.selcloud.ru')
assert.equal(process.env.LINE_SCHEME_S3_BUCKET, 'welding-journal-schemes-test')

const root = '/app/.output/server/_ssr'
async function implementation(prefix, marker) {
  const matches = []
  for (const name of await readdir(root)) if (name.startsWith(prefix + '-') && name.endsWith('.mjs')) {
    const source = await readFile(`${root}/${name}`, 'utf8')
    if (source.includes(marker)) matches.push({ name, source })
  }
  assert.equal(matches.length, 1)
  return matches[0]
}
const write = await implementation('line-scheme-write', 'async function cleanupSchemeFiles(')
const exported = name => {
  const alias = new RegExp(`\\b${name} as (\\w+)`).exec(write.source.slice(write.source.lastIndexOf('export {')))?.[1]
  assert(alias, `Missing built export: ${name}`)
  return alias
}
const methods = await import(`${root}/${write.name}`)
const store = await methods[exported('getSchemeFileStore')]()
const cleanup = methods[exported('cleanupSchemeFiles')]
const database = await implementation('db', 'async function createDatabase()')
const imports = database.source.match(/\[drizzleModule, pgModule,[\s\S]*?Promise\.all\(\[([\s\S]*?)\]\)/)?.[1]
const pgPath = [...(imports ?? '').matchAll(/import\("([^"]+)"\)/g)][1]?.[1]
assert.match(pgPath ?? '', /^\.\.\/_libs\/[\w.-]+\.mjs$/)
const pg = (await import(`${root}/${pgPath}`)).default
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()
const key = `${randomUUID()}.pdf`, invalidKey = `${randomUUID()}.pdf`, cancelledKey = `${randomUUID()}.pdf`
const bytes = await readFile('/audit-fixtures/probe.pdf')
const stream = () => new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } })
const staging = async () => (await readdir('/tmp')).filter(name => name.startsWith('.scheme-upload-'))
const remove = store.remove
try {
  assert.deepEqual(await staging(), [])
  await db.query("insert into line_scheme_files(key,state) values($1,'deleting')", [key])
  await db.query("insert into line_scheme_files(key,state,expires_at) select unnest($1::text[]),'staging',now()+interval '1 hour'", [[invalidKey, cancelledKey]])
  const uploaded = await store.upload(key, stream())
  assert.deepEqual(uploaded, { size: bytes.length, pageCount: 1, digest: createHash('sha256').update(bytes).digest('hex') })
  assert.equal(await store.size(key), bytes.length)
  await assert.rejects(() => store.upload(key, stream()), /уже существует/)
  await assert.rejects(() => store.upload(invalidKey, new ReadableStream({ start(c) { c.enqueue(Buffer.from('not a PDF')); c.close() } })))
  // Hold one partial request to inspect actual Linux permissions, then cancel it.
  const controller = new AbortController()
  const upload = store.upload(cancelledKey, new ReadableStream({ start(c) { c.enqueue(bytes.subarray(0, 10)) } }), controller.signal)
  const rejected = assert.rejects(upload)
  const directory = `/tmp/.scheme-upload-${cancelledKey}`
  try {
    let file
    for (let i = 0; i < 100 && !file; i++) { file = await stat(`${directory}/source.pdf`).catch(() => null); if (!file) await delay(20) }
    assert(file)
    assert.equal((await stat(directory)).mode & 0o777, 0o700)
    assert.equal(file.mode & 0o777, 0o600)
  } finally { controller.abort(); await rejected }
  assert.deepEqual(await staging(), [])
  await assert.rejects(() => store.size(invalidKey), /не найден/)
  await assert.rejects(() => store.size(cancelledKey), /не найден/)
  await db.query('delete from line_scheme_files where key=any($1::text[])', [[invalidKey, cancelledKey]])

  let entered
  const atStorage = new Promise(resolve => { entered = resolve })
  store.remove = async (candidate, signal) => {
    assert.equal(candidate, key); entered()
    await delay(4_000, undefined, { signal })
    return remove(candidate, signal)
  }
  const started = performance.now()
  const pending = cleanup().then(() => null, error => error)
  await atStorage
  await db.query('begin')
  try { await db.query('select key from line_scheme_files where key=$1 for update nowait', [key]) }
  finally { await db.query('rollback') }
  assert(await pending)
  const elapsedMs = Math.round(performance.now() - started)
  assert(elapsedMs < 3500)
  const row = (await db.query('select state,expires_at from line_scheme_files where key=$1', [key])).rows[0]
  assert.equal(row.state, 'deleting'); assert.equal(row.expires_at, null)
  store.remove = remove
  await cleanup()
  await assert.rejects(() => store.size(key), /не найден/)
  assert.equal((await db.query('select key from line_scheme_files where key=$1', [key])).rowCount, 0)
  await remove(key)
  assert.deepEqual(await staging(), [])
  const result = { platform: process.platform, arch: process.arch, node: process.version,
    uploadAndDigest: true, immutableKey: true, invalidAndCancelledUploads: true,
    privateTemporaryPermissions: '0700/0600', temporaryFilesRemaining: 0,
    rowLockedDuringStorageWait: false, cleanupElapsedMs: elapsedMs, cleanupRetry: true }
  await writeFile('/audit-counts/linux-probe.json', JSON.stringify(result, null, 2) + '\n')
  console.log('S3_LINUX_PROBE ' + JSON.stringify(result))
} finally {
  store.remove = remove
  await db.end()
  // The parent runner owns the database and all object keys if this probe fails.
  const module = await import(`${root}/${database.name}`)
  const alias = /closeDatabase as (\w+)/.exec(database.source.slice(database.source.lastIndexOf('export {')))?.[1]
  assert(alias); await module[alias]()
}
