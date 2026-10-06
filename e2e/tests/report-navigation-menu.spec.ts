import { expect, test, type Page } from '@playwright/test'

import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'

let groupJointId: number | undefined
test.afterEach(async () => {
  if (groupJointId !== undefined) {
    await withE2eDatabase(client => client.query('delete from weld_joints where id=$1', [groupJointId]))
    groupJointId = undefined
  }
})

test.beforeEach(async () => {
  // Navigation needs an existing registry entry; don't depend on another test creating it.
  await withE2eDatabase(client => client.query("insert into line_programs (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent) values ('E2E проект','E2E-001','E2E-L1','II','A',30,10) on conflict do nothing"))
})

function jointRow(page: Page, joint = 'F1') {
  return page.locator('tr').filter({ has: page.getByRole('button', { name: joint, exact: true }) })
    .filter({ has: page.getByText('E2E проект', { exact: true }) })
}

async function findProject(page: Page) {
  // Other suites can leave more than a page of joints in this disposable DB.
  const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
  await expect(search).toBeVisible()
  await page.waitForLoadState('networkidle')
  if (await search.inputValue() !== 'E2E проект') {
    // networkidle alone can resolve before the search debounce even starts.
    // Await the actual filtered page before opening a close-on-scroll menu.
    const response = page.waitForResponse(response => {
      const url = new URL(response.url())
      return /^list(WeldingJournal|LnkReport|HeatTreatmentReport)Page_/.test(rpcName(response.url())) &&
        !!url.searchParams.get('payload')?.includes('E2E проект') && response.ok()
    })
    await search.fill('E2E проект')
    await (await response).finished()
  }
  await page.waitForLoadState('networkidle')
}

async function openRowMenu(page: Page) {
  // Cross-report navigation already filters the target joint. Do not launch
  // another debounced search while the report restores its navigation context.
  await page.waitForLoadState('networkidle')
  const cell = jointRow(page).getByText('E2E проект', { exact: true })
  // Use a visible leading cell: the row menu is shared by every column.
  // Finish scrolling before opening a menu that intentionally closes on scroll.
  await cell.scrollIntoViewIfNeeded()
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  await cell.click({ button: 'right' })
}

test('ПКМ: переходы раскрываются одной кнопкой в журнале, ЛНК и ПСТО', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/journal')
  await findProject(page)
  for (const [path, targetLabel, targetPath] of [
    ['/journal', 'Открыть в ЛНК', '/lnk'],
    ['/lnk', 'Открыть в ПСТО', '/psto'],
    ['/psto', 'Открыть в сварочном журнале', '/journal'],
  ]) {
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await openRowMenu(page)
    const navigate = page.getByRole('button', { name: 'Перейти', exact: true })
    await expect(navigate).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('button', { name: 'Картина стыка', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Открыть линию', exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: targetLabel, exact: true })).toBeHidden()

    await navigate.click()
    await expect(navigate).toHaveAttribute('aria-expanded', 'true')
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('menu').getByRole('button')).toHaveCount(4)
    await expect(page.getByRole('button', { name: 'Открыть в программе линий', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: targetLabel, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${targetPath}$`))
    await expect(jointRow(page)).toBeVisible()
    await expect(navigate).toBeHidden()
  }

  await openRowMenu(page)
  await page.getByRole('button', { name: 'Перейти', exact: true }).click()
  await page.getByRole('button', { name: 'Открыть линию', exact: true }).click()
  await expect(jointRow(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Перейти', exact: true })).toBeHidden()
  expect(errors).toEqual([])
  for (const path of ['/journal', '/lnk', '/psto']) {
    await page.goto(path)
    await findProject(page)
    await openRowMenu(page)
    await page.getByRole('button', { name: 'Перейти', exact: true }).click()
    await page.getByRole('button', { name: 'Открыть в программе линий', exact: true }).click()
    await expect(page).toHaveURL(/\/line-program$/)
    await expect(page.getByTestId('line-program').getByRole('button', { name: 'Расчёт линии E2E-L1', exact: true })).toHaveAttribute('aria-expanded', 'true')
  }
})

test('групповые переходы сохраняют счетчики и запрет открытия разных линий', async ({ page }) => {
  await withE2eDatabase(async (client) => {
    const result = await client.query(`
      insert into weld_joints (
        project_title, subtitle_code, line, isometry, joint, psto_required,
        officiality, revision_actuality, connection_type, welding_method
      ) values (
        'E2E проект', 'E2E-001', 'E2E-L2', 'ISO-E2E', 'F2', 'нет',
        'действующий', 'актуальная', 'СШ', 'РД'
      ) returning id
    `)
    groupJointId = result.rows[0].id
  })
  await page.goto('/journal')
  await findProject(page)
  await expect(jointRow(page, 'F2')).toBeVisible()
  await expect(jointRow(page, 'F1').getByText('E2E проект', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  // Only this scenario's two joints: other suites also use E2E-L* lines.
  for (const joint of ['F1', 'F2']) {
    await jointRow(page, joint).getByRole('button', { name: `Выбрать стык ${joint}`, exact: true }).click()
  }
  await openRowMenu(page)
  await page.getByRole('button', { name: 'Перейти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Открыть линию', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Открыть в программе линий', exact: true })).toBeDisabled()
  await expect(page.getByText('Выбранные стыки относятся к разным линиям', { exact: true })).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Открыть в ЛНК (1)', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Открыть в ПСТО (1)', exact: true }).click()
  await expect(page).toHaveURL(/\/psto$/)
  await expect(jointRow(page)).toBeVisible()
  await expect(jointRow(page, 'F2')).toBeHidden()
})
