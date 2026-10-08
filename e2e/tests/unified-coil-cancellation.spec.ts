import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

test('одна отмена: препятствия, возврат из ЛНК и отдельное восстановление в том же окне', async ({ page }) => {
  const project = 'E2E unified coil cancellation'
  const { rootId, sideIds } = await withE2eDatabase(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'C','UNIFIED-COIL','II','A',10,0) returning id`, [project])
    const { rows: [root] } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,d1,d2,has_vik,vik_result)
      values ($1,$2,'C','UNIFIED-COIL','S890','С17','2026-09-01',219,219,'да','годен') returning id`, [line.id, project])
    const { rows: sides } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,d1,d2,has_vik,updated_at)
      select $1,$2,'C','UNIFIED-COIL','S890Y'||n,'С17',219,219,'да',now()+interval '1 second' from generate_series(1,2) n returning id`, [line.id, project])
    await db.query(`update weld_joints set weld_date='2026-09-02',vik_request='Ошибочная заявка катушки',vik_request_date='2026-09-02' where id=$1`, [sides[0].id])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,replaced_by_coil,replacement_coil_ids)
      values ($1,'primary',$1,true,$2)`, [root.id, sides.map(row => row.id)])
    for (const [index, side] of sides.entries()) await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side)
      values ($1,'coil',$1,$2,$2,$3)`, [side.id, root.id, index + 1])
    await db.query(`insert into dispatcher_accepted_warnings(key,weld_joint_id,kind,code,title,context)
      values ($1,$2,'early-coil','v2:СП-09','Досрочная врезка катушки S890Y1 + S890Y2',$3)`, [`early-coil:${root.id}`, root.id, project])
    return { rootId: root.id as number, sideIds: sides.map(row => row.id as number) }
  })
  const state = () => withE2eDatabase(async db => ({
    replaced: (await db.query('select replaced_by_coil from weld_joint_program_states where weld_joint_id=$1', [rootId])).rows[0].replaced_by_coil,
    accepted: (await db.query('select key from dispatcher_accepted_warnings where key=$1', [`early-coil:${rootId}`])).rowCount,
    sides: (await db.query('select id from weld_joints where id=any($1::int[])', [sideIds])).rowCount,
    events: (await db.query('select token from coil_restoration_events where source_weld_joint_id=$1', [rootId])).rowCount,
  }))
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  const count = (name: string) => calls.filter(call => call.startsWith(`${name}_`)).length
  try {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Правила и проверки', exact: true }).click()
    await page.getByRole('tab', { name: 'Принятые исключения', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Поиск принятых исключений' }).fill(project)
    await page.getByRole('button', { name: 'Отменить решение', exact: true }).click()
    const cancellation = page.getByRole('dialog', { name: 'Отмена решения о досрочной катушке', exact: true })
    await expect(cancellation.getByRole('button', { name: 'Открыть НК сторон' })).toBeVisible()
    await expect(cancellation.getByRole('button', { name: 'Подтвердить отмену' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Исправить ошибочное решение' })).toHaveCount(0)
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    expect(count('previewEarlyCoilCorrection')).toBe(1)
    expect(count('cancelErroneousEarlyCoil')).toBe(0)
    await cancellation.getByRole('button', { name: 'Открыть НК сторон' }).click()
    await expect(page).toHaveURL(/\/lnk$/)
    await expect(page.locator(`tr[data-weld-row-id="${sideIds[0]}"]`)).toBeVisible()
    await page.getByRole('button', { name: 'Вернуться к исправлению катушки' }).click()
    await expect(cancellation.getByRole('button', { name: 'Подтвердить отмену' })).toBeDisabled()
    await expect(cancellation.getByText('Проверяем сохранённую цепочку и расчёт…')).toBeHidden()
    expect(count('previewEarlyCoilCorrection')).toBe(2)
    // Simulate an error correction saved by another operator. The wizard must
    // derive its checklist again; no local checkbox can bypass saved facts.
    await withE2eDatabase(db => db.query('update weld_joints set vik_request=null,vik_request_date=null,weld_date=null where id=$1', [sideIds[0]]))
    await cancellation.getByRole('button', { name: 'Повторить проверку' }).click()
    await expect(cancellation.getByText(/Стороны ранее редактировали/)).toBeVisible()
    await page.setViewportSize({ width: 1100, height: 720 })
    const footer = cancellation.locator('footer')
    const box = await footer.boundingBox()
    expect(box!.y + box!.height).toBeLessThanOrEqual(720)
    await cancellation.screenshot({ path: '/private/tmp/welding-unified-coil-cancellation.png' })
    expect(await state()).toEqual({ replaced: true, accepted: 1, sides: 2, events: 0 })
    await cancellation.getByRole('checkbox').check()
    await cancellation.getByRole('button', { name: 'Подтвердить отмену' }).click()
    const restoration = page.getByRole('dialog', { name: 'Отменить ошибочно внесённую катушку', exact: true })
    await expect(restoration.getByText(/Решение отменено. Исходное соединение ещё не восстановлено/)).toBeVisible()
    await expect(restoration.getByText('3. Исходная цепочка — готова к подтверждению')).toBeVisible()
    await expect(restoration.getByRole('checkbox')).not.toBeChecked()
    await expect(restoration.getByRole('button', { name: 'Восстановить исходное соединение' })).toBeDisabled()
    expect(await state()).toEqual({ replaced: true, accepted: 0, sides: 0, events: 1 })
    expect(count('cancelErroneousEarlyCoil')).toBe(1)
    expect(count('previewCoilRestoration')).toBe(1)
    expect(count('restoreErroneousCoil')).toBe(0)
    await restoration.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await page.getByRole('button', { name: 'Вернуться к исправлению катушки' }).click()
    await expect(restoration.getByRole('checkbox')).not.toBeChecked()
    await restoration.getByRole('checkbox').check()
    await restoration.getByRole('button', { name: 'Восстановить исходное соединение' }).click()
    await expect(restoration).toBeHidden()
    expect(await state()).toEqual({ replaced: false, accepted: 0, sides: 0, events: 2 })
    expect(count('restoreErroneousCoil')).toBe(1)
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project])
  }
})
