import { expect, test } from '@playwright/test'
import { createSmoothnessProbe } from '../smoothness-probe'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const enabled = !!process.env.SMOOTHNESS_LABEL
const resultsProject = 'E2E smooth details results'
const historyProject = 'E2E smooth details histories'
const personPrefix = 'SM детали специалист '
const welderPrefix = 'SM детали сварщик '
test.skip(!enabled, 'Explicit local performance comparison')
test.use({ trace: 'off', video: 'off', actionTimeout: 10000 })

test.beforeAll(async () => {
  if (!enabled) return
  test.setTimeout(180000)
  await withLineProgramFixture(async db => {
    expect((await db.query('select id from weld_joints where project_title=any($1::text[])', [[resultsProject, historyProject]])).rows).toHaveLength(0)
    expect((await db.query("select id from welder_stamps where naks_stamp in (select 'Z'||lpad(n::text,3,'0') from generate_series(1,120) n)")).rows).toHaveLength(0)
    await db.query(`insert into welder_stamps(naks_stamp,welder_name,weld_type,material_groups,diameter_from,diameter_to,thickness_from,thickness_to,valid_from,valid_to,naks_permits,dls_permits)
      select 'Z'||lpad(n::text,3,'0'),$1||lpad(n::text,4,'0'),'РД','М01','10','1000','1','50','2026-01-01','2027-12-31','[]','[]'
      from generate_series(1,120) n`, [welderPrefix])
    await db.query(`insert into welder_stamp_suspensions(naks_stamp,suspended_from,suspended_to)
      select 'Z'||lpad(n::text,3,'0'),date '2025-01-01'+n,date '2025-01-02'+n from generate_series(1,120) n`)
    await db.query(`insert into specialists(name,kind,certificate,methods)
      select $1||lpad(n::text,4,'0'),'inspector','SM-DETAIL-CERT-'||n,array['ВИК'] from generate_series(1,120) n`, [personPrefix])
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,psto_assignment)
      select $1,'SM-DETAIL','SM-RESULT-'||lpad(n::text,3,'0'),'II','Б(а)',10,10,'unassigned' from generate_series(1,51) n`, [resultsProject])
    // 100 selected joints: 50 in the first group and one in each other line.
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,
      welding_method,material_group,d1,d2,t1,t2,stamp_1_k,has_vik,vik_request,vik_request_date,vik_result,psto_required)
      select p.id,p.project_title,p.subtitle_code,p.line,'F'||lpad(n::text,4,'0'),'2026-10-01','С17','действующий','актуальная',
      'РД','М01',108,108,4,4,'Z001','да','SM-DETAIL-V-'||p.line,'2026-10-02','ожидает НК','нет'
      from generate_series(1,100) n join line_programs p on p.project_title=$1
      and p.line='SM-RESULT-'||lpad((case when n<=50 then 1 else n-49 end)::text,3,'0')`, [resultsProject])
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,psto_assignment)
      values($1,'SM-DETAIL','SM-HISTORY','II','Б(а)',10,10,'unassigned')`, [historyProject])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,
      welding_method,material_group,d1,d2,t1,t2,stamp_1_k,has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,
      psto_required,psto_exception_basis,psto_request,psto_request_date,psto_date,psto_result,heat_treatment_diagram,tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date)
      select p.id,p.project_title,p.subtitle_code,p.line,'F'||lpad(n::text,4,'0'),'2026-10-01','С17','действующий','актуальная',
      'РД','М01',108,108,4,4,'Z'||lpad(n::text,3,'0'),'да','SM-DETAIL-HV-'||n,'2026-10-11','годен','SM-DETAIL-HC-'||n,'2026-10-12',
      'да','SM решение '||n,'SM-P1-'||n,'2026-10-02','2026-10-03','проведено','SM-D1-'||n,'SM-TV1-'||n,'2026-10-03','не годен','SM-TVC1-'||n,'2026-10-04'
      from line_programs p cross join generate_series(1,120) n where p.project_title=$1`, [historyProject])
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_date,psto_result,heat_treatment_diagram,
      tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date)
      select id,s,'SM-P'||s||'-'||joint,date '2026-10-02'+(s-1)*3,date '2026-10-03'+(s-1)*3,'проведено','SM-D'||s||'-'||joint,
      'SM-TV'||s||'-'||joint,date '2026-10-03'+(s-1)*3,case when s=2 then 'не годен' else 'годен' end,'SM-TVC'||s||'-'||joint,date '2026-10-04'+(s-1)*3
      from weld_joints cross join generate_series(2,3) s where project_title=$1`, [historyProject])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      select id,'ВИК','SM-PRE-'||joint,'2026-10-01','годен','SM-PREC-'||joint,'2026-10-02' from weld_joints where project_title=$1`, [historyProject])
    await db.query(`insert into duplicate_controls(weld_joint_id,method,result,control_date,conclusion,conclusion_date)
      select id,'ВИК','годен','2026-10-13','SM-DUP-'||joint,'2026-10-13' from weld_joints where project_title=$1`, [historyProject])
    await db.query(`insert into psto_chain_exceptions(line_program_id,root_joint,required,basis)
      select line_program_id,lower(joint),true,psto_exception_basis from weld_joints where project_title=$1`, [historyProject])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=any($1::text[])`, [[resultsProject, historyProject]])
  })
})

test.afterAll(async () => {
  if (!enabled) return
  test.setTimeout(180000)
  await cleanupLineProgramProjects([resultsProject, historyProject])
  await withLineProgramFixture(async db => {
    await db.query('delete from welder_stamp_suspensions where naks_stamp in (select naks_stamp from welder_stamps where welder_name like $1)', [`${welderPrefix}%`])
    await db.query('delete from welder_stamps where welder_name like $1', [`${welderPrefix}%`])
    await db.query('delete from specialists where name like $1', [`${personPrefix}%`])
  })
})

test('100 selected: 51 conclusion groups, composition search and specialist assignments remain drafts', async ({ page }, info) => {
  test.setTimeout(300000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    await page.goto('/lnk')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(resultsProject)
    await expect(page.getByText('Найдено: 100', { exact: true })).toBeVisible({ timeout: 60000 })
    const all = page.locator('[data-weld-report-grid] .ag-header-cell').getByRole('checkbox')
    await all.click(); await expect(all).toBeChecked({ timeout: 60000 })
    await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
    await page.getByRole('button', { name: 'Внести результаты', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Внесение результатов ЛНК', exact: true }) })
    await expect(dialog.getByRole('button', { name: 'Выбрано: 100', exact: true })).toBeVisible({ timeout: 60000 })
    const method = dialog.getByRole('combobox', { name: 'Метод контроля', exact: true })
    await expect(method).toBeEnabled({ timeout: 60000 })
    if (await method.inputValue() !== 'vikRequest') {
      await method.click()
      await page.getByRole('listbox').getByRole('option', { name: 'ВИК', exact: true }).click()
    }
    await dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()
    await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-10-20')
    await dialog.getByRole('combobox', { name: 'Разделение документов', exact: true }).selectOption('line')
    const names = dialog.getByRole('textbox', { name: /^Название заключения:/ })
    await probe.measure('details:conclusions-51-open', async () => {
      await dialog.getByRole('tab', { name: /^Заключения и имена/ }).click()
      await expect(dialog.getByText('51 групп · страница 1', { exact: true })).toBeVisible({ timeout: 60000 })
      await expect(names).toHaveCount(50)
    })
    await probe.scroll('details:conclusions-scroll', dialog.locator('[data-group-joint-count]').first().locator('../..'))
    await probe.measure('details:conclusions-next-page', async () => {
      await dialog.getByRole('button', { name: 'Следующие →', exact: true }).click()
      await expect(dialog.getByText('51 групп · страница 2', { exact: true })).toBeVisible()
      await expect(names).toHaveCount(1)
    })
    await dialog.getByRole('button', { name: '← Предыдущие', exact: true }).click()
    await expect(names).toHaveCount(50)
    const composition = dialog.getByRole('complementary', { name: 'Состав будущего документа', exact: true })
    await probe.measure('details:composition-50-open', async () => {
      await dialog.getByRole('button', { name: 'Состав — 50 позиций', exact: true }).click()
      await expect(composition.locator('tbody tr')).toHaveCount(50)
      await expect(composition.getByText('Страница 1 / 1', { exact: false })).toBeVisible()
      await expect(composition.getByRole('button', { name: 'Следующие →', exact: true })).toBeDisabled()
    })
    await probe.scroll('details:composition-scroll', composition.getByRole('table'))
    await probe.measure('details:composition-search', async () => {
      await composition.getByRole('textbox', { name: 'Поиск по составу', exact: true }).fill('F0050')
      await expect(composition.locator('tbody tr')).toHaveCount(1)
      await expect(composition.locator('tbody tr')).toContainText('F0050')
    })
    await composition.getByRole('button', { name: '← Назад', exact: true }).click()
    await expect(composition).toBeHidden()
    await probe.measure('details:conclusion-draft-input', async () => {
      await names.first().fill('SM черновик без сохранения'); await names.first().blur()
      await expect(names.first()).toHaveValue('SM черновик без сохранения')
    })
    const specialists = dialog.getByRole('table', { name: 'Специалисты создаваемых документов', exact: true })
    await probe.measure('details:specialists-51-open', async () => {
      await dialog.getByRole('tab', { name: 'Специалисты', exact: true }).click()
      await expect(specialists.locator('tbody tr')).toHaveCount(50)
    })
    await probe.scroll('details:specialists-scroll', specialists)
    await probe.measure('details:specialists-next-page', async () => {
      await dialog.getByRole('button', { name: 'Далее', exact: true }).click()
      await expect(specialists.locator('tbody tr')).toHaveCount(1)
      await expect(dialog.getByText('2 / 2', { exact: true })).toBeVisible()
    })
    const picker = dialog.getByRole('combobox', { name: 'Провёл контроль', exact: true }).first()
    await probe.measure('details:specialist-options-open', async () => {
      await picker.click()
      await expect(page.getByRole('option', { name: new RegExp(`${personPrefix}0001`) })).toBeVisible({ timeout: 60000 })
    })
    await probe.scroll('details:specialist-options-scroll', page.getByRole('listbox'))
    await probe.measure('details:specialist-options-search', async () => {
      await page.getByRole('searchbox', { name: 'Поиск специалиста', exact: true }).fill(`${personPrefix}0120`)
      await expect(page.getByRole('option', { name: new RegExp(`${personPrefix}0120`) })).toBeVisible()
    })
    await page.getByRole('option', { name: new RegExp(`${personPrefix}0120`) }).click()
    await expect(picker).toContainText(`${personPrefix}0120`)
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(dialog).toBeHidden()
  } finally { await probe.finish() }
})

test('populated duplicate registry, three PSTO cycles and paged active exceptions', async ({ page }, info) => {
  test.setTimeout(300000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    await page.goto('/lnk')
    await page.locator('header').getByRole('button', { name: 'Дубль контроль', exact: true }).click()
    const duplicate = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Дубль контроль', exact: true }) })
    await probe.measure('details:existing-duplicates-open', async () => {
      await duplicate.getByRole('button', { name: /Внесенные дубли/ }).click()
      await expect(duplicate.getByRole('button', { name: 'Изменить', exact: true }).first()).toBeVisible({ timeout: 60000 })
      await expect(duplicate.getByText('из 120 строк', { exact: true })).toBeVisible()
    })
    await probe.scroll('details:existing-duplicates-scroll', duplicate.locator('section > .overflow-y-auto'))
    await probe.measure('details:existing-duplicates-full-page', async () => {
      await duplicate.getByRole('combobox', { name: 'На странице', exact: true }).selectOption('500')
      await expect(duplicate.getByRole('button', { name: 'Изменить', exact: true })).toHaveCount(120)
    })
    await page.keyboard.press('Escape'); await expect(duplicate).toBeHidden()
    await page.goto('/psto')
    await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
    await page.getByRole('button', { name: 'История ПСТО и ТВМТ', exact: true }).click()
    const history = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'История ПСТО и ТВМТ', exact: true }) })
    await probe.measure('details:psto-populated-history', async () => {
      await history.getByPlaceholder('Стык, линия или документ').fill(historyProject)
      await expect(history.getByText('Стыков в области: 120', { exact: true })).toBeVisible({ timeout: 60000 })
      await expect(history.getByRole('tab', { name: 'Повтор #3', exact: true })).toBeVisible()
    })
    await probe.scroll('details:psto-history-list-scroll', history.locator('aside .overflow-y-auto'))
    await history.locator('aside').getByRole('button').filter({ hasText: 'SM-HISTORY · F0001' }).click()
    for (const sequence of [1, 2, 3]) {
      const name = sequence === 1 ? 'Основной цикл' : `Повтор #${sequence}`
      await probe.measure(`details:psto-cycle-${sequence}`, async () => {
        const tab = history.getByRole('tab', { name, exact: true })
        await tab.click(); await expect(tab).toHaveAttribute('aria-selected', 'true')
        await expect(history.getByRole('textbox', { name: 'Наименование заявки', exact: true }).first()).toHaveValue(sequence === 1 ? 'SM-P1-1' : `SM-P${sequence}-F0001`)
      })
      await probe.scroll(`details:psto-cycle-${sequence}-scroll`, history.locator('section').filter({ has: page.getByRole('textbox', { name: 'Наименование заявки', exact: true }) }).first())
    }
    await page.keyboard.press('Escape'); await expect(history).toBeHidden()
    await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
    await page.getByRole('button', { name: 'Исключения', exact: true }).click()
    const exceptions = page.getByRole('grid', { name: 'Исключения ПСТО', exact: true })
    await expect(exceptions.locator('.ag-row').first()).toBeVisible({ timeout: 60000 })
    const program = page.getByRole('dialog').filter({ has: exceptions })
    await expect(program.getByText('из 120 исключений', { exact: true })).toBeVisible()
    await probe.scroll('details:psto-exceptions-scroll', exceptions)
    const initialRow = await exceptions.locator('.ag-row').first().getAttribute('row-id')
    await probe.measure('details:psto-exceptions-next-page', async () => {
      await program.getByRole('button', { name: 'Следующая страница исключений', exact: true }).click()
      await expect(exceptions.locator('.ag-row').first()).not.toHaveAttribute('row-id', initialRow!)
      await expect(program.getByRole('button', { name: 'Предыдущая страница исключений', exact: true })).toBeEnabled()
    })
    await probe.measure('details:psto-exceptions-previous-page', async () => {
      await program.getByRole('button', { name: 'Предыдущая страница исключений', exact: true }).click()
      await expect(exceptions.locator('.ag-row').first()).toHaveAttribute('row-id', initialRow!)
    })
    await page.keyboard.press('Escape')
  } finally { await probe.finish() }
})

test('populated suspension history and existing-record editor reopen without saving', async ({ page }, info) => {
  test.setTimeout(180000)
  const probe = await createSmoothnessProbe(page, info)
  try {
    await page.goto('/references')
    const toggle = page.getByRole('button', { name: /История отстранений/ })
    const panel = toggle.locator('..')
    await probe.measure('details:suspension-history-120-open', async () => {
      await toggle.click()
      await expect(panel.locator('tbody tr')).toHaveCount(120)
    })
    await probe.scroll('details:suspension-history-scroll', panel.getByRole('table'))
    const row = panel.locator('tbody tr').filter({ hasText: 'Z001' })
    for (let round = 0; round < 3; round++) {
      const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование отстранения', exact: true }) })
      await probe.measure(`details:suspension-existing-open:${round}`, async () => {
        await row.getByRole('button', { name: 'Редактировать запись отстранения', exact: true }).click()
        await expect(editor.getByLabel('Отстранен от', { exact: true })).toHaveValue('2025-01-02')
      })
      await page.keyboard.press('Escape'); await expect(editor).toBeHidden()
    }
    await toggle.click(); await expect(panel.getByRole('table')).toBeHidden()
  } finally { await probe.finish() }
})
