import { expect, test, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const PROJECT = 'E2E picture stage captions'
let settings: { value: string; updated_at: Date }[] = []

test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    settings = (await db.query("select value,updated_at from app_settings where key='control-processes'")).rows
    await db.query(`insert into app_settings(key,value) values ('control-processes',$1)
      on conflict(key) do update set value=excluded.value,updated_at=now()`,
    [JSON.stringify({ preHeatTreatmentLnkEnabled: true, allowPrimaryLnkBeforePreviousStagesComplete: false })])
  })
})

test.afterEach(async () => {
  await cleanupLineProgramProjects([PROJECT])
  await withE2eDatabase(async db => {
    await db.query("delete from app_settings where key='control-processes'")
    for (const row of settings) await db.query("insert into app_settings(key,value,updated_at) values ('control-processes',$1,$2)", [row.value, row.updated_at])
  })
})

async function seed(joint: string, assignment: string | null, welded = true, preResult?: string, pstoRequest?: string) {
  return withE2eDatabase(async db => {
    const id = (await db.query<{ id: number }>(`insert into weld_joints
      (project_title,subtitle_code,line,joint,officiality,revision_actuality,weld_date,has_vik,psto_required,psto_request,psto_request_date)
      values ($1,'PIC',$2,$2,'действующий','актуальная',$3,'да',$4,$5,$6) returning id`,
    [PROJECT, joint, welded ? '2026-09-01' : null, assignment, pstoRequest ?? null, pstoRequest ? '2026-09-04' : null])).rows[0]!.id
    if (preResult !== undefined) await db.query(`insert into pre_heat_treatment_controls
      (weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      values ($1,'ВИК',$2,'2026-09-02',$3,$4,$5)`,
    [id, `ВИК-заявка-${joint}`, preResult || null, preResult ? `ВИК-заключение-${joint}` : null, preResult ? '2026-09-03' : null])
    return id
  })
}

async function picture(page: Page, joint: string) {
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(joint)
  await page.getByRole('button', { name: joint, exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `Картина стыка ${joint}`, exact: true }) })
  const pre = dialog.locator('section').filter({ has: page.getByRole('heading', { name: 'НК до ТО', exact: true }) })
  const psto = dialog.locator('section').filter({ has: page.getByRole('heading', { name: 'ПСТО и ТВМТ', exact: true }) })
  await expect(pre).toBeVisible()
  return { dialog, pre, psto }
}

test('назначение объясняется только в двух разделах; старые документы сохраняются без ПСТО и при отмене', async ({ page }, info) => {
  for (const [joint, assignment, expected] of [
    ['F971', null, 'ПСТО не предусмотрено'], ['F972', 'отменен', 'ПСТО отменено'],
  ] as const) {
    await seed(joint, assignment, true, 'годен', `ПСТО-заявка-${joint}`)
    const { dialog, pre, psto } = await picture(page, joint)
    await expect(dialog.getByText(expected, { exact: true })).toHaveCount(2)
    await expect(pre.getByText(expected, { exact: true })).toBeVisible()
    await expect(psto.getByText(expected, { exact: true })).toBeVisible()
    await expect(pre.getByRole('button', { name: `ВИК-заявка-${joint}`, exact: true })).toBeVisible()
    await expect(pre.getByRole('button', { name: `ВИК-заключение-${joint}`, exact: true })).toBeVisible()
    await expect(psto.getByRole('button', { name: `ПСТО-заявка-${joint}`, exact: true })).toBeVisible()
    await expect(psto.getByText('Сохранённая заявка; выполнение ПСТО не требуется')).toBeVisible()
    await expect(pre.getByText('Нет данных')).toHaveCount(0)
    await expect(psto.getByText('Нет данных')).toHaveCount(0)
    if (joint === 'F971') await dialog.screenshot({ path: info.outputPath('preserved-history.png') })
  }
})

test('назначенное ПСТО различает сварку, заявку, результаты и негодный НК до ТО', async ({ page }, info) => {
  for (const [joint, welded, result, preLabel, pstoLabel] of [
    ['F973', false, undefined, 'Ожидает сварку', 'Ожидает сварку'],
    ['F974', true, undefined, 'Ожидает заявку НК до ТО', 'Ожидает НК до ТО'],
    ['F975', true, '', 'Ожидает результаты НК до ТО', 'Ожидает завершения НК до ТО'],
    ['F976', true, 'годен', 'годен', 'Ожидает заявку ПСТО'],
    ['F977', true, 'ремонт', 'ремонт', 'ПСТО не требуется: НК до ТО имеет негодный результат'],
  ] as const) {
    await seed(joint, 'да', welded, result)
    const { dialog, pre, psto } = await picture(page, joint)
    await expect(pre.getByText(preLabel, { exact: true })).toBeVisible()
    await expect(psto.getByText(pstoLabel, { exact: true })).toBeVisible()
    await expect(psto.getByText('Цикл 1')).toHaveCount(0)
    if (joint === 'F974') await dialog.screenshot({ path: info.outputPath('waiting-pre-control.png') })
  }
})

