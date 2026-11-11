/** Manual, loopback-only S3 playground. It deliberately preserves its DB/files
 * when stopped, so a user does not lose their trial work or its cleanup inventory. */
import assert from 'node:assert/strict'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parse } from 'dotenv'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { readSchemeS3Config } from '../src/server/line-scheme-storage'

assert.deepEqual(process.argv.slice(2), ['--create'], 'Use --create; existing playground data is never overwritten')
const root = resolve('outputs/s3-manual-2026-11-11'), port = 3108, origin = `http://localhost:${port}`
// Refuse a busy port before creating anything. Bind only to the local machine.
await new Promise<void>((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(port, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve()))
})
const settings = parse(await readFile(resolve('.env.s3-test.local')))
const config = readSchemeS3Config(settings, 'S3_TEST')
assert.equal(config.endpoint, 'https://s3.ru-1.storage.selcloud.ru')
assert.equal(config.region, 'ru-1'); assert.equal(config.bucket, 'welding-journal-schemes-test')
assert.equal(settings.S3_TEST_FORCE_PATH_STYLE, 'false')
// Do not inherit an unrelated audit fixture or activate a costly load profile.
for (const name of Object.keys(process.env)) if (/^(E2E_|AUDIT_|DEEP_)/.test(name)) delete process.env[name]
Object.assign(process.env, { E2E_DATABASE_PROFILE: 'line-scheme-s3-manual', E2E_PORT: String(port),
  WELDING_ENV_LOADED: '1', LINE_SCHEME_STORAGE_DRIVER: 's3',
  LINE_SCHEME_S3_ENDPOINT: config.endpoint, LINE_SCHEME_S3_REGION: config.region,
  LINE_SCHEME_S3_BUCKET: config.bucket, LINE_SCHEME_S3_ACCESS_KEY_ID: config.accessKeyId,
  LINE_SCHEME_S3_SECRET_ACCESS_KEY: config.secretAccessKey,
  DOCUMENT_TEMPLATE_STORAGE_PATH: join(root, 'templates'), LINE_SCHEME_STORAGE_PATH: join(root, 'unused-local-pdfs') })
const { E2E_DATABASE_URL, withE2eDatabase } = await import('../e2e/database')
assert.equal(E2E_DATABASE_URL, 'postgresql://welding:welding@127.0.0.1:5432/welding_tracker_s3_manual_20261111')
process.env.DATABASE_URL = E2E_DATABASE_URL
await mkdir(resolve('outputs'), { recursive: true })
await mkdir(root, { mode: 0o700 }) // No recursive flag: preserve any existing manual session.
await mkdir(join(root, 'mail'), { mode: 0o700 })
await mkdir(join(root, 'templates'), { mode: 0o700 })
// A later build must not replace assets beneath the site being tried by the user.
await cp(resolve('.output'), join(root, 'app'), { recursive: true, errorOnExist: true, force: false })
const { default: setup } = await import('../e2e/global-setup')
await setup()
const databaseOid = await withE2eDatabase(async db => (await db.query('select oid from pg_database where datname=current_database()')).rows[0].oid)
await writeFile(join(root, 'ownership.json'), JSON.stringify({ createdAt: new Date().toISOString(),
  database: new URL(E2E_DATABASE_URL).pathname.slice(1), databaseOid, host: '127.0.0.1', port: 5432,
  origin, bucket: config.bucket, endpoint: config.endpoint, root, status: 'preparing' }, null, 2) + '\n', { mode: 0o600 })
