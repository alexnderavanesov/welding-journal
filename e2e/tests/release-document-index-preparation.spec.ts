import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { requireDb } from '../../src/db'
import { prepareReleaseData } from '../../src/server/release-data-transition'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { lnkActionRow } from './lnk-grid-helpers'

const project = 'E2E release document preparation'
const indexKeys = ['lnkRequest', 'lnkConclusion', 'pstoRequest', 'pstoConclusion'].map(type => 'systemDocumentIndex:' + type)
const markers = () => withE2eDatabase(async db => (await db.query('select key,value from app_settings where key=any($1::text[]) order by key', [indexKeys])).rows)
const documents = () => withE2eDatabase(async db => (await db.query(`select count(*)::int documents,
  (select count(*)::int from generated_document_weld_joints) memberships from generated_documents`)).rows[0])
const documentFacts = () => withE2eDatabase(async db => (await db.query(`select
  (select md5(string_agg(md5(to_jsonb(d)::text),'' order by id)) from generated_documents d) documents,
  (select md5(string_agg(md5(to_jsonb(m)::text),'' order by document_id,weld_joint_id)) from generated_document_weld_joints m) memberships`)).rows[0])
const sourceFacts = (scope: string) => withE2eDatabase(async db => (await db.query(
  'select count(*)::int n,md5(string_agg(md5(to_jsonb(w)::text),\'\' order by id)) hash from weld_joints w where project_title=$1', [scope])).rows[0])

test('release prepares all document indexes atomically and repeat preparation preserves stored facts', async () => {
  test.setTimeout(120_000)
  const previousMarkers = await markers()
  try {
    await withE2eDatabase(async db => {
      await db.query(`insert into weld_joints(project_title,line,joint,weld_date,connection_type,has_vik,
        vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,psto_required,
        psto_request,psto_request_date,psto_result,psto_date,heat_treatment_diagram)
        select $1,'PREP','F'||n,'2026-10-01','С17','да',$1||'-VREQ-'||n,'2026-10-02','годен',
          $1||'-VCON-'||n,'2026-10-03','да',$1||'-PREQ-'||n,'2026-10-04','проведено','2026-10-05',$1||'-PCON-'||n
        from generate_series(1,4) n`, [project])
      await db.query('delete from app_settings where key=any($1::text[])', [indexKeys])
    })
    const before = await sourceFacts(project), originalDocuments = await documents(), originalFacts = await documentFacts()
    await expect(requireDb().transaction(async tx => {
      await prepareReleaseData(tx)
      throw new Error('injected release rollback')
    })).rejects.toThrow('injected release rollback')
    expect(await markers()).toEqual([])
    expect(await documents()).toEqual(originalDocuments)
    expect(await documentFacts()).toEqual(originalFacts)
    expect(await sourceFacts(project)).toEqual(before)
    const first = await requireDb().transaction(prepareReleaseData)
    expect(first.systemDocumentIndexesPrepared).toBe(true)
    expect(await markers()).toHaveLength(4)
    const prepared = await documents(), preparedMarkers = await markers(), preparedFacts = await documentFacts()
    expect(prepared.documents).toBeGreaterThanOrEqual(originalDocuments.documents + 16)
    expect(await sourceFacts(project)).toEqual(before)
    await requireDb().transaction(prepareReleaseData)
    expect(await documents()).toEqual(prepared)
    expect(await documentFacts()).toEqual(preparedFacts)
    expect(await markers()).toEqual(preparedMarkers)
    expect(await sourceFacts(project)).toEqual(before)
  } finally {
    await cleanupLineProgramProjects([project])
    await withE2eDatabase(async db => {
      await db.query('delete from app_settings where key=any($1::text[])', [indexKeys])
      for (const row of previousMarkers) await db.query('insert into app_settings(key,value) values($1,$2)', [row.key, row.value])
    })
  }
})