test('выключенный НК до ТО сохраняет заключение и не создаёт ожидание этого этапа', async ({ page }) => {
  await seed('F978', 'да', true, 'ремонт')
  await withE2eDatabase(async db => {
    await db.query("update app_settings set value=$1,updated_at=now() where key='control-processes'", [JSON.stringify({ preHeatTreatmentLnkEnabled: false })])
  })
  const { pre, psto } = await picture(page, 'F978')
  await expect(pre.getByText('НК до ТО отключён в настройках', { exact: true })).toBeVisible()
  await expect(pre.getByRole('button', { name: 'ВИК-заключение-F978', exact: true })).toBeVisible()
  await expect(pre.getByText('ремонт', { exact: true })).toBeVisible()
  await expect(psto.getByText('Ожидает заявку ПСТО', { exact: true })).toBeVisible()
})

test('цикл показывает ожидание ПСТО, заявки ТВМТ, результата ТВМТ и затем фактический результат', async ({ page }) => {
  const id = await seed('F979', 'да', true, 'годен', 'ПСТО-заявка-F979')
  for (const [result, tvmtRequest, tvmtResult, label] of [
    [null, null, null, 'Ожидает ПСТО'],
    ['проведено', null, null, 'ПСТО: проведено · Ожидает заявку ТВМТ'],
    ['проведено', 'ТВМТ-заявка-F979', null, 'ПСТО: проведено · Ожидает результат ТВМТ'],
    ['проведено', 'ТВМТ-заявка-F979', 'годен', 'ТВМТ: годен'],
  ] as const) {
    await withE2eDatabase(async db => {
      await db.query(`update weld_joints set psto_result=$2,psto_date=$3,heat_treatment_diagram=$4,
        tvmt_request=$5,tvmt_request_date=$6,tvmt_result=$7,tvmt_conclusion=$8,tvmt_conclusion_date=$9 where id=$1`,
      [id, result, result ? '2026-09-05' : null, result ? 'Диаграмма-F979' : null,
        tvmtRequest, tvmtRequest ? '2026-09-06' : null, tvmtResult,
        tvmtResult ? 'ТВМТ-заключение-F979' : null, tvmtResult ? '2026-09-07' : null])
    })
    const { psto } = await picture(page, 'F979')
    await expect(psto.getByText(label, { exact: true })).toBeVisible()
    await expect(psto.getByRole('button', { name: 'ПСТО-заявка-F979', exact: true })).toBeVisible()
    if (tvmtRequest) await expect(psto.getByRole('button', { name: tvmtRequest, exact: true })).toBeVisible()
    if (tvmtResult) await expect(psto.getByRole('button', { name: 'ТВМТ-заключение-F979', exact: true })).toBeVisible()
  }
})

test('отмена и отсутствие ПСТО не скрывают старый неизвестный результат или примечание без документов', async ({ page }) => {
  for (const item of [
    { joint: 'F980', assignment: 'отменен', pstoResult: 'Архивный результат ПСТО', tvmtResult: null, request: false, note: null },
    { joint: 'F981', assignment: 'отменен', pstoResult: null, tvmtResult: null, request: false, note: 'Архивное примечание без документов' },
    { joint: 'F982', assignment: 'отменен', pstoResult: null, tvmtResult: 'Архивный результат ТВМТ', request: true, note: null },
    { joint: 'F983', assignment: null, pstoResult: 'Архивный результат ПСТО', tvmtResult: null, request: true, note: null },
  ]) {
    const request = item.request ? `ПСТО-заявка-${item.joint}` : undefined
    const id = await seed(item.joint, item.assignment, true, undefined, request)
    await withE2eDatabase(db => db.query(`update weld_joints set
      psto_result=$2,tvmt_result=$3,psto_note=$4,psto_cancellation_date=$5 where id=$1`,
    [id, item.pstoResult, item.tvmtResult, item.note, item.assignment ? '2026-09-10' : null]))
    const { pre, psto } = await picture(page, item.joint)
    const assignmentLabel = item.assignment ? 'ПСТО отменено' : 'ПСТО не предусмотрено'
    await expect(pre.getByText(assignmentLabel, { exact: true })).toBeVisible()
    await expect(psto.getByText(assignmentLabel, { exact: true }).first()).toBeVisible()
    await expect(psto.getByText('Цикл 1', { exact: true })).toBeVisible()
    if (item.note) await expect(psto.getByText(item.note, { exact: true })).toBeVisible()
    if (item.pstoResult || item.tvmtResult) {
      await expect(psto.getByText(item.tvmtResult ? `ТВМТ: ${item.tvmtResult}` : `ПСТО: ${item.pstoResult}`, { exact: true })).toBeVisible()
      await expect(psto.getByText('Сохранённая заявка; выполнение ПСТО не требуется', { exact: true })).toHaveCount(0)
    }
    if (request) await expect(psto.getByRole('button', { name: request, exact: true })).toBeVisible()
    else await expect(psto.getByRole('button')).toHaveCount(0)
    await expect(psto.getByText('Нет данных', { exact: true })).toHaveCount(0)
  }
})
