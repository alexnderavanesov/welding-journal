import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { E2E_DATABASE_URL, withE2eDatabase } from '../database'
import { normalizeNaksStamp } from '../../src/lib/welder-stamp-registry'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'Демо Т/ОП — этапы'
const cards = ['ДЕМО-ТК-ОП-2026-М01', 'ДЕМО-ТК-ОП-2026-М05', 'ДЕМО-ТК-ОП-2026-РАД']
const certificates = ['ДЕМО-ОП-НК-2026', 'ДЕМО-ОП-ТО-2026']
let initial: Awaited<ReturnType<typeof counts>> | undefined
test.beforeEach(async () => {
  initial = undefined
  await withE2eDatabase(async db => {
    expect((await db.query('select id from weld_joints where project_title=$1', [project])).rows).toEqual([])
    expect((await db.query('select id from technology_cards where name=any($1::text[])', [cards])).rows).toEqual([])
    expect((await db.query("select id from welder_stamps where naks_stamp in ('DT01','DT02')")).rows).toEqual([])
    expect((await db.query('select id from specialists where certificate=any($1::text[])', [certificates])).rows).toEqual([])
  })
  initial = await counts()
})
test.afterEach(async () => {
  if (!initial) return
  // The script deliberately persists its demo. Only this test owns these
  // verified-absent examples; do not let their cards alter later matching tests.
  await cleanupLineProgramProjects([project])
  await withLineProgramFixture(async db => {
    await db.query('delete from technology_cards where name=any($1::text[])', [cards])
    await db.query("delete from welder_stamps where naks_stamp in ('DT01','DT02')")
    await db.query('delete from specialists where certificate=any($1::text[])', [certificates])
  })
  expect(await counts()).toEqual(initial)
})

const run = async (mode: string) => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/seed-local-support-demo.ts', mode], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' }, timeout: 30_000,
  })
  return JSON.parse(stdout)
}
const counts = () => withE2eDatabase(async db => (await db.query(`select
  (select count(*)::int from weld_joints) welds, (select count(*)::int from line_programs) lines,
  (select count(*)::int from welder_stamps) stamps, (select count(*)::int from technology_cards) cards,
  (select count(*)::int from specialists) specialists, (select count(*)::int from generated_documents) documents,
  (select count(*)::int from pre_heat_treatment_controls) pre, (select count(*)::int from psto_repeat_cycles) cycles,
  (select jsonb_agg(to_jsonb(s) order by key) from app_settings s) settings`)).rows[0])

test('локальные опоры: 30 этапов, откат проверки и повторный запуск сохраняет пользовательские правки', async () => {
  const before = await counts()
  const check = await run('--check')
  expect(check).toMatchObject({ applied: false, summary: { created: 30, preserved: before.welds } })
  expect(await counts()).toEqual(before)
  const applied = await run('--seed-test')
  expect(applied).toMatchObject({ applied: true, summary: { created: 30, preserved: before.welds } })
  expect(applied.summary.documents).toBeGreaterThan(0)
  expect(applied.summary.lines).toHaveLength(4)
  const aliases = await withE2eDatabase(async db => (await db.query(`select distinct s.naks_stamp
    from welder_stamps s join weld_joints w on w.stamp_1_k=s.naks_stamp
    where w.id=any($1::int[]) order by s.naks_stamp`, [applied.summary.rows.map((row: { id: number }) => row.id)])).rows
    .map((row: { naks_stamp: string }) => row.naks_stamp))
  // Demo examples share the real registry with ordinary operator edits. Their
  // identifiers must survive its four-character normalization without merging.
  expect(aliases).toHaveLength(2)
  for (const alias of aliases) expect(alias).toMatch(/^[A-Z0-9]{4}$/)
  expect(aliases.map(normalizeNaksStamp)).toEqual(aliases)
  expect(new Set(aliases.map(normalizeNaksStamp)).size).toBe(2)
  const after = await counts()
  expect(after).toMatchObject({ welds: before.welds + 30, lines: before.lines + 4, stamps: before.stamps + 2, cards: before.cards + 3, specialists: before.specialists + 2, cycles: before.cycles + 2, settings: before.settings })
  const id = applied.summary.rows[0].id
  await withE2eDatabase(db => db.query('update weld_joints set welding_journal_note=$1 where id=$2', ['Правка пользователя', id]))
  expect(await run('--seed-test')).toMatchObject({ summary: { skipped: true } })
  expect(await counts()).toEqual(after)
  expect(await withE2eDatabase(async db => (await db.query('select welding_journal_note from weld_joints where id=$1', [id])).rows[0].welding_journal_note)).toBe('Правка пользователя')
})
