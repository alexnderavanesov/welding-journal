import type { TestInfo, test as playwrightTest } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from './line-program-fixtures'

/** Synthetic teardown only, after the test has checked real deletion/history.
 * Normal line deletion deliberately retains drawings; fixture teardown must not.
 * PDF bytes remain in the runner-owned temporary directory until runner exit. */
export async function cleanupLineSchemeProjects(projects: string[]) {
  if (!projects.length) return
  await withLineProgramFixture(async db => {
    const physicals = await db.query<{ id: number }>(`select distinct physical_id as id from (
      select p.physical_id from line_scheme_points p join line_scheme_revisions r on r.id=p.revision_id
        join line_scheme_bundles b on b.id=r.bundle_id where b.project_title=any($1::text[])
      union select m.physical_id from line_scheme_members m join weld_joints w on w.id=m.weld_joint_id
        where w.project_title=any($1::text[])
      union select p.id from line_scheme_physicals p join line_programs l on l.id=p.last_line_program_id
        where l.project_title=any($1::text[])
    ) owned`, [projects])
    await db.query('delete from line_scheme_bundles where project_title=any($1::text[])', [projects])
    if (physicals.rows.length) await db.query(`delete from line_scheme_physicals p where p.id=any($1::integer[])
      and not exists (select 1 from line_scheme_points x where x.physical_id=p.id)
      and not exists (select 1 from line_scheme_members m join weld_joints w on w.id=m.weld_joint_id
        where m.physical_id=p.id and not coalesce(w.project_title=any($2::text[]),false))`, [physicals.rows.map(row => row.id), projects])
  })
  await cleanupLineProgramProjects(projects)
}

/** Register each project's ownership before seeding so failures clean up too. */
export function schemeFixtureCleanup(test: typeof playwrightTest) {
  const projects = new Map<string, Set<string>>()
  test.afterEach(async ({ context }, info) => {
    try { await context.close() }
    finally {
      const owned = projects.get(info.testId)
      projects.delete(info.testId)
      if (owned) await cleanupLineSchemeProjects([...owned])
    }
  })
  return (info: TestInfo, project: string) => {
    const owned = projects.get(info.testId) ?? new Set<string>()
    owned.add(project); projects.set(info.testId, owned)
  }
}
