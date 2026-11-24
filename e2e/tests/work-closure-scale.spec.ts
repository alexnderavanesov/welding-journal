import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { auditSqlCount } from '../audit-sql'
import { assertSafeE2eDatabaseUrl, withE2eDatabase } from '../database'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'
import { withClosureColumnFilters } from '../../src/lib/work-closures'

test('закрытия: фильтр и сводка по всей выборке, пакетное чтение и запись на 200000 стыков', async ({ page, baseURL }) => {
  test.skip(process.env.E2E_CLOSURE_SCALE !== '1', 'Отдельный профиль изолированной базы с подсчётом SQL')
  test.setTimeout(360_000)
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  const project = 'E2E closure scale'
  const actNumber = 'E2E-SCALE-01'
  let endpoint = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) endpoint = request.url() })
  await page.goto('/account?tab=profile')
  await expect(page.getByRole('heading', { name: 'Мой профиль' })).toBeVisible()
  const counts = new Map<string, number>()
  async function measure<T>(name: string, data: unknown, joints: number) {
    const url = siblingRpcUrl(endpoint, name + '_createServerFn_handler')
    const before = await auditSqlCount(url)
    const start = performance.now()
    const response = await page.request.post(url, { data: await serializeRpcData(data), headers: {
      origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true',
    } })
    const body = await deserializeRpcResponse(await response.text()) as { result: T; error?: Error }
    const ms = Math.round(performance.now() - start)
    expect(response.ok()).toBe(true)
    expect(body.error).toBeUndefined()
    const after = await auditSqlCount(url)
    if (before === undefined || after === undefined) throw new Error('Нужен локальный счётчик SQL')
    const sql = after - before
    console.log(JSON.stringify({ closureScale: { joints, name, sql, ms } }))
    expect(sql).toBeGreaterThan(0)
    const first = counts.get(name)
    if (first !== undefined) {
      // Audit batches 500 details per insert. There must be no query per position.
      expect(sql).toBeLessThanOrEqual(first + (name === 'saveBulkWorkClosures' ? 20 : 2))
    }
    counts.set(name, sql)
    return body.result
  }
  const filters = withClosureColumnFilters({}, { workType: ['Сварка'], actNumber: [actNumber] })
  try {
    let previous = 0
    for (const size of [10, 200_000]) {
      const ids = await withE2eDatabase(async db => {
        await db.query(`with added as (
          insert into weld_joints(project_title,subtitle_code,line,joint) select $1,'S','LINE-'||(n%400),'F'||n
          from generate_series($2::int,$3::int) n returning id
        ) insert into work_closures(weld_joint_id,work_type,rate_code,act_number)
          select id,kind,case when kind='Сварка' then 'A' else 'B' end,$4 from added cross join unnest(array['Сварка','РК']) kind`,
        [project, previous + 1, size, actNumber])
        await db.query('analyze weld_joints')
        await db.query('analyze work_closures')
        return (await db.query<{id: number}>('select id from weld_joints where project_title=$1 order by id desc limit $2', [project, size === 10 ? 1 : 1000])).rows.map(row => row.id)
      })
      previous = size
      const facet = await measure<{ options: { value: string; count: number }[] }>('readWorkClosureFacet', { columnFilters: filters, dimension: 'rateCode' }, size)
      expect(facet.options).toEqual([{ value: 'A', count: size }])
      const summary = await measure<{ subtotal: boolean; joints: number }[]>('readWorkClosureSummary', { columnFilters: filters, dimension: 'actNumber' }, size)
      expect(summary.map(row => [row.subtotal, row.joints])).toEqual([[true, size], [false, size]])
      const positions = await measure<{ rows: unknown[] }>('readWorkClosures', { ids }, size)
      expect(positions.rows).toHaveLength(ids.length * 2)
      const changes = ids.map(weldJointId => ({ weldJointId, workType: 'ВИК', before: null, after: { workType: 'ВИК', rateCode: 'C', actNumber: '' } }))
      expect((await measure<{ count: number }>('saveBulkWorkClosures', { changes }, size)).count).toBe(ids.length)
    }
  } finally {
    await cleanupLineProgramProjects([project])
  }
})
