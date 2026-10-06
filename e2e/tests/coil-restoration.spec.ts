import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { E2E_DATABASE_URL, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

test('отмена ошибочной катушки: транзакция, устаревший расчёт, повтор и ограниченное число SQL', async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-coil-restoration.ts'], {
    env: { ...process.env, FORCE_COLOR: undefined, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
  })
  expect(stderr).toBe('')
  const result = JSON.parse(stdout.trim())
  expect(result).toMatchObject({ restored: true, staleRejected: true, atomicRollback: true, concurrentIdempotence: true })
  expect(result.queries[0]).toBe(result.queries[1])
})

for (const final of ['original', 'renamed-repair', 'mixed-actuality'] as const) test(`диспетчер: отмена/подтверждение восстановления, финал ${final}`, async ({ page }) => {
  const project = `E2E coil restoration UI ${final}`, lineName = `RESTORE-UI-${final}`
  const rootId = await withE2eDatabase(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'C',$2,'II','A',10,0) returning id`, [project, lineName])
    const { rows } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,stamp_1_k,has_vik,vik_result,has_uzk,uzk_result,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,$2,'C',$3,'S'||(1990+n),'С17','2026-09-01','A','да','годен','да','годен','II','A',10,0 from generate_series(1,24) n returning id`, [line.id, project, lineName])
    const root = rows[0].id
    const { rows: coils } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint) values
      ($1,$2,'C',$3,'S1991Y1'),($1,$2,'C',$3,'S1991Y2') returning id`, [line.id, project, lineName])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,replaced_by_coil,replacement_coil_ids) values ($1,'primary',$1,true,$2)`, [root, coils.map(row => row.id)])
    for (const [index, coil] of coils.entries()) await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side) values ($1,'coil',$1,$2,$2,$3)`, [coil.id, root, index + 1])
    await db.query('delete from weld_joints where id=any($1::int[])', [coils.map(row => row.id)])
    if (final !== 'original') {
      await db.query(`update weld_joints set uzk_result='ремонт' where id=$1`, [root])
      let sourceId = root
      if (final === 'mixed-actuality') {
        const { rows: [middle] } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,stamp_1_k,has_vik,vik_result,has_uzk,uzk_result,revision_actuality)
          values ($1,$2,'C',$3,'S1991R1','С17','2026-09-02','A','да','годен','да','ремонт','не актуален') returning id`, [line.id, project, lineName])
        await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id) values ($1,'repair',$2,$2)`, [middle.id, root])
        sourceId = middle.id
      }
      const { rows: [repair] } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,stamp_1_k,has_vik,vik_result,has_uzk,uzk_result,category,group_name,weld_control_percent,pvk_control_percent)
        values ($1,$2,'C',$3,$4,'С17','2026-09-03','A','да','годен','да','годен','II','A',10,0) returning id`, [line.id, project, lineName, final === 'renamed-repair' ? 'S100' : 'S1991R2'])
      await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id) values ($1,'repair',$2,$3)`, [repair.id, root, sourceId])
    }
    await db.query(`update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,updated_at=now() where id=1`)
    return root
  })
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  try {
    await page.goto('/line-program')
    await page.getByLabel('Поиск программы линий').fill(lineName)
    await expect(page.getByText('СП-04 · Нарушена целостность цепочки.', { exact: false })).toBeVisible()
    await expect(page.getByTestId('program-finished-label')).toHaveCount(0)
    for (const name of ['Сводка по линиям', 'Сводка по клеймам']) {
      await page.getByRole('button', { name: 'Показать', exact: true }).click()
      await page.getByRole('button', { name, exact: true }).click()
      const report = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
      await expect(report.frameLocator('iframe').getByText('СП-04: нарушена целостность физической цепочки', { exact: false })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(report).toBeHidden()
    }
    await page.goto('/lnk')
    await page.getByLabel('Диспетчер задач', { exact: true }).getByRole('button', { name: 'Открыть диспетчер' }).click()
    const workspace = page.getByRole('dialog', { name: 'Диспетчер задач', exact: true })
    await workspace.getByRole('textbox', { name: 'Поиск задач диспетчера' }).fill('СП-04')
    await workspace.getByRole('button', { name: 'Найти', exact: true }).click()
    const open = workspace.getByRole('button', { name: 'Проверить отмену ошибочной катушки', exact: true })
    await open.click()
    const dialog = page.getByRole('dialog', { name: 'Отменить ошибочно внесённую катушку', exact: true })
    if (final === 'mixed-actuality') {
      await expect(dialog.getByText('Сначала согласуйте актуальность', { exact: false })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Восстановить исходное соединение', exact: true })).toBeDisabled()
      await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
      await page.keyboard.press('Escape')
      await expect(workspace).toBeHidden()
      await page.locator(`tr[data-weld-row-id="${rootId}"]`).getByRole('button', { name: 'S1991', exact: true }).click()
      const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Картина стыка S1991', exact: true }) })
      await picture.locator('aside').getByRole('button', { name: 'Вернуть актуальность цепочке', exact: true }).click()
      const actuality = page.getByRole('dialog', { name: 'Вернуть актуальность цепочке', exact: true })
      await expect(actuality.getByText('Записей в цепочке:', { exact: false })).toContainText('3. Будет изменено: 1')
      await actuality.getByRole('checkbox').check()
      await actuality.getByRole('button', { name: 'Подтвердить актуальность цепочки' }).click()
      await expect(actuality).toBeHidden()
      await picture.getByRole('button', { name: 'Закрыть', exact: true }).click()
      expect(await withE2eDatabase(async db => (await db.query('select replaced_by_coil from weld_joint_program_states where weld_joint_id=$1', [rootId])).rows[0].replaced_by_coil)).toBe(true)
      await page.getByLabel('Диспетчер задач', { exact: true }).getByRole('button', { name: 'Открыть диспетчер' }).click()
      await workspace.getByRole('textbox', { name: 'Поиск задач диспетчера' }).fill('СП-04')
      await workspace.getByRole('button', { name: 'Найти', exact: true }).click()
      await open.click()
    }
    await expect(dialog.getByText('Физические соединения:', { exact: false })).toContainText('23 → 24')
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    expect(calls.filter(name => name.startsWith('previewCoilRestoration_'))).toHaveLength(final === 'mixed-actuality' ? 2 : 1)
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(await withE2eDatabase(async db => (await db.query('select replaced_by_coil from weld_joint_program_states where weld_joint_id=$1', [rootId])).rows[0].replaced_by_coil)).toBe(true)
    await open.click()
    await expect(dialog.getByText('Физические соединения:', { exact: false })).toContainText('23 → 24')
    const save = dialog.getByRole('button', { name: 'Восстановить исходное соединение', exact: true })
    await expect(save).toBeDisabled()
    await expect(dialog.getByLabel('ФИО подтвердившего', { exact: true })).toHaveCount(0)
    await dialog.getByRole('checkbox').check()
    await save.click()
    await expect(dialog).toBeHidden()
    expect(calls.filter(name => name.startsWith('restoreErroneousCoil_'))).toHaveLength(1)
    expect(await withE2eDatabase(async db => (await db.query('select count(*)::int as count from coil_restoration_events where source_weld_joint_id=$1', [rootId])).rows[0].count)).toBe(1)
    await page.goto('/line-program')
    await page.getByLabel('Поиск программы линий').fill(lineName)
    await expect(page.getByTestId('program-finished-label')).toBeVisible()
    await expect(page.getByText('СП-04 · Нарушена целостность цепочки.', { exact: false })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project])
  }
})
