import { expect, test } from '@playwright/test'
import { eq, sql } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { DEFAULT_OTHER_SETTINGS } from '../../src/lib/other-settings'
import { buildCalculatedReportValueSql } from '../../src/server/report-calculated-values-sql'
import { buildPstoCurrentReportValueSql } from '../../src/server/psto-report-current-values'
import { assertSafeE2eDatabaseUrl } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'E2E PSTO whitespace history'
test('whitespace is not an execution fact and padded results retain the performed cycle', async () => {
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  await cleanupLineProgramProjects([project])
  try {
    await withLineProgramFixture(async db => {
      for (const assignment of ['нет', 'отменен']) {
        for (const source of ['diagram', 'result']) {
          const { rows: [row] } = await db.query<{ id: number }>(`insert into weld_joints
            (project_title,line,joint,psto_required,psto_request,psto_result,heat_treatment_diagram,tvmt_request,tvmt_result)
            values ($1,'WHITE',$2,$3,'PRIMARY',$4,$5,null,null) returning id`,
          [project, `${assignment}-${source}`, assignment, source === 'result' ? '\tпроведено\u00a0' : 'проведено', source === 'diagram' ? 'D-1' : null])
          await db.query(`insert into psto_repeat_cycles
            (weld_joint_id,sequence,psto_request,heat_treatment_diagram,tvmt_request,tvmt_conclusion)
            values ($1,2,'REQUEST-ONLY',$2,$2,$2)`, [row.id, source === 'diagram' ? '\t\n\u00a0\u2003' : null])
        }
      }
    })
    const rows = await requireDb().select({
      joint: weldJoints.joint,
      request: buildPstoCurrentReportValueSql('pstoRequest')!,
      result: buildPstoCurrentReportValueSql('pstoResult')!,
      summary: sql<string>`${buildCalculatedReportValueSql('heatTreatment', 'pstoCycleSummary', DEFAULT_OTHER_SETTINGS)!}`,
    }).from(weldJoints).where(eq(weldJoints.projectTitle, project))
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      // The only factual treatment is primary. Whitespace and a later request
      // cannot displace it when treatment is not assigned or is cancelled.
      expect(row.request, row.joint ?? 'missing joint').toBe('PRIMARY')
      expect(row.result, row.joint ?? 'missing joint').toBe(row.joint!.startsWith('отменен') ? 'проведено · назначение отменено' : 'проведено')
      expect(row.summary, row.joint ?? 'missing joint').toBe('Основной · ожидает заявку ТВМТ' + (row.joint!.startsWith('отменен') ? ' · линия отменена' : ''))
    }
  } finally { await cleanupLineProgramProjects([project]) }
})
