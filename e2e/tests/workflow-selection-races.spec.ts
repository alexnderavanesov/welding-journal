import { expect, test, type Page } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcPayload, rpcName } from '../rpc'

const project = 'E2E workflow selection races'
type CandidateRequest = { search?: string; includeRowIds?: number[] }
function signal() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}
async function responseGates(page: Page, rpc: string) {
  const gates: Array<{ match: (request: CandidateRequest) => boolean; used: boolean; seen: ReturnType<typeof signal>; release: ReturnType<typeof signal>; done: ReturnType<typeof signal> }> = []
  let calls = 0
  await page.route('**/_serverFn/**', async route => {
    if (!rpcName(route.request().url()).startsWith(rpc)) return route.continue()
    calls++
    const payload = route.request().postData() ?? new URL(route.request().url()).searchParams.get('payload')!
    const { data } = deserializeRpcPayload(payload) as { data: CandidateRequest }
    const gate = gates.find(item => !item.used && item.match(data))
    if (!gate) return route.continue()
    gate.used = true
    try {
      const response = await route.fetch()
      gate.seen.resolve()
      await gate.release.promise
      await route.fulfill({ response })
    } finally { gate.done.resolve() }
  })
  return {
    hold(match: (request: CandidateRequest) => boolean = () => true) {
      const gate = { match, used: false, seen: signal(), release: signal(), done: signal() }
      gates.push(gate)
      return gate
    },
    get calls() { return calls },
    async close() {
      gates.forEach(gate => gate.release.resolve())
      await page.unrouteAll({ behavior: 'wait' })
    },
  }
}

test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
})

for (const report of ['lnk', 'psto'] as const) for (const mode of ['request', 'result'] as const) {
  test(`${report} ${mode}: фильтры, поздние ответы и закрытие до загрузки сохраняют выбор`, async ({ page }) => {
    await withLineProgramFixture(async db => {
      await db.query(`insert into weld_joints
        (project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,has_vik,psto_required,stamp_1_k)
        select $1,'RACE','SELECTION-RACE','F77'||lpad(n::text,4,'0'),'2026-09-01','С17','действующий','актуальная',$2,$3,'K1'
        from generate_series(1,604) n`, [project, report === 'lnk' ? 'да' : 'нет', report === 'psto' ? 'да' : 'нет'])
      if (report === 'psto') await db.query(`insert into pre_heat_treatment_controls
        (weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
        select id,'ВИК','RACE-PRE','2026-09-02','годен','RACE-PRE-C','2026-09-03'
        from weld_joints where project_title=$1`, [project])
      if (mode === 'result') await db.query(report === 'lnk'
        ? `update weld_joints set vik_request='RACE-R',vik_request_date='2026-09-04',vik_result='ожидает НК' where project_title=$1`
        : `update weld_joints set psto_request='RACE-R',psto_request_date='2026-09-04',psto_result='ожидает ПСТО' where project_title=$1`, [project])
    })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const gates = await responseGates(page, report === 'lnk' ? 'listLnkWorkflowRows_' : 'listPstoWorkflowRows_')
    const title = mode === 'request' ? (report === 'lnk' ? 'Заявка ЛНК' : 'Заявка ПСТО') : (report === 'lnk' ? 'Внесение результатов ЛНК' : 'Внесение результатов ПСТО')
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    const count = (n: number) => dialog.getByRole('button', { name: `Выбрано: ${n}`, exact: true })
    const row = (joint: string) => dialog.getByRole('checkbox', { name: `Выбрать стык SELECTION-RACE ${joint}`, exact: true })
    const open = async () => {
      await page.locator('header').getByRole('button', { name: mode === 'request' ? 'Заявка' : 'Результат', exact: true }).click()
      await page.getByRole('button', { name: mode === 'request' ? 'Новая заявка' : 'Внести результаты', exact: true }).click()
      await expect(dialog).toBeVisible()
    }
    try {
      await page.goto(`/${report}`)
      const reportSearch = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
      const all = page.locator('[data-weld-report-grid] .ag-header-cell').getByRole('checkbox')
      await reportSearch.fill('F77060')
      await expect(page.getByText('Найдено: 5', { exact: true })).toBeVisible()
      await all.check()

      // Close an opening while its real server response is held. Select other
      // rows and let the new response arrive before the cancelled opening's one.
      const oldOpening = gates.hold()
      await open()
      await oldOpening.seen.promise
      await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
      await all.uncheck()
      await reportSearch.fill('F77000')
      await expect(page.getByText('Найдено: 9', { exact: true })).toBeVisible()
      await all.check()
      await open()
      await expect(count(9)).toBeVisible()
      oldOpening.release.resolve()
      await oldOpening.done.promise
      await count(9).click()
      await expect(row('F770001')).toBeChecked()
      await expect(row('F770604')).toHaveCount(0)
      await dialog.getByRole('button', { name: 'Все стыки', exact: true }).click()
      if (report === 'lnk' && mode === 'result') await dialog.getByRole('combobox', { name: 'Метод контроля', exact: true }).selectOption('vikRequest')

      if (mode === 'result') {
        await dialog.getByLabel(report === 'lnk' ? 'Дата контроля' : 'Дата ПСТО', { exact: true }).fill('2026-09-05')
        if (report === 'lnk') await dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()
        // The unified PSTO window records «проведено» automatically; only its
        // date is entered. The legacy result dropdown is not part of this flow.
        await expect(dialog.getByRole('button', { name: 'Сохранить результат', exact: true })).toBeEnabled()
      }

      const search = dialog.getByPlaceholder('Проект, шифр, линия, спул или стык')
      const first = gates.hold(data => data.search === 'F7702')
      await search.fill('F7702')
      await first.seen.promise
      if (mode === 'result') await expect(dialog.getByRole('button', { name: 'Сохранить результат', exact: true })).toBeDisabled()
      const last = gates.hold(data => data.search === 'F7703')
      await search.fill('F7703')
      await last.seen.promise
      last.release.resolve()
      await last.done.promise
      await row('F770300').check()
      await expect(count(10)).toBeVisible()
      // A -> B -> A, with a new checkbox chosen in B. The first A request
      // captured only nine IDs and must not replace the newer selection.
      const currentFilter = gates.hold(data => data.search === 'F7702' && data.includeRowIds?.length === 10)
      await search.fill('F7702')
      await currentFilter.seen.promise
      currentFilter.release.resolve()
      await currentFilter.done.promise
      first.release.resolve()
      await first.done.promise
      await page.waitForLoadState('networkidle')
      await expect(search).toHaveValue('F7702')
      await expect(count(10)).toBeVisible()
      await count(10).click()
      await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(10)
      await expect(row('F770300')).toBeChecked()
      await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()

      // Reopen twice with exactly the same report selection while its fetch is
      // pending; deduplication must not drop the selection or duplicate calls.
      const reportSelectionCount = report === 'lnk' && mode === 'request' ? 10 : 9
      const sameOpening = gates.hold()
      await open()
      await sameOpening.seen.promise
      const before = gates.calls
      await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
      await open()
      sameOpening.release.resolve()
      await sameOpening.done.promise
      await expect(count(reportSelectionCount)).toBeVisible()
      await count(reportSelectionCount).click()
      await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(reportSelectionCount)
      expect(gates.calls - before).toBeLessThanOrEqual(2)
      await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
      expect(errors).toEqual([])
    } finally { await gates.close() }
  })
}
