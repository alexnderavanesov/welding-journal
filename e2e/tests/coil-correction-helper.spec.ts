import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { E2E_DATABASE_URL, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { clearLnkRequestPosition, deleteWeldJoints } from '@/server/weld-mutations'

const project = 'Демо — исправление ошибочной катушки'
test('обычное удаление сторон с заявками: отмена, обе стороны, сохранённая цепочка и видимая СП-04', async ({ page }) => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/seed-local-coil-correction-demo.ts', '--seed-test'], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' }, timeout: 30_000,
  })
  const { summary } = JSON.parse(stdout) as { summary: { rootId: number; rows: { id: number; joint: string }[] } }
  const sides = summary.rows.filter(row => /Y[12]$/.test(row.joint)), sideIds = sides.map(row => row.id)
  const sourceIds = summary.rows.filter(row => !sideIds.includes(row.id)).map(row => row.id)
  const source = () => withE2eDatabase(async db => (await db.query('select * from weld_joints where id=any($1::int[]) order by id', [sourceIds])).rows)
  const remaining = () => withE2eDatabase(async db => (await db.query('select id,vik_request from weld_joints where id=any($1::int[]) order by id', [sideIds])).rows)
  const before = await source(), beforeSides = await remaining(), errors: string[] = []
  expect(beforeSides.every(row => Boolean(row.vik_request))).toBe(true)
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('/journal')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    const confirmation = page.locator('[data-confirm-action-dialog="true"]').locator('..')
    const first = page.locator(`tr[data-weld-row-id="${sides[0].id}"]`)
    await first.getByRole('button', { name: 'Удалить', exact: true }).click()
    await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(await remaining()).toEqual(beforeSides)
    for (const side of sides) {
      const row = page.locator(`tr[data-weld-row-id="${side.id}"]`)
      await row.getByRole('button', { name: 'Удалить', exact: true }).click()
      await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
      await expect(row).toHaveCount(0)
    }
    expect(await remaining()).toEqual([])
    expect(await source()).toEqual(before)
    const persisted = await withE2eDatabase(async db => ({
      links: (await db.query('select * from generated_document_weld_joints where weld_joint_id=any($1::int[])', [sideIds])).rows,
      root: (await db.query('select replaced_by_coil,replacement_coil_ids from weld_joint_program_states where weld_joint_id=$1', [summary.rootId])).rows[0],
      events: (await db.query('select * from coil_restoration_events where source_weld_joint_id=$1', [summary.rootId])).rows,
    }))
    expect(persisted.links).toEqual([])
    expect(persisted.root).toEqual({ replaced_by_coil: true, replacement_coil_ids: sideIds })
    expect(persisted.events).toEqual([])
    await page.getByLabel('Диспетчер задач', { exact: true }).getByRole('button', { name: 'Открыть диспетчер' }).click()
    const dispatcher = page.getByRole('dialog', { name: 'Диспетчер задач', exact: true })
    await dispatcher.getByRole('textbox', { name: 'Поиск задач диспетчера' }).fill('СП-04')
    await dispatcher.getByRole('button', { name: 'Найти', exact: true }).click()
    await dispatcher.getByRole('button', { name: 'Проверить отмену ошибочной катушки', exact: true }).click()
    const helper = page.getByRole('dialog', { name: 'Отменить ошибочно внесённую катушку', exact: true })
    await expect(helper.getByText('2. Ошибочная катушка — записи сторон удалены')).toBeVisible()
    await expect(helper.getByText('3. Исходная цепочка — нужны исправления')).toBeVisible()
    await expect(helper.getByRole('button', { name: 'Восстановить исходное соединение' })).toBeDisabled()
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project])
    await withE2eDatabase(db => db.query("delete from welder_stamps where naks_stamp='DCK1'"))
  }
})

