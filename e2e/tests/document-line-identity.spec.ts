import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { linePrograms } from '../../src/db/schema'
import { SYSTEM_DOCUMENT_IDENTITY_TRANSITION_KEY } from '../../src/lib/release-contract'
import { SYSTEM_DOCUMENT_TEMPLATE_PROFILES } from '../../src/lib/system-document-template-types'
import { saveLineProgramInTransaction, toLineProgramRecord } from '../../src/server/line-program'
import { prepareReleaseData } from '../../src/server/release-data-transition'
import { isDatabaseReleaseReady } from '../../src/server/release-readiness'
import { refreshSystemDocumentIdentityMetadata } from '../../src/server/system-document-identity-metadata'
import { loadIndexedSystemDocumentHistoryFilterOptions, loadIndexedSystemDocumentHistoryGrid } from '../../src/server/system-document-index'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { openDocumentGridFilter } from '../document-grid'

const project = 'E2E document identity rename'
const oldLine = 'IDENTITY-OLD'
const newLine = 'IDENTITY-NEW'
let firstLine: number, secondLine: number, firstDoc: number, mixedDoc: number, unrelatedDoc: number, orphanDoc: number

test.beforeEach(async () => {
  await withLineProgramFixture(async db => {
    const lines = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,'CODE','IDENTITY-OLD','II','A',10,10),($1,'CODE','IDENTITY-OTHER','II','A',10,10),
      ($2,'CODE','IDENTITY-OLD','II','A',10,10) returning id`, [project, project + ' unrelated'])).rows.map(r => r.id)
    ;[firstLine, secondLine] = lines
    const joints = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,has_vik,
      category,group_name,weld_control_percent,pvk_control_percent,weld_date)
      select id,project_title,subtitle_code,line,'IDENTITY-F'||id,'да',category,group_name,weld_control_percent,pvk_control_percent,'2026-10-01'
      from line_programs where id=any($1::int[]) order by id returning id`, [lines])).rows.map(r => r.id)
    const preId = (await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,result,conclusion_name)
      values($1,'РК','годен','IDENTITY-PRE') returning id`, [joints[0]])).rows[0].id
    const repeatId = (await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_result)
      values($1,2,'проведено') returning id`, [joints[0]])).rows[0].id
    for (const profile of SYSTEM_DOCUMENT_TEMPLATE_PROFILES) {
      const mixed = profile.id === 'lnkConclusionPvk'
      const metadata = { label: profile.label, methodCodes: [profile.id === 'lnkConclusionPvk' ? 'ПВК' : 'ВИК'],
        projects: [project], subtitleCodes: ['CODE'], lines: mixed ? [oldLine, 'IDENTITY-OTHER'] : [oldLine],
        positionCount: mixed ? 2 : 1, periodFrom: '2026-10-01', periodTo: '2026-10-01',
        ...(profile.id === 'lnkConclusionRk' ? { sourceKind: 'beforeHeatTreatment', sourcePositions: [
          { kind: 'beforeHeatTreatment', weldJointId: joints[0], relationId: preId, methodCode: 'РК' }], methodCodes: ['РК'] } : {}),
        ...(profile.id.startsWith('psto') || profile.id.startsWith('tvmt') ? {
          sourceKind: 'pstoRepeat', cycleSequences: [2], sourcePositions: [
            { kind: 'pstoRepeat', weldJointId: joints[0], relationId: repeatId, sequence: 2, methodCode: 'ТВМТ' }],
        } : {}),
      }
      const id = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count,source_metadata,specialists)
        values($1,$2,'identity.xlsx','application/octet-stream',$3,$4,$5) returning id`,
        [`system:${profile.id}`, `${project}-${profile.id}`, mixed ? 2 : 1, JSON.stringify(metadata), JSON.stringify({ first: { id: 99, name: 'Сохранённый специалист' } })])).rows[0].id
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [id, mixed ? joints.slice(0, 2) : joints.slice(0, 1)])
      if (profile.id === 'lnkConclusionVik') firstDoc = id
      if (mixed) mixedDoc = id
    }
    for (const kind of ['unrelated', 'orphan']) {
      const id = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,source_metadata)
        values('system:lnkConclusionVik',$1,'keep.xlsx','application/octet-stream',$2) returning id`,
        [`${project}-${kind}`, JSON.stringify({ projects: [project + ' unrelated'], subtitleCodes: ['CODE'], lines: [oldLine], history: 'keep' })])).rows[0].id
      if (kind === 'unrelated') {
        unrelatedDoc = id
        await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [id, joints[2]])
      } else orphanDoc = id
    }
  })
})

