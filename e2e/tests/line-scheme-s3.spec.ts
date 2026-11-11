import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { withE2eDatabase } from '../database'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'
import { filterSchemeProject } from '../line-scheme-grid'
import { auditSqlCount } from '../audit-sql'

const own = schemeFixtureCleanup(test)
test('private S3 PDF: real HTTP authorization and one S3 request per read', async ({ page, browser }, info) => {
  test.skip(process.env.E2E_DATABASE_PROFILE !== 'line-scheme-s3', 'Requires the isolated opt-in S3 runner')
  test.setTimeout(90_000)
  const project = `S3-HTTP-${randomUUID()}`; own(info, project)
  const lineId = await withE2eDatabase(async db => {
    const id = (await db.query("insert into line_programs(project_title,subtitle_code,line) values($1,'HTTP','S3-HTTP') returning id", [project])).rows[0].id
    await db.query("insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality) values($1,$2,'HTTP','S3-HTTP','S1','действующий','актуальная')", [id, project])
    return id
  })
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save())
  await page.goto('/line-schemes'); await filterSchemeProject(page, project)
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('row').filter({ hasText: project }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  await (await choosing).setFiles({ name: 'S3 HTTP.pdf', mimeType: 'application/pdf', buffer: bytes })
  await page.getByRole('dialog', { name: 'Файлы и архив линии S3-HTTP', exact: true }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  const drawing = page.getByRole('dialog', { name: 'Схема линии S3-HTTP', exact: true })
  await expect(drawing.locator('canvas[data-pdf-rendered="preview"]')).toBeVisible()
  const revision = await withE2eDatabase(async db => (await db.query('select r.id,r.file_key from line_scheme_revisions r join line_scheme_bundles b on b.id=r.bundle_id where b.line_program_id=$1', [lineId])).rows[0])
  const url = `/api/line-scheme-file?revision=${revision.id}`
  const counts = async () => {
    await auditSqlCount()
    const data = JSON.parse(await readFile(process.env.AUDIT_SQL_COUNTS_FILE!, 'utf8'))
    expect(data.s3Requests?.PUT).toBeGreaterThan(0)
    return data.s3Requests as Record<string, number>
  }
  const measured: unknown[] = []
  const operation = async (name: string, expected: Record<string, number>, run: () => Promise<void>) => {
    const before = await counts(); await run(); const after = await counts()
    const delta = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])].map(key => [key, (after[key] ?? 0) - (before[key] ?? 0)]).filter(([,n]) => n !== 0))
    measured.push({ name, s3Requests: delta }); expect(delta).toEqual(expected)
  }
  await operation('full GET', { GET: 1 }, async () => { const response = await page.request.get(url); expect(response.status()).toBe(200); expect(await response.body()).toEqual(bytes) })
  await operation('Range GET', { GET_RANGE: 1 }, async () => { const response = await page.request.get(url, { headers: { Range: 'bytes=10-29' } }); expect(response.status()).toBe(206); expect(await response.body()).toEqual(bytes.subarray(10,30)) })
  await operation('HEAD', { HEAD: 1 }, async () => { expect((await page.request.head(url)).status()).toBe(200) })
  await operation('cached 304', { HEAD: 1 }, async () => { expect((await page.request.get(url, { headers: { 'If-None-Match': `"${revision.file_key}"` } })).status()).toBe(304) })
  await operation('invalid range', {}, async () => { expect((await page.request.get(url, { headers: { Range: 'bytes=999999-' } })).status()).toBe(416) })
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try { await operation('unauthenticated read', {}, async () => { expect((await anonymous.request.get(new URL(url, page.url()).href)).status()).toBe(401) }) }
  finally { await anonymous.close() }
  await operation('idle', {}, async () => { await page.waitForTimeout(1500) })
  await info.attach('s3-request-counts.json', { body: JSON.stringify(measured, null, 2), contentType: 'application/json' })
  console.log(`S3_HTTP_COUNTS ${JSON.stringify(measured)}`)
})
