import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { DEFAULT_DISPATCHER_SETTINGS } from '../../src/lib/dispatcher-settings'

const project = 'E2E coil repair boundary', line = 'COIL-BOUNDARY', joint = 'F811Y1'
let dispatcher: { value: string; updated_at: Date } | undefined
let dataList: { value: string; updated_at: Date } | undefined

test.afterEach(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    if (dispatcher) await db.query(`update app_settings set value=$1,updated_at=$2 where key='dispatcher'`, [dispatcher.value, dispatcher.updated_at])
    else await db.query(`delete from app_settings where key='dispatcher'`)
    if (dataList) await db.query(`update app_settings set value=$1,updated_at=$2 where key='data-list'`, [dataList.value, dataList.updated_at])
    else await db.query(`delete from app_settings where key='data-list'`)
    await db.query(`update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true where id=1`)
  })
})

test('ремонт катушки наследует её УЗК, но не РК и ПВК вырезанного соединения; ложного СП-03 нет', async ({ page }) => {
  const ids = await withE2eDatabase(async db => {
    dispatcher = (await db.query(`select value,updated_at from app_settings where key='dispatcher'`)).rows[0]
    dataList = (await db.query(`select value,updated_at from app_settings where key='data-list'`)).rows[0]
    await db.query(`insert into app_settings(key,value) values ('data-list',$1)
      on conflict(key) do update set value=excluded.value,updated_at=now()`, [JSON.stringify({ weldingTypes: ['РД'], connectionTypes: ['С17'], materialGroups: ['M01'] })])
    await db.query(`insert into app_settings(key,value) values ('dispatcher',$1)
      on conflict(key) do update set value=excluded.value,updated_at=now()`, [JSON.stringify(DEFAULT_DISPATCHER_SETTINGS)])
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'COIL',$2,'II','A',10,0) returning id`, [project, line])
    const { rows } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,
      category,group_name,weld_control_percent,pvk_control_percent,officiality,stamp_1_k,stamp_1_z,stamp_1_o,material_group,welding_method,d1,d2,t1,t2,wdi,
      has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date)
      select $1,$2,'COIL',$3,case when n=1 then 'F811' else 'F811Y'||(n-1) end,
        case when n=1 then date '2026-09-01' else date '2026-09-04' end,'С17','II','A',10,0,'действующий','A','A','A','M01','РД',108,108,4,4,0.42,
        'да','годен','CB-VIK-R',case when n=1 then date '2026-09-01' else date '2026-09-04' end,'CB-VIK-C',case when n=1 then date '2026-09-02' else date '2026-09-05' end
      from generate_series(1,3) n returning id,joint`, [program.id, project, line])
    await db.query(`update weld_joints set stamp_1_k_fact=stamp_1_k,stamp_1_z_fact=stamp_1_z,stamp_1_o_fact=stamp_1_o where project_title=$1`, [project])
    await db.query(`update weld_joints set has_rk='да',rk_result='вырез',rk_request='CB-RK-R',rk_request_date='2026-09-02',rk_conclusion='CB-RK-C',rk_conclusion_date='2026-09-03',
      has_pvk='да',pvk_result='годен',pvk_request='CB-PVK-R',pvk_request_date='2026-09-02',pvk_conclusion='CB-PVK-C',pvk_conclusion_date='2026-09-02'
      where project_title=$1 and joint='F811'`, [project])
    await db.query(`update weld_joints set has_uzk='да',uzk_result='ремонт',uzk_request='CB-UZK-R',uzk_request_date='2026-09-05',uzk_conclusion='CB-UZK-C',uzk_conclusion_date='2026-09-06'
      where project_title=$1 and joint=$2`, [project, joint])
    await db.query(`insert into dispatcher_task_index_state(id,source_revision,computed_revision,full_rebuild)
      values (1,1,-1,true) on conflict(id) do update set source_revision=dispatcher_task_index_state.source_revision+1,full_rebuild=true`)
    return rows as { id: number; joint: string }[]
  })
  const history = () => withE2eDatabase(async db => (await db.query(`select id,rk_result,rk_conclusion,pvk_result,pvk_conclusion,uzk_result,uzk_conclusion
    from weld_joints where id=any($1::int[]) order by id`, [ids.map(row => row.id)])).rows)
  const before = await history(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await page.locator(`tr[data-weld-row-id="${ids.find(row => row.joint === joint)!.id}"]`).getByRole('button', { name: joint, exact: true }).click()
  const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `Картина стыка ${joint}`, exact: true }) })
  await picture.getByRole('region', { name: 'Продолжение цепочки стыка' }).getByRole('button', { name: `Создать ${joint}R1`, exact: true }).click()
  const repair = () => withE2eDatabase(async db => (await db.query(`select id,has_vik,has_rk,has_uzk,has_pvk,uzk_request,uzk_conclusion from weld_joints where project_title=$1 and joint=$2`, [project, `${joint}R1`])).rows[0])
  await expect.poll(repair).toMatchObject({ has_vik: 'да', has_uzk: 'да', has_rk: null, has_pvk: null, uzk_request: null, uzk_conclusion: null })
  expect(await history()).toEqual(before)
  const created = await repair()
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect.poll(() => withE2eDatabase(async db => (await db.query('select computed_revision=source_revision as fresh from dispatcher_task_index_state where id=1')).rows[0]?.fresh)).toBe(true)
  const tasks = await withE2eDatabase(async db => (await db.query('select tasks from dispatcher_task_pages')).rows.flatMap(row => JSON.parse(row.tasks)))
  expect(tasks.filter(task => task.row?.id === created.id && task.systemWarningCode === 'СП-03')).toEqual([])
  expect(errors).toEqual([])
})