test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project, project + ' changed', project + ' unrelated'])
  await withE2eDatabase(db => db.query('delete from generated_documents where id=$1', [orphanDoc]))
})

async function rename(id: number, values: Record<string, string>) {
  return requireDb().transaction(async tx => {
    const [stored] = await tx.select().from(linePrograms).where(eq(linePrograms.id, id))
    return saveLineProgramInTransaction(tx, { ...toLineProgramRecord(stored), ...values })
  })
}
const docs = () => withE2eDatabase(async db => (await db.query(`select id,source_metadata::jsonb metadata,xmin::text version,
  to_jsonb(d) - array['source_metadata','updated_at'] fixed from generated_documents d where title like $1 order by id`, [project + '%'])).rows)
const facts = () => withE2eDatabase(async db => (await db.query(`select
  (select jsonb_agg(a order by document_id,weld_joint_id) from generated_document_weld_joints a where document_id in
    (select id from generated_documents where title like $1)) links,
  (select jsonb_agg(c order by id) from pre_heat_treatment_controls c where weld_joint_id in
    (select id from weld_joints where project_title like $1)) preliminary,
  (select jsonb_agg(c order by id) from psto_repeat_cycles c where weld_joint_id in
    (select id from weld_joints where project_title like $1)) cycles`, [project + '%'])).rows[0])
function history(metadata: Record<string, unknown>) {
  const { projects, subtitleCodes, lines, ...rest } = metadata
  return rest
}
const options = (fieldKey: 'line' | 'project' | 'subtitle', documentId = firstDoc) => loadIndexedSystemDocumentHistoryFilterOptions({
  type: 'lnkConclusion', documentId, fieldKey, search: '', columnFilters: {},
})

test('whole-line rename updates all system types, full mixed composition and filters, preserving history', async () => {
  const before = await docs(), originalFacts = await facts()
  const request = { type: 'lnkConclusion' as const, documentId: firstDoc, columnFilters: {}, startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }
  const registry = await loadIndexedSystemDocumentHistoryGrid(request)
  await rename(firstLine, { line: newLine, projectTitle: project + ' changed', subtitleCode: 'NEW-CODE' })
  const after = await docs()
  expect(after.map(d => d.fixed)).toEqual(before.map(d => d.fixed))
  expect(after.map(d => history(d.metadata))).toEqual(before.map(d => history(d.metadata)))
  expect(await facts()).toEqual(originalFacts)
  for (let i = 0; i < after.length; i++) {
    const doc = after[i]
    if ([unrelatedDoc, orphanDoc].includes(doc.id)) { expect(doc).toEqual(before[i]); continue }
    expect(doc.version).not.toBe(before[i].version)
    expect(doc.metadata.lines).toEqual(doc.id === mixedDoc ? [newLine, 'IDENTITY-OTHER'] : [newLine])
    expect(doc.metadata.projects).toEqual(doc.id === mixedDoc ? [project, project + ' changed'] : [project + ' changed'])
    expect(doc.metadata.subtitleCodes).toEqual(doc.id === mixedDoc ? ['CODE', 'NEW-CODE'] : ['NEW-CODE'])
  }
  expect((await options('line')).options.map(o => o.value)).toEqual([newLine])
  expect((await options('project')).options.map(o => o.value)).toEqual([project + ' changed'])
  expect((await options('subtitle')).options.map(o => o.value)).toEqual(['NEW-CODE'])
  expect((await loadIndexedSystemDocumentHistoryGrid(request)).revision).not.toBe(registry.revision)
  await expect(loadIndexedSystemDocumentHistoryGrid({ ...request, idsOnly: true, revision: registry.revision })).rejects.toThrow('Данные реестра изменились')
  await rename(firstLine, { line: newLine.toLowerCase(), subtitleCode: '' })
  expect((await options('line')).options.map(o => o.value)).toEqual([newLine.toLowerCase()])
  expect((await options('subtitle')).options.map(o => o.value)).toEqual([''])
  const unchanged = await docs()
  await rename(firstLine, { line: newLine.toLowerCase() })
  expect(await docs()).toEqual(unchanged)
})

test('concurrent renames of two lines in one document retain both identities', async () => {
  await Promise.all([rename(firstLine, { line: newLine }), rename(secondLine, { line: 'IDENTITY-SECOND-NEW' })])
  expect((await options('line', mixedDoc)).options.map(o => o.value)).toEqual([newLine, 'IDENTITY-SECOND-NEW'])
})

