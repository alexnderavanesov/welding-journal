import { lnkRow as lnkGridRow, lnkActionRow } from './lnk-grid-helpers'
import { expect, test } from '@playwright/test'
import { pstoActionRow } from './psto-grid-helpers'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '../../src/lib/control-process-settings'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '../../src/lib/request-conclusion-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '../../src/lib/save-check-settings'
import { updateWeldJoints } from '../../src/server/weld-mutations'

const project = 'E2E required document requisites'
const settings = {
  'control-processes': DEFAULT_CONTROL_PROCESS_SETTINGS,
  'request-conclusion': REQUEST_CONCLUSION_DEFAULT_SETTINGS,
  'save-check': { ...DEFAULT_SAVE_CHECK_SETTINGS, lnkResultConclusionRequired: false, pstoResultDiagramRequired: false },
}
let originalSettings: Array<{ key: string; value: string; updated_at: Date }> = []

test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    originalSettings = (await db.query('select key,value,updated_at from app_settings where key=any($1::text[])', [Object.keys(settings)])).rows
    for (const [key, value] of Object.entries(settings)) {
      await db.query('insert into app_settings(key,value) values ($1,$2) on conflict(key) do update set value=excluded.value,updated_at=now()', [key, JSON.stringify(value)])
    }
  })
})

test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    for (const key of Object.keys(settings)) {
      const original = originalSettings.find(row => row.key === key)
      if (original) await db.query('update app_settings set value=$1,updated_at=$2 where key=$3', [original.value, original.updated_at, key])
      else await db.query('delete from app_settings where key=$1', [key])
    }
  })
})

for (const scenario of [
  { name: 'удаление заявки ПСТО при сохранённом результате', scope: 'psto',
    stored: { psto_required: 'да', psto_request: 'ПСТО-1', psto_request_date: '2026-09-02', psto_result: 'проведено', psto_date: '2026-09-03', heat_treatment_diagram: 'Диаграмма-1' },
    patch: { pstoRequest: null, pstoRequestDate: null } },
  { name: 'удаление заявки ТВМТ при сохранённом результате', scope: 'psto',
    stored: { psto_required: 'да', psto_request: 'ПСТО-1', psto_request_date: '2026-09-02', psto_result: 'проведено', psto_date: '2026-09-03', heat_treatment_diagram: 'Диаграмма-1', has_tvmt: 'да', tvmt_request: 'ТВМТ-1', tvmt_request_date: '2026-09-04', tvmt_result: 'годен', tvmt_conclusion_date: '2026-09-05', tvmt_conclusion: 'ТВМТ-1' },
    patch: { tvmtRequest: null, tvmtRequestDate: null } },
  { name: 'новый результат НК при старой заявке без даты', scope: 'lnk',
    stored: { has_vik: 'да', vik_request: 'ВИК-1', psto_required: 'нет' },
    patch: { vikResult: 'годен', vikConclusion: 'ВИК-1', vikConclusionDate: '2026-09-03' } },
  { name: 'новый результат ПСТО без заявки', scope: 'psto',
    stored: { psto_required: 'да' },
    patch: { pstoResult: 'проведено', pstoDate: '2026-09-03', heatTreatmentDiagram: 'Диаграмма-1' } },
] as const) {
  test(`сервер отклоняет обход: ${scenario.name}, весь пакет откатывается`, async () => {
    const ids = await withE2eDatabase(async db => {
      const rows = (await db.query<{ id: number }>(`insert into weld_joints(project_title,subtitle_code,line,joint,officiality,revision_actuality)
        select $1,'REQUISITES','REQ-L','F8900'||n,'действующий','актуальная' from generate_series(1,2) n returning id`, [project])).rows
      const fields = Object.entries(scenario.stored)
      await db.query(`update weld_joints set ${fields.map(([key], i) => `${key}=$${i + 1}`).join(',')}
        where id=any($${fields.length + 1}::int[])`, [...fields.map(([, value]) => value), rows.map(row => row.id)])
      return rows.map(row => row.id)
    })
    const snapshot = () => withE2eDatabase(async db => ({
      rows: (await db.query('select * from weld_joints where id=any($1::int[]) order by id', [ids])).rows,
      documents: (await db.query(`select d.* from generated_documents d join generated_document_weld_joints a on a.document_id=d.id where a.weld_joint_id=any($1::int[]) order by d.id`, [ids])).rows,
      links: (await db.query('select * from generated_document_weld_joints where weld_joint_id=any($1::int[]) order by document_id,weld_joint_id', [ids])).rows,
    }))
    const before = await snapshot()
    const expectedVersions = await withE2eDatabase(async db => (await db.query<{ id: number; version: string }>(
      'select id,xmin::text as version from weld_joints where id=any($1::int[]) order by id', [ids])).rows)
    await expect(updateWeldJoints({ data: {
      mutationScope: scenario.scope, expectedVersions,
      records: [
        { id: ids[0], ...(scenario.scope === 'lnk' ? { lnkNote: 'Не должно сохраниться' } : { pstoNote: 'Не должно сохраниться' }) },
        { id: ids[1], ...scenario.patch },
      ],
    } })).rejects.toThrow(/заявк/i)
    expect(await snapshot()).toEqual(before)
  })
}

