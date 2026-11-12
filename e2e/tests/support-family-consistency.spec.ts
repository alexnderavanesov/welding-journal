import { expect, test } from '@playwright/test'
import { sql } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { isTConnectionType } from '../../src/lib/connection-type'
import { normalizeDataListOption } from '../../src/lib/data-list-settings'
import { computeStatisticsServerResult } from '../../src/server/statistics'
import { loadLineProgramPage, loadLineProgramSection } from '../../src/server/line-program'
import { normalizedConnectionTypeSql, supportConnectionTypeWhere } from '../../src/server/connection-type-sql'
import { loadSupportLengthChainRows } from '../../src/server/support-weld-length-scope'
import { updateWeldJoint } from '../../src/server/weld-mutations'
import { asE2eOwner } from '../with-owner-access'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'

const project = 'E2E support family consistency'
const update = asE2eOwner(updateWeldJoint, 'welding.edit')
const whitespace = [9, 10, 11, 12, 13, 32, 160, 5760, ...Array.from({ length: 11 }, (_, n) => 8192 + n), 8232, 8233, 8239, 8287, 12288, 65279]
const spellings = [...whitespace.map(code => `${String.fromCodePoint(code)}т1 `), '\u1c841', '\u1c851', '\t\u1c841 ', '\u00a0\u1c851 ', ' T1 ', '\u0085Т1', '\u200bТ1', '', null]
test.afterEach(() => cleanupLineProgramProjects([project]))

test('SQL family and data-list normalization match JS for supported Cyrillic spellings and every JS whitespace', async () => {
  const values = [...spellings, ...whitespace.map(code => `\ufeffу${String.fromCodePoint(code)}19\u00a0`), '\u1c8317', 'т4д', 'тё']
  const result = await requireDb().execute<{ ordinal: number; family: boolean; normalized: string }>(sql`
    select ordinal::int, ${supportConnectionTypeWhere(sql`value`)} as family,
      ${normalizedConnectionTypeSql(sql`value`)} as normalized
    from unnest(${sql.param(values)}::text[]) with ordinality as sample(value, ordinal) order by ordinal`)
  expect(result.rows.map(row => [row.family, row.normalized]))
    .toEqual(values.map(value => [isTConnectionType(value), normalizeDataListOption(value)]))
})

test('support-only lines and statistics include legacy spellings, with the same family boundary as detailed calculations', async ({ page }) => {
  const fixture = await withLineProgramFixture(async db => {
    const rows: { id: number; line: string; support: boolean }[] = []
    for (const [index, type] of spellings.entries()) {
      const line = `L${String(index).padStart(2, '0')}`, support = isTConnectionType(type)
      const program = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
        values($1,'FAMILY',$2,'II','Б(а)',20,20) returning id`, [project, line])).rows[0]
      const row = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,
        officiality,revision_actuality,has_vik,weld_length,stamp_1_k,stamp_1_k_fact)
        values($1,$2,'FAMILY',$3,$4,$5,'2026-10-01','действующий','актуальная','да',$6,'FAMILY-STAMP','FAMILY-STAMP') returning id`,
      [program.id, project, line, `${support ? 'ОП' : 'F'}${index + 1}`, type, support ? '100.1' : null])).rows[0]
      rows.push({ id: row.id, line, support })
    }
    return rows
  })
  const supports = fixture.filter(row => row.support), ordinary = fixture.filter(row => !row.support)
  const summary = await computeStatisticsServerResult({ tab: 'supports', projectFilter: project.toLowerCase(), from: '', to: '' })
  expect([...summary.supportSummary!.rowIds.physical].sort((a, b) => a - b)).toEqual(supports.map(row => row.id))
  expect(summary.supportSummary).toMatchObject({ physical: supports.length, produced: supports.length,
    welders: [{ stamp: 'FAMILY-STAMP', total: supports.length, waitingRequest: supports.length }] })
  expect((await computeStatisticsServerResult({ tab: 'general', projectFilter: project.toLowerCase(), from: '', to: '' })).summary.welded).toBe(ordinary.length)
  // The agreed line summary includes ОП alongside ordinary physical joints.
  expect((await computeStatisticsServerResult({ tab: 'lineSummary', projectFilter: project.toLowerCase(), from: '', to: '' })).lineSummary.total).toBe(fixture.length)
  const request = { tab: 'supports' as const, search: project.toLowerCase() }
  expect((await loadLineProgramSection(request)).rows.map(row => row.line)).toEqual(supports.map(row => row.line))
  expect((await loadLineProgramPage({ ...request, page: 0 })).total).toBe(supports.length)

  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill(project)
  await program.getByRole('button', { name: 'Опоры', exact: true }).click()
  await expect(program.getByLabel('Итоги раздела').getByRole('button', { name: `Линий ${supports.length}`, exact: true })).toBeVisible()
  await page.goto('/statistics')
  await page.getByRole('button', { name: 'Опоры', exact: true }).click()
  await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
  await page.getByRole('combobox', { name: 'Проект', exact: true }).selectOption(project.toLowerCase())
  await expect(page.getByTestId('support-statistics').getByRole('button', { name: /^Физические опоры/ }).first()).toContainText(`${supports.length} шт.`)
  await expect(page.getByTestId('support-welder-statistics').locator('[row-id="FAMILY-STAMP"] [col-id="total"]')).toHaveText(String(supports.length))
})

test('a legacy support spelling keeps moved repairs in the length lock and propagation scope', async () => {
  const ids = await withLineProgramFixture(async db => {
    for (const line of ['A', 'B']) await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,'FAMILY',$2,'II','Б(а)',0,0)`, [project, line])
    const rows = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,connection_type,d1,t1,weld_length,officiality,revision_actuality,has_vik)
      values($1,'FAMILY','A','ОП1',$2,57,6,100,'действующий','актуальная','да'),
        ($1,'FAMILY','B','ОП1R1','Т1',57,6,100,'действующий','актуальная','да') returning id`, [project, '\t\u1c841\ufeff'])).rows.map(row => Number(row.id))
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id)
      values($1,'primary',$1,null),($2,'repair',$1,$1)`, rows)
    return rows
  })
  expect((await loadSupportLengthChainRows(requireDb(), [ids[0]])).map(row => row.id)).toEqual(ids)
  const version = await withE2eDatabase(async db => (await db.query('select xmin::text version from weld_joints where id=$1', [ids[0]])).rows[0].version as string)
  await update({ data: { id: ids[0], expectedVersion: version, weldLength: '200.123456789123456789' } })
  const saved = await withE2eDatabase(async db => (await db.query('select weld_length::text from weld_joints where id=any($1::int[]) order by id', [ids])).rows)
  expect(saved.map(row => row.weld_length)).toEqual(Array(2).fill('200.123456789123456789'))
})