test('release preparation scale: 200k joints and 400k conclusions before the first user save', async ({ page }, info) => {
  test.skip(process.env.AUDIT_RELEASE_INDEX_SCALE !== '1', 'Explicit owned 200k mixed-chain fixture only')
  test.setTimeout(300_000)
  expect(process.env.AUDIT_CHAIN_SCALE).toBe('1')
  const scope = 'E2E chain-scale background'
  const before = await sourceFacts(scope)
  expect(before.n).toBe(200000)
  // Creating a control conclusion checks global document-name availability.
  // Ordinary annotation edits deliberately do not initialize the full index.
  await withE2eDatabase(db => db.query(`update weld_joints set stamp_1_k=null,weld_date='2026-10-01',
    has_vik='да',vik_request='INDEX-PROBE-VREQ',vik_request_date='2026-10-02',
    vik_result=null,vik_conclusion=null,vik_conclusion_date=null,
    has_rk='нет',has_uzk='нет',has_pvk='нет',psto_required='нет',psto_request=null,psto_request_date=null,
    psto_result=null,psto_date=null,heat_treatment_diagram=null where id=1`))
  await withE2eDatabase(db => db.query('delete from app_settings where key=any($1::text[])', [indexKeys]))
  const baseline = process.env.AUDIT_RELEASE_INDEX_BASELINE === '1'
  let coldMs: number | null = null, warmMs: number | null = null
  if (!baseline) {
    const started = performance.now()
    await requireDb().transaction(prepareReleaseData)
    coldMs = Math.round(performance.now() - started)
    expect(await markers()).toHaveLength(4)
    expect(await sourceFacts(scope)).toEqual(before)
    const prepared = await documents(), preparedFacts = await documentFacts()
    expect(prepared.documents).toBeGreaterThanOrEqual(400000)
    expect(prepared.memberships).toBeGreaterThanOrEqual(400000)
    const warmAt = performance.now()
    await requireDb().transaction(prepareReleaseData)
    warmMs = Math.round(performance.now() - warmAt)
    expect(await documents()).toEqual(prepared)
    expect(await documentFacts()).toEqual(preparedFacts)
    expect(await sourceFacts(scope)).toEqual(before)
  } else expect(await markers()).toHaveLength(0)
  await page.goto('/lnk')
  await expect(page.locator('[data-lnk-grid] .ag-row[row-id]').first()).toBeVisible({ timeout: 180_000 })
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('E2E-001')
  await expect(page.getByRole('button', { name: 'F1', exact: true })).toBeVisible()
  const row = await lnkActionRow(page, 'F1')
  await row.getByRole('button', { name: 'Выполнить: Внести результат основного НК', exact: true }).click()
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Внесение результатов ЛНК', exact: true }) })
  await editor.getByLabel('Дата контроля', { exact: true }).fill('2026-10-03')
  await editor.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()
  const preSaveMarkers = await markers()
  if (baseline) expect(preSaveMarkers.map(row => row.key)).not.toContain('systemDocumentIndex:lnkConclusion')
  else expect(preSaveMarkers).toHaveLength(4)
  // The initial report read legitimately persists derived final statuses.
  // Compare the save against that settled state; the fixture runner separately
  // verifies all operator facts/topology against the original seed.
  const beforeSaveFacts = await sourceFacts(scope)
  const savingAt = performance.now()
  await editor.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
  await expect(editor).toBeHidden()
  const firstSaveMs = Math.round(performance.now() - savingAt)
  expect(await withE2eDatabase(async db => (await db.query('select vik_result,vik_conclusion,vik_conclusion_date::text from weld_joints where id=1')).rows[0]))
    .toEqual({ vik_result: 'годен', vik_conclusion: expect.any(String), vik_conclusion_date: '2026-10-03' })
  expect(await markers()).toHaveLength(4)
  const prepared = await documents()
  expect(prepared.documents).toBeGreaterThanOrEqual(400000)
  expect(prepared.memberships).toBeGreaterThanOrEqual(400000)
  expect(await sourceFacts(scope)).toEqual(beforeSaveFacts)
  const measurements = { mode: baseline ? 'cold-user-save' : 'prepared-before-user-save', workflow: 'first LNK result/conclusion save',
    preSaveMarkers: preSaveMarkers.map(row => row.key), coldMs, warmMs, firstSaveMs, ...prepared }
  await writeFile(info.outputPath('release-index-preparation.json'), JSON.stringify(measurements, null, 2))
  console.log('RELEASE_INDEX_PREPARATION', JSON.stringify(measurements))
})