test('помощник: переходы, удаление сторон, исправление финала, отмена и восстановление без ФИО', async ({ page }) => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/seed-local-coil-correction-demo.ts', '--seed-test'], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' }, timeout: 30_000,
  })
  const { summary } = JSON.parse(stdout) as { summary: { rootId: number; rows: { id: number; joint: string }[] } }
  const rootId = summary.rootId, sides = summary.rows.filter(row => /Y[12]$/.test(row.joint))
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  const helper = page.getByRole('dialog', { name: 'Отменить ошибочно внесённую катушку', exact: true })
  const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Картина стыка F902', exact: true }) })
  const loadRoot = () => withE2eDatabase(async db => (await db.query('select replaced_by_coil from weld_joint_program_states where weld_joint_id=$1', [rootId])).rows[0].replaced_by_coil)
  let hasOpened = false
  async function openHelper() {
    if (hasOpened) await page.getByRole('button', { name: 'Вернуться к исправлению катушки', exact: true }).click()
    else {
      await page.goto('/journal')
      await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
      await page.locator(`tr[data-weld-row-id="${rootId}"]`).getByRole('button', { name: 'F902', exact: true }).click()
      await picture.getByRole('button', { name: 'Исправить ошибочную катушку', exact: true }).click()
      hasOpened = true
    }
    await expect(helper.getByRole('region', { name: 'Шаги исправления ошибочной катушки' })).toBeVisible()
  }
  try {
    await openHelper()
    await expect(helper.getByText('1. Документы и факты сторон — нужна проверка')).toBeVisible()
    await expect(helper.getByRole('button', { name: 'История отмен ошибочной катушки' })).toHaveCount(0)
    await expect(helper.getByLabel('ФИО подтвердившего')).toHaveCount(0)
    await expect(helper.getByRole('button', { name: 'Восстановить исходное соединение' })).toBeDisabled()
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    expect(calls.filter(name => name.startsWith('previewCoilRestoration_'))).toHaveLength(1)
    expect(calls.filter(name => name.startsWith('getCoilRestorationHistory_'))).toHaveLength(1)
    await helper.getByRole('button', { name: 'Открыть НК сторон' }).click()
    await expect(helper).toBeHidden()
    await expect(picture).toBeHidden()
    await expect(page).toHaveURL(/\/lnk$/)
    for (const side of sides) await expect(page.locator(`tr[data-weld-row-id="${side.id}"]`)).toBeVisible()
    expect(await loadRoot()).toBe(true)
    // Use the existing dedicated workflow, not raw field updates: the helper is
    // navigation only. Its next opening must pick up changes from another client.
    for (const side of sides) {
      const saved = await withE2eDatabase(async db => (await db.query('select xmin::text as version,vik_request,vik_request_date::text from weld_joints where id=$1', [side.id])).rows[0])
      await clearLnkRequestPosition({ data: { rowId: side.id, expectedVersion: saved.version, methodKey: 'vikRequest', requestName: saved.vik_request, requestDate: saved.vik_request_date } })
    }
    await openHelper()
    await expect(helper.getByText('1. Документы и факты сторон — препятствий не найдено')).toBeVisible()
    await expect(helper.getByText('2. Ошибочная катушка — осталось записей: 2')).toBeVisible()
    await helper.getByRole('button', { name: 'Открыть стороны в журнале' }).click()
    const targets = await withE2eDatabase(async db => (await db.query('select id,xmin::text as version from weld_joints where id=any($1::int[])', [sides.map(row => row.id)])).rows)
    await deleteWeldJoints({ data: { targets } })
    expect(await loadRoot()).toBe(true)
    await openHelper()
    await expect(helper.getByText('2. Ошибочная катушка — записи сторон удалены')).toBeVisible()
    await expect(helper.getByText('3. Исходная цепочка — нужны исправления')).toBeVisible()
    await helper.getByRole('button', { name: 'Открыть НК исходной цепочки' }).click()
    await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
    await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
    const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование результатов ЛНК', exact: true }) })
    await manager.getByLabel('Вид контроля в реестре').selectOption('vikRequest')
    await manager.getByRole('button', { name: /Л-КАТ · F902R2W1/ }).click()
    await manager.getByRole('button', { name: 'годен', exact: true }).last().click()
    await manager.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
    await expect(manager).toBeHidden()
    expect(await loadRoot()).toBe(true)
    await openHelper()
    await expect(helper.getByText('3. Исходная цепочка — готова к подтверждению')).toBeVisible()
    await expect(helper.getByText('Физические соединения:', { exact: false })).toContainText('0 → 1')
    await helper.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(await loadRoot()).toBe(true)
    await openHelper()
    await helper.getByRole('checkbox').check()
    await helper.getByRole('button', { name: 'Восстановить исходное соединение' }).click()
    await expect(helper).toBeHidden()
    expect(await loadRoot()).toBe(false)
    await expect(page.getByRole('button', { name: 'Вернуться к исправлению катушки', exact: true })).toHaveCount(0)
    await page.locator(`tr[data-weld-row-id="${rootId}"]`).getByRole('button', { name: 'F902', exact: true }).click()
    await expect(picture.getByRole('button', { name: 'Исправить ошибочную катушку' })).toHaveCount(0)
    await picture.getByRole('button', { name: 'История отмен ошибочной катушки' }).click()
    await expect(picture.getByText(/подтверждено исправление ошибочной записи катушки, 0 → 1 соединений/)).toBeVisible()
    expect(await withE2eDatabase(async db => (await db.query('select confirmed_by from coil_restoration_events where source_weld_joint_id=$1', [rootId])).rows)).toEqual([{ confirmed_by: '' }])
    expect(calls.filter(name => name.startsWith('restoreErroneousCoil_'))).toHaveLength(1)
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project])
    await withE2eDatabase(db => db.query("delete from welder_stamps where naks_stamp='DCK1'"))
  }
})
