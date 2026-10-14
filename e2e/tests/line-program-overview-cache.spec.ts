import pg from 'pg'
import { expect, test } from '@playwright/test'
import { sql } from 'drizzle-orm'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { getLineProgramIdentityKey } from '../../src/lib/line-program'

const project = 'E2E unchanged line cache'
const scope = (line: string) => ({ projectTitle: project, subtitleCode: 'CACHE', line })
test.afterEach(() => cleanupLineProgramProjects([project]))

test('scoped edits, moves and deletion reuse only unchanged full lines; a global change clears all', async () => {
  await withLineProgramFixture(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'CACHE',line,'II','Б(а)',10,0 from unnest(array['A','B','C']) line`, [project])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      connection_type,material_group,welding_method,d1,d2,t1,t2,category,group_name,weld_control_percent,pvk_control_percent,stamp_1_k)
      select case when line='C' then null else id end,project_title,subtitle_code,line,'F910','2026-07-01',
        'С17','М01','РАД',108,108,6,6,'II','Б(а)',10,0,'TEST' from line_programs where project_title=$1`, [project])
  })
  const [{ requireDb }, dirty, program, cache] = await Promise.all([
    import('../../src/db'), import('../../src/server/dispatcher-task-index-dirty'), import('../../src/server/line-program'),
    import('../../src/server/line-program-overview-cache'),
  ])
  let wideReads = 0
  const original = pg.Client.prototype.query
  pg.Client.prototype.query = function (this: pg.Client, ...args: Parameters<typeof original>) {
    const query = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string })?.text ?? ''
    if (/select/i.test(query) && query.includes('"weld_joints"."joint"') && query.includes('join "line_programs"')) wideReads++
    return Reflect.apply(original, this, args)
  } as typeof original
  const request = { tab: 'lines' as const, search: project.toLowerCase() }
  const saved = () => withE2eDatabase(async db => (await db.query(
    `select payload,source_revision,computed_at from derived_calculation_cache
     where cache_key like 'line-program-overview:%' order by cache_key`,
  )).rows)
  const summary = (value: Awaited<ReturnType<typeof program.loadLineProgramSection>>) => value.rows.map(row => ({ ...row }))
  const mutate = async (query: ReturnType<typeof sql>, scopes: ReturnType<typeof scope>[]) => requireDb().transaction(async tx => {
    await tx.execute(query)
    await dirty.markDispatcherTaskIndexDirty(tx, { scopes })
  })
  try {
    const initial = await program.loadLineProgramSection(request)
    expect(initial.rows).toHaveLength(3)
    expect(wideReads).toBe(1)
    const oldCache = await saved()
    expect(oldCache).toHaveLength(3)
    await mutate(sql`update weld_joints set has_rk='да' where project_title=${project} and line='A'`, [scope('A')])
    const retained = await saved()
    expect(retained).toHaveLength(2)
    expect(retained.map(row => row.payload).sort()).toEqual(oldCache.filter(row => JSON.parse(row.payload).identityKey !== getLineProgramIdentityKey(scope('A'))).map(row => row.payload).sort())
    wideReads = 0
    const changed = await program.loadLineProgramSection(request)
    expect(wideReads).toBe(1)
    expect(changed.rows.find(row => row.line === 'A')?.overview.common?.covered).toBe(1)
    for (const line of ['B', 'C']) expect(changed.rows.find(row => row.line === line)).toEqual(initial.rows.find(row => row.line === line))

    // Publication of derived final status must not throw away these independent
    // full-line summaries; ordinary aggregate caches are still invalidated.
    await dirty.invalidateDerivedCalculationCache(requireDb(), { preserveLineOverviews: true })
    wideReads = 0
    expect(summary(await program.loadLineProgramSection(request))).toEqual(summary(changed))
    expect(wideReads).toBe(0)
    const currentCache = await saved()
    await cache.writeLineProgramOverviewCache(initial.revision, oldCache.map(row => JSON.parse(row.payload)))
    expect(await saved()).toEqual(currentCache) // late old result cannot overwrite/promote

    await mutate(sql`update weld_joints set line='B',joint='F911',line_program_id=(select id from line_programs where project_title=${project} and line='B')
      where project_title=${project} and line='A'`, [scope('A'), scope('B')])
    expect((await saved()).map(row => JSON.parse(row.payload).identityKey)).toEqual([getLineProgramIdentityKey(scope('C'))])
    wideReads = 0
    const moved = await program.loadLineProgramSection(request)
    expect(wideReads).toBe(1)
    expect(moved.rows.find(row => row.line === 'A')?.overview.joints).toBe(0)
    expect(moved.rows.find(row => row.line === 'B')?.overview.joints).toBe(2)
    await mutate(sql`delete from weld_joints where project_title=${project} and line='B'`, [scope('B')])
    wideReads = 0
    const deleted = await program.loadLineProgramSection(request)
    expect(wideReads).toBe(1)
    expect(deleted.rows.find(row => row.line === 'B')?.overview.joints).toBe(0)
    expect(deleted.rows.find(row => row.line === 'C')).toEqual(initial.rows.find(row => row.line === 'C'))

    await dirty.markDispatcherTaskIndexDirty(requireDb())
    expect(await saved()).toEqual([])
    wideReads = 0
    expect(summary(await program.loadLineProgramSection(request))).toEqual(summary(deleted))
    expect(wideReads).toBe(1)
  } finally { pg.Client.prototype.query = original }
})

test('a late cache writer waiting behind a mutation cannot publish against the new revision', async () => {
  const [{ requireDb }, derived] = await Promise.all([import('../../src/db'), import('../../src/server/derived-calculation-cache')])
  await derived.getOrComputeDerivedCalculation('e2e-cache-revision-race', async () => 'before')
  let write: Promise<void> | undefined
  await withE2eDatabase(async db => {
    await db.query('begin')
    try {
      const previous = (await db.query('select source_revision from derived_calculation_state where id=1 for update')).rows[0].source_revision
      write = derived.writeDerivedCalculationCache(previous, [{ cacheKey: 'e2e-cache-revision-race', payload: '"late"' }])
      await expect.poll(async () => {
        // PostgreSQL retains a statistics snapshot inside a transaction. Refresh
        // the observer, otherwise its first pre-wait sample never sees the lock.
        await db.query('select pg_stat_clear_snapshot()')
        return (await db.query(`select count(*)::int n from pg_stat_activity
          where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock'
          and query like '%derived_calculation_state%for update%'`)).rows[0].n
      }).toBeGreaterThan(0)
      await db.query('update derived_calculation_state set source_revision=source_revision+1 where id=1')
      await db.query('delete from derived_calculation_cache')
      await db.query('commit')
    } catch (error) { await db.query('rollback'); await write; throw error }
  })
  await write
  expect(await withE2eDatabase(async db => (await db.query("select * from derived_calculation_cache where cache_key='e2e-cache-revision-race'")).rows)).toEqual([])
  expect(await derived.getOrComputeDerivedCalculation('e2e-cache-revision-race', async () => 'after')).toBe('after')
  // Keep the local module's pool initialized, never replace it or its DB URL.
  expect(requireDb()).toBeDefined()
})
