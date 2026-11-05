import { expect, test } from '@playwright/test'
import { drizzle } from 'drizzle-orm/node-postgres'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'

const project = 'E2E T-OP 200k'
test('200k mixed records: bounded SQL, physical support norms and exact complete statistics', async () => {
  test.skip(process.env.T_OP_SCALE !== '1', 'Bounded T-21 profile, separate fresh isolated runner')
  test.setTimeout(900_000)
  try {
    await withLineProgramFixture(async db => {
      await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,support_uzk_control_percent,support_pvk_control_percent)
        select $1,'SCALE','T-SCALE-'||n,'II','A',10,10,0.5,20 from generate_series(1,1000) n`, [project])
      await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,weld_length,officiality,revision_actuality,stamp_1_k,has_vik,vik_result)
        select p.id,p.project_title,p.subtitle_code,p.line,
        case when n<=160 then 'ОП'||n when n<=180 then 'ОП'||(n-160)||'R1' else 'F'||n end,
        case when n<=180 then 'Т1' else 'С17' end,case when n>160 and n<=180 then '2026-10-02'::date else '2026-09-01'::date end,
        case when n<=180 then 600.123456789123456789 else null end,'действующий','актуальная',
        case when n>160 and n<=180 then 'REPAIR' else 'OWNER' end,'да',case when n<=20 then 'ремонт' else 'годен' end
        from line_programs p cross join generate_series(1,200) n where p.project_title=$1`, [project])
      await db.query('analyze weld_joints')
    })
    const { loadLineProgramSection, loadLineProgramRows } = await import('../../src/server/line-program')
    const pg = await import('pg'), prototype = pg.default.Client.prototype, original = prototype.query
    let calls = 0, selects = 0, wideReads = 0, maximumRows = 0
    prototype.query = function (this: unknown, ...args: unknown[]) {
      calls++
      const source = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string })?.text ?? ''
      if (/^\s*select\b/i.test(source)) selects++
      const result = (original as (...args: unknown[]) => unknown).apply(this, args)
      if (/from "weld_joints".*join "line_programs"/is.test(source) && result instanceof Promise) {
        return result.then(value => { wideReads++; maximumRows = Math.max(maximumRows, (value as { rows: unknown[] }).rows.length); return value })
      }
      return result
    } as typeof prototype.query
    try {
      const start = performance.now()
      const section = await loadLineProgramSection({ tab: 'supports', search: project.toLowerCase() })
      expect(section.rows).toHaveLength(1000)
      expect(section.rows.every(line => line.overview?.joints === 160 && line.overview?.common?.required === 1 && line.overview?.pvk?.required === 32)).toBe(true)
      const sectionCalls = calls
      expect(maximumRows).toBeLessThanOrEqual(10_000)
      expect(wideReads).toBeGreaterThan(0)
      expect(wideReads).toBeLessThanOrEqual(25)
      expect(sectionCalls).toBeLessThan(250)
      console.log(JSON.stringify({ phase: 'T-OP 200k SQL section', milliseconds: Math.round(performance.now() - start), calls, wideReads, maximumRows, lines: section.rows.length }))
      const { requireDb } = await import('../../src/db')
      const before = calls
      const detail = await loadLineProgramRows(requireDb(), { projectTitle: project, subtitleCode: 'SCALE', line: 'T-SCALE-1000' })
      expect(detail).toHaveLength(200)
      expect(calls - before).toBeLessThanOrEqual(8)

      const { loadRebuildWeldFacts } = await import('../../src/server/system-document-rebuild-facts')
      await withE2eDatabase(async client => {
        // Reuse this mixed 200k fixture. Only select enough T ids to exercise
        // both valid batch sizes and the existing pre-query 5000-row guard.
        const ids = (await client.query<{ id: number }>(`select id from weld_joints
          where project_title=$1 and connection_type='Т1' order by id limit 5001`, [project])).rows.map(row => row.id)
        expect(ids).toHaveLength(5001)
        const db = drizzle(client)
        for (const size of [1, 5000]) {
          const batch = ids.slice(0, size), beforeCalls = calls, beforeSelects = selects, started = performance.now()
          const facts = await loadRebuildWeldFacts(db as never, batch)
          expect(calls - beforeCalls).toBe(1)
          expect(selects - beforeSelects).toBe(1)
          expect(facts.map(fact => fact.row.id)).toEqual(batch)
          expect(facts.every(fact => fact.row.connectionType === 'Т1'
            && fact.row.weldLength === '600.123456789123456789')).toBe(true)
          console.log(JSON.stringify({ phase: 'T-OP 200k exact rebuild transport', ids: size,
            statements: calls - beforeCalls, selects: selects - beforeSelects, rows: facts.length,
            milliseconds: Math.round(performance.now() - started) }))
        }
        const beforeCalls = calls, beforeSelects = selects
        await expect(loadRebuildWeldFacts(db as never, ids)).rejects.toThrow('Слишком большой пакет фактов пересборки.')
        expect(calls - beforeCalls).toBe(0)
        expect(selects - beforeSelects).toBe(0)
      })
    } finally { prototype.query = original }
    const rows = await withE2eDatabase(async db => (await db.query(`select id,project_title as "projectTitle",subtitle_code as "subtitleCode",line,joint,connection_type as "connectionType",weld_date::text as "weldDate",weld_length::text as "weldLength",officiality,revision_actuality as "revisionActuality",has_vik as "hasVik",vik_result as "vikResult" from weld_joints where project_title=$1`, [project])).rows)
    const { buildSupportStatistics } = await import('../../src/lib/support-statistics')
    const stats = buildSupportStatistics(rows, '2026-09-01', '2026-10-31')
    expect(stats).toMatchObject({ physical: 160000, produced: 160000, repairs: 20000, rejected: 0, missingLength: 0,
      lengthMm: '96019753.08625975308624', repairLengthMm: '12002469.13578246913578' })
    console.log(JSON.stringify({ phase: 'T-OP 200k exact statistics', physical: stats.physical, repairs: stats.repairs, lengthMm: stats.lengthMm }))
  } finally { await cleanupLineProgramProjects([project]) }
})