const { prepareE2eAuthentication } = await import('../e2e/authentication')
await prepareE2eAuthentication(join(root, 'mail'))
// The fixture creates an ordinary password account. The separate server uses
// localhost cookies, which do not replace the working site's 127.0.0.1 cookies.
process.env.BETTER_AUTH_URL = origin
await withE2eDatabase(async db => {
  await db.query("update auth_users set name='Тестовый владелец S3', title='Локальная проверка' where email='owner@e2e.test'")
  const project = 'Тест S3 — можно изменять'
  for (const line of ['S3-001', 'S3-002', 'S3-003']) {
    const id = (await db.query("insert into line_programs(project_title,subtitle_code,line,psto_assignment) values($1,'DEMO',$2,'unassigned') returning id", [project, line])).rows[0].id
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,
        connection_type,weld_date,has_vik,psto_required,element_1,element_2,material_1,material_2,d1,d2,t1,t2)
      select $1,$2,'DEMO',$3,'S'||n,'действующий','актуальная','С',
        case when n<=10 then date '2026-11-01' else null end,'Да','Нет','Труба','Труба','20','20',108,108,4,4
        from generate_series(1,30) n`, [id, project, line])
    await db.query("insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where line_program_id=$1", [id])
  }
})
for (const revision of [0, 1]) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let n = 1; n <= 3; n++) {
    const page = pdf.addPage([842, 595])
    page.drawText(`LOCAL S3 DEMO / S3-001 / Revision ${revision} / Sheet ${n}`, { x: 40, y: 540, size: 20, font })
    page.drawText('Synthetic drawing for upload, annotation, replacement and deletion.', { x: 40, y: 510, size: 12, font })
    for (let row = 0; row < 3; row++) {
      const y = 410 - row * 120
      page.drawLine({ start: { x: 100, y }, end: { x: 730, y }, thickness: 4, color: rgb(.2, .35 + revision * .15, .5) })
      for (let j = 0; j < 5; j++) {
        const x = 120 + j * 140
        page.drawCircle({ x, y, size: 8, borderWidth: 2, borderColor: rgb(.1, .15, .2), color: rgb(1, 1, 1) })
        page.drawText(`S${1 + row * 5 + j + (n - 1) * 5}`, { x: x - 8, y: y + 20, size: 12, font })
      }
    }
  }
  await writeFile(join(root, `S3-demo-revision-${revision}.pdf`), await pdf.save())
}
await writeFile(join(root, 'access.txt'), `Локальная проверка S3\n${origin}/line-schemes\nЛогин: owner@e2e.test\nПароль: ${process.env.E2E_AUTH_PASSWORD}\n\nОдноразовая БД и тестовый бакет. Рабочие данные сюда не копировались.\n`, { mode: 0o600 })
await writeFile(join(root, 'auth-session.json'), JSON.stringify({ secret: process.env.BETTER_AUTH_SECRET,
  email: 'owner@e2e.test', password: process.env.E2E_AUTH_PASSWORD }, null, 2) + '\n', { mode: 0o600 })
const child = spawn(process.execPath, [join(root, 'app/server/index.mjs')], {
  env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) },
  stdio: 'inherit',
})
const stopped = new Promise<number>(resolve => child.once('exit', code => resolve(code ?? 1)))
child.once('error', error => { console.error(error); process.exitCode = 1 })
const stop = () => child.kill('SIGTERM')
process.once('SIGTERM', stop); process.once('SIGINT', stop)
try {
  let ready = false
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error('Playground server stopped before readiness')
    try { ready = (await fetch(`${origin}/api/auth/get-session`, { signal: AbortSignal.timeout(1000) })).ok }
    catch { /* Wait for the new child to listen. */ }
    if (ready) break
    await delay(250)
  }
  assert(ready, 'Playground did not become ready')
  const ownership = JSON.parse(await readFile(join(root, 'ownership.json'), 'utf8'))
  await writeFile(join(root, 'ownership.json'), JSON.stringify({ ...ownership, status: 'running', serverPid: child.pid, runnerPid: process.pid }, null, 2) + '\n', { mode: 0o600 })
  console.log(`READY ${origin}/line-schemes\nCredentials: ${join(root, 'access.txt')}\nDB and S3 inventory are preserved when this server stops.`)
  process.exitCode = await stopped
} finally {
  if (child.exitCode === null) { stop(); await stopped }
  process.off('SIGTERM', stop); process.off('SIGINT', stop)
  console.log('Playground stopped. Its disposable DB and test files were preserved for explicit cleanup.')
}