test('rename rollback preserves document metadata, versions and membership', async () => {
  const before = await docs(), originalFacts = await facts()
  await expect(requireDb().transaction(async tx => {
    const [stored] = await tx.select().from(linePrograms).where(eq(linePrograms.id, firstLine))
    await saveLineProgramInTransaction(tx, { ...toLineProgramRecord(stored), line: newLine })
    throw new Error('injected failure after document refresh')
  })).rejects.toThrow('injected failure')
  expect(await docs()).toEqual(before)
  expect(await facts()).toEqual(originalFacts)
})

test('release repairs old identities atomically, gates readiness, and skips the next release', async () => {
  const before = await docs(), originalFacts = await facts()
  // Recreate the old handler's effect without rewriting documents.
  await withLineProgramFixture(db => db.query(`update weld_joints set line=$2,project_title=$3,subtitle_code='NEW-CODE' where line_program_id=$1`, [firstLine, newLine, project + ' changed']))
  await withE2eDatabase(db => db.query('delete from app_settings where key=$1', [SYSTEM_DOCUMENT_IDENTITY_TRANSITION_KEY]))
  expect(await isDatabaseReleaseReady(requireDb())).toBe(false)
  await expect(requireDb().transaction(async tx => {
    const result = await prepareReleaseData(tx)
    expect(result.documentIdentities.updated).toBe(SYSTEM_DOCUMENT_TEMPLATE_PROFILES.length)
    expect(await isDatabaseReleaseReady(tx)).toBe(true)
    throw new Error('injected release rollback')
  })).rejects.toThrow('injected release rollback')
  expect(await isDatabaseReleaseReady(requireDb())).toBe(false)
  expect(await docs()).toEqual(before)
  const result = await requireDb().transaction(prepareReleaseData)
  expect(result.documentIdentities).toEqual({ skipped: false, updated: SYSTEM_DOCUMENT_TEMPLATE_PROFILES.length })
  expect(await isDatabaseReleaseReady(requireDb())).toBe(true)
  const after = await docs()
  expect(after.map(d => d.fixed)).toEqual(before.map(d => d.fixed))
  expect(after.map(d => history(d.metadata))).toEqual(before.map(d => history(d.metadata)))
  expect(await facts()).toEqual(originalFacts)
  expect((await options('line')).options.map(o => o.value)).toEqual([newLine])
  expect((await requireDb().transaction(prepareReleaseData)).documentIdentities).toEqual({ skipped: true, updated: 0 })
  expect(await docs()).toEqual(after)
  expect(await requireDb().transaction(tx => refreshSystemDocumentIdentityMetadata(tx))).toBe(0)
  expect(await docs()).toEqual(after)
})

test('invalid metadata aborts the rename without partial changes', async () => {
  await withE2eDatabase(db => db.query("update generated_documents set source_metadata='[]' where id=$1", [firstDoc]))
  const before = await docs()
  await expect(rename(firstLine, { line: newLine })).rejects.toThrow('Некорректные метаданные')
  expect(await docs()).toEqual(before)
  expect(await withE2eDatabase(async db => (await db.query('select line from line_programs where id=$1', [firstLine])).rows[0].line)).toBe(oldLine)
})

test('browser: cancel and confirm whole-line rename, reopen documents and use the new filter', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/percentage-lines')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill(project)
  const card = program.getByTestId('line-program-card').filter({ hasText: oldLine }).filter({ hasText: project }).first()
  await card.getByRole('button', { name: 'Настроить', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Настройка линии', exact: true })
  await editor.getByLabel('Линия', { exact: true }).fill(newLine)
  await editor.getByRole('button', { name: 'Сохранить программу' }).click()
  const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Изменить данные всей линии?' }) })
  await confirm.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect((await options('line')).options.map(o => o.value)).toEqual([oldLine])
  await editor.getByRole('button', { name: 'Сохранить программу' }).click()
  await confirm.getByRole('button', { name: 'Изменить всю линию', exact: true }).click()
  await expect(editor).toBeHidden()
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заключения ЛНК', exact: true }).click()
  const grid = page.locator('[data-document-history-grid]')
  await grid.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill(project + '-lnkConclusionVik')
  await expect(grid.getByText('Найдено: 1', { exact: true })).toBeVisible()
  const filter = await openDocumentGridFilter(page, 'line', 'Линия')
  await expect(filter.getByRole('checkbox', { name: new RegExp(newLine) })).toBeVisible()
  await expect(filter.getByRole('checkbox', { name: new RegExp(oldLine) })).toHaveCount(0)
  await filter.getByRole('checkbox', { name: new RegExp(newLine) }).check()
  await expect(grid.getByText('Найдено: 1', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