for (const stage of ['beforeHeatTreatment', 'psto'] as const) {
  test(`UI requires names and dates for all groups despite stale optional settings: ${stage}`, async ({ page }) => {
    const isPre = stage === 'beforeHeatTreatment'
    await withE2eDatabase(async db => {
      await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,psto_required,psto_request,psto_request_date)
        select $1,'OPTIONAL','OPTIONAL-L'||n,'F8800'||n,'2026-09-01','действующий','актуальная','да','да',
          case when $2::boolean then null else 'Optional unnamed PSTO request' end,
          case when $2::boolean then null else '2026-09-03'::date end
        from generate_series(1,2) n`, [project, isPre])
      await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date,defect_description)
        select id,'ВИК','Optional unnamed pre-TO request','2026-09-02',
          case when $2::boolean then null else 'годен' end,
          case when $2::boolean then null else 'Optional previous pre-TO conclusion' end,
          case when $2::boolean then null else '2026-09-02'::date end,
          case when $2::boolean then null else 'ДНО' end
        from weld_joints where project_title=$1`, [project, isPre])
    })

    await page.goto(isPre ? '/lnk' : '/psto')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    const row = isPre
      ? await lnkActionRow(page, 'F88001')
      : await pstoActionRow(page, 'F88001')
    await row.getByRole('button', { name: isPre ? 'Выполнить: Внести результат НК до ТО' : 'Выполнить: Внести результат ПСТО · цикл 1', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: isPre ? 'Внесение результатов ЛНК до ТО' : 'Внесение результатов ПСТО', exact: true }) })
    await expect(dialog).toBeVisible()
    const checkboxes = dialog.getByRole('checkbox', { name: /^Выбрать стык OPTIONAL-L/ })
    await expect(checkboxes).toHaveCount(2)
    for (const checkbox of await checkboxes.all()) await checkbox.check()
    await expect(dialog.getByRole('button', { name: 'Выбрано: 2', exact: true })).toBeVisible()
    await dialog.getByLabel(isPre ? 'Дата контроля' : 'Дата ПСТО', { exact: true }).fill('2026-09-06')
    if (isPre) await dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()

    const split = dialog.getByRole('combobox', { name: 'Разделение документов', exact: true })
    await expect(split).toBeEnabled()
    await split.selectOption('line')
    await dialog.getByRole('tab', { name: isPre ? /Заключения и имена/ : /Диаграммы и имена/ }).click()
    await dialog.getByRole('group', { name: isPre ? 'Наименование заключения' : 'Наименование диаграммы', exact: true })
      .getByRole('button', { name: 'Пользовательское', exact: true }).click()
    const names = dialog.getByRole('textbox', { name: isPre ? /^Название заключения НК до ТО:/ : /^Название диаграммы ПСТО:/ })
    await expect(names).toHaveCount(2)
    for (const name of await names.all()) await expect(name).toHaveValue('')
    await expect(dialog.getByRole('status').filter({ hasText: 'Будет создано: 2' })).toBeVisible()
    const save = dialog.getByRole('button', { name: isPre ? 'Сохранить результат до ТО' : 'Сохранить результат', exact: true })
    await expect(save).toBeDisabled()
    const date = dialog.getByLabel(isPre ? 'Дата контроля' : 'Дата ПСТО', { exact: true })
    await date.fill('')
    await expect(dialog).toContainText(/Укажите дату/)
    await expect(dialog).toContainText('Укажите название для каждого')
    await names.nth(0).fill('Итоговый документ-1')
    await names.nth(0).blur()
    await date.fill('2026-09-06')
    await expect(save).toBeDisabled()
    await names.nth(1).fill('Итоговый документ-2')
    await names.nth(1).blur()
    await expect(save).toBeEnabled()
    await save.click()
    await expect(dialog).toBeHidden()

    const stored = await withE2eDatabase(async db => ({
      rows: (await db.query(isPre
        ? `select c.result,c.conclusion_date::text as date,c.conclusion_name as name,c.request_date::text as request_date from pre_heat_treatment_controls c join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1 order by w.id`
        : `select psto_result as result,psto_date::text as date,heat_treatment_diagram as name,psto_request_date::text as request_date from weld_joints where project_title=$1 order by id`, [project])).rows,
      documents: (await db.query(`select distinct d.id from generated_documents d join generated_document_weld_joints a on a.document_id=d.id join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1 and d.type=$2`, [project, isPre ? 'system:lnkConclusionVik' : 'system:pstoConclusion'])).rows,
    }))
    expect(stored.rows).toHaveLength(2)
    for (const saved of stored.rows) {
      expect(saved).toMatchObject({ result: isPre ? 'годен' : 'проведено', date: '2026-09-06', request_date: isPre ? '2026-09-02' : '2026-09-03' })
      expect(saved.name).toMatch(/^Итоговый документ-[12]$/)
    }
    expect(stored.documents).toHaveLength(2)
  })
}
