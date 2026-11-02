import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { lnkActionRow } from './lnk-grid-helpers'
import { rpcName } from '../rpc'

const project = 'E2E уведомления сохранения'
const line = 'E2E-TOAST-LINE', joint = 'F9871'

async function expectToast(page: Page, info: TestInfo, text: string | RegExp, step: string) {
  const toast = page.getByRole('status').filter({ hasText: text })
  await expect(toast).toBeVisible()
  await expect(toast).toBeInViewport()
  await expect.poll(async () => {
    const box = await toast.boundingBox()
    return box ? Math.max(Math.abs(page.viewportSize()!.width - box.x - box.width - 8), Math.abs(page.viewportSize()!.height - box.y - box.height - 8)) : Infinity
  }).toBeLessThan(2)
  await expect(toast.getByRole('button', { name: 'Закрыть уведомление' })).toBeVisible()
  await page.screenshot({ path: info.outputPath(`${step}.png`) })
  await toast.getByRole('button', { name: 'Закрыть уведомление' }).click()
  await expect(toast).toHaveCount(0)
}

async function latestAudit() {
  return withE2eDatabase(async db => {
    const { rows } = await db.query(`select id,entity,kind,changes,operation_id from audit_changes where operation_id=(
      select operation_id from audit_changes where entity='weld_joints' and joint_id=(
        select id from weld_joints where project_title=$1 and joint=$2) order by id desc limit 1) order by id`, [project, joint])
    return rows
  })
}

test('success notifications remain visible in the lower-right corner after joint, NK request and NK result saves', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('/journal')
    await page.getByRole('button', { name: 'Новый стык', exact: true }).click()
    const editor = page.getByRole('dialog')
    for (const [label, value] of [['Проект', project], ['Шифр', 'TOAST'], ['Линия', line], ['Стык', joint]]) {
      await editor.getByRole('textbox', { name: label, exact: true }).fill(value)
    }
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(editor).toBeHidden()
    await expectToast(page, info, 'Запись сохранена', 'joint-created')
    expect((await latestAudit()).find(row => row.entity === 'weld_joints')?.changes.projectTitle.origin).toBe('user')

    // Prepare only this disposable fixture for the NK workflow. Joint creation,
    // request creation and result saving themselves use their actual UI paths.
    await withLineProgramFixture(async db => {
      const result = await db.query(`update weld_joints set weld_date='2026-10-19',has_vik='да',
        psto_required='нет',connection_type='С17',d1=108,t1=4,officiality='действующий',revision_actuality='актуальная'
        where project_title=$1 and joint=$2 returning id`, [project, joint])
      expect(result.rows).toHaveLength(1)
    })
    await page.goto('/lnk')
    // The ordinary suite keeps other projects. Find this joint through the
    // report UI instead of assuming its row is in the initial virtual window.
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
    await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
    const row = await lnkActionRow(page, joint)
    await row.getByRole('button', { name: 'Выполнить: Создать заявку основного НК', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Заявка ЛНК', exact: true })).toBeVisible()
    await page.getByLabel('Дата заявки', { exact: true }).fill('2026-10-20')
    await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Заявка ЛНК', exact: true })).toBeHidden()
    await expectToast(page, info, /Заявка.* создана для стыков: 1/, 'nk-request-created')
    const requestAudit = await latestAudit()
    const requestChanges = requestAudit.find(row => row.entity === 'weld_joints')!.changes
    expect(requestChanges.vikRequestDate.origin).toBe('user')
    expect(requestChanges.vikRequest.origin).toBe('automatic')
    expect(requestChanges.vikResult.origin).toBe('automatic')
    const requestDocuments = requestAudit.filter(row => row.entity === 'generated_documents' && row.kind === 'create')
    expect(requestDocuments.length).toBeGreaterThan(0)
    expect(requestDocuments.every(row => row.changes.title.origin === 'automatic')).toBe(true)

    await (await lnkActionRow(page, joint)).getByRole('button', { name: 'Выполнить: Внести результат основного НК', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК', exact: true })).toBeVisible()
    await page.getByLabel('Дата контроля', { exact: true }).fill('2026-10-21')
    await page.getByRole('dialog').getByRole('group', { name: 'Результат для всех выбранных', exact: true })
      .getByRole('button', { name: 'годен', exact: true }).click()
    await page.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК', exact: true })).toBeHidden()
    await expectToast(page, info, 'Результат ЛНК внесен для стыков: 1', 'nk-result-saved')
    await withE2eDatabase(async db => {
      const saved = (await db.query(`select vik_request_date::text,vik_conclusion_date::text,vik_result
        from weld_joints where project_title=$1 and joint=$2`, [project, joint])).rows
      expect(saved).toEqual([{ vik_request_date: '2026-10-20', vik_conclusion_date: '2026-10-21', vik_result: 'годен' }])
    })
    const audit = await latestAudit()
    const changed = audit.find(row => row.entity === 'weld_joints')!.changes
    expect(changed.vikResult).toMatchObject({ before: 'ожидает НК', after: 'годен', origin: 'user' })
    expect(changed.finalStatus.origin).toBe('automatic')
    expect(changed.vikDefectDescription.origin).toBe('automatic')
    const documents = audit.filter(row => row.entity === 'generated_documents' && row.kind === 'create')
    expect(documents.length).toBeGreaterThan(0)
    expect(documents.every(row => row.changes.title.origin === 'automatic')).toBe(true)
    const historyCalls: string[] = []
    page.on('request', request => { if (request.url().includes('/_serverFn/')) historyCalls.push(rpcName(request.url())) })
    await page.goto('/activity')
    await page.getByRole('grid', { name: 'Журнал действий' }).getByRole('button', { name: 'Подробности', exact: true }).first().click()
    const history = page.getByRole('dialog')
    const userChanges = history.getByRole('region', { name: 'Изменения пользователя' })
    await expect(userChanges.getByText('годен', { exact: true })).toBeVisible()
    await expect(userChanges.getByText('ДНО', { exact: true })).toHaveCount(0)
    const automatic = history.getByRole('button', { name: /Автоматические изменения/ })
    await expect(automatic).toHaveAttribute('aria-expanded', 'false')
    await expect(history.getByRole('button', { name: /^Документ ·/ })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath('activity-user-first.png') })
    await automatic.click()
    await expect(history.getByRole('button', { name: /^Документ ·/ }).first()).toBeVisible()
    await expect(history.getByText('Обновлён состав связанных документов.')).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await history.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await automatic.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('activity-automatic-mobile.png') })
    expect(historyCalls.filter(name => name.startsWith('getActivityDetails'))).toHaveLength(1)
    expect(await latestAudit()).toEqual(audit)
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project])
  }
})
