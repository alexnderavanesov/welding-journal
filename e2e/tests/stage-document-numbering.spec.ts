import { expect, test } from '@playwright/test'
import { requireDb } from '../../src/db'
import { withE2eDatabase } from '../database'
import { reserveSystemDocumentNames, readSystemDocumentNextNumbers, type SystemDocumentSequenceUpdate } from '../../src/server/system-document-sequences'
import { STAGED_DOCUMENT_TEMPLATE_IDS } from '../../src/lib/system-document-sequence-id'
import { normalizeRequestConclusionSettings } from '../../src/lib/request-conclusion-settings'
import { rpcName } from '../rpc'

let savedSettings: Array<{ key: string; value: string; updated_at: Date }> = []
const project = 'E2E stage numbering'
const date = '2026-10-13'
const original = { lnkRequest: { defaultMode: 'custom', systemPattern: 'Заявка-{{Дата}}-{{№}}' }, lnkConclusion: { defaultMode: 'custom', systemPattern: 'ЗНК-{{Метод}}-{{Дата}}-{{№}}' } }
test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    savedSettings = (await db.query("select * from app_settings where key like 'system-document-next-number:%' or key='request-conclusion'")).rows
    await db.query("delete from app_settings where key like 'system-document-next-number:%' or key='request-conclusion'")
    await db.query("insert into app_settings(key,value) values('request-conclusion',$1)", [JSON.stringify(original)])
    for (const id of STAGED_DOCUMENT_TEMPLATE_IDS) await db.query('insert into app_settings(key,value) values($1,$2)', [`system-document-next-number:${id}`, '126'])
    await db.query("insert into weld_joints(project_title,line,joint,weld_date,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date) values($1,'L','S','2026-10-01','Старая заявка','2026-10-02','Старое заключение','2026-10-03')", [project])
  })
})
test.afterEach(async ({ page }) => {
  await page.close()
  await withE2eDatabase(async db => {
    await db.query('delete from weld_joints where project_title=$1', [project])
    await db.query("delete from app_settings where key like 'system-document-next-number:%' or key='request-conclusion'")
    for (const item of savedSettings) await db.query('insert into app_settings(key,value,updated_at) values($1,$2,$3)', [item.key, item.value, item.updated_at])
  })
})
const facts = () => withE2eDatabase(async db => (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows)
const settings = () => withE2eDatabase(async db => (await db.query("select value from app_settings where key='request-conclusion'")).rows[0].value)
const request = (before = false, method?: 'ВИК' | 'РК' | 'ПВК' | 'УЗК'): SystemDocumentSequenceUpdate => ({
  type: method ? 'lnkConclusion' : 'lnkRequest', date, provisionalName: 'preview',
  fieldKeys: method ? [{ ВИК: 'vikConclusion' as const, РК: 'rkConclusion' as const, ПВК: 'pvkConclusion' as const, УЗК: 'uzkConclusion' as const }[method]] : ['vikRequest', 'rkRequest'],
  ...(method ? { methodCode: method } : {}), ...(before ? { sourceKind: 'beforeHeatTreatment' as const } : {}),
})
const reserve = (requests: SystemDocumentSequenceUpdate[]) => requireDb().transaction(tx => reserveSystemDocumentNames(tx, requests.map(request => ({ request }))))

test('both stages inherit the shared seed, allocate independently and never rewrite old facts or settings', async () => {
  const before = await facts(), oldSettings = await settings()
  for (const method of [undefined, 'ВИК', 'РК', 'ПВК', 'УЗК'] as const) {
    const result = await reserve([request(false, method), request(true, method), request(false, method)])
    expect(result.map(r => r.name.match(/(\d+)$/)![1])).toEqual(['126', '126', '127'])
    expect(result[0].name).not.toContain('ДО-ТО')
    expect(result[1].name).toContain('ДО-ТО')
    expect((await reserve([request(true, method)]))[0].name).toMatch(/127$/)
  }
  expect(await facts()).toEqual(before)
  expect(await settings()).toEqual(oldSettings)
  const seeds = await withE2eDatabase(async db => (await db.query("select value from app_settings where key = any($1::text[])", [STAGED_DOCUMENT_TEMPLATE_IDS.map(id => `system-document-next-number:${id}`)])).rows)
  expect(seeds.every(row => row.value === '126')).toBe(true)
})

test('parallel saves, same-name collision between stages, and rollback do not reuse or consume wrong numbers', async () => {
  const groups = await Promise.all([reserve([request()]), reserve([request(true)]), reserve([request()]), reserve([request(true)])])
  expect(groups.flat().map(r => r.name).sort()).toEqual([
    'Заявка-13.10.2026-126', 'Заявка-13.10.2026-127', 'Заявка-ДО-ТО-13.10.2026-126', 'Заявка-ДО-ТО-13.10.2026-127',
  ].sort())
  const prior = await readSystemDocumentNextNumbers(requireDb(), ['lnkRequest', 'lnkRequest:beforeHeatTreatment'])
  await expect(requireDb().transaction(async tx => { await reserveSystemDocumentNames(tx, [{ request: request(true) }]); throw new Error('synthetic rollback') })).rejects.toThrow('synthetic rollback')
  expect(await readSystemDocumentNextNumbers(requireDb(), ['lnkRequest', 'lnkRequest:beforeHeatTreatment'])).toEqual(prior)
  const rules = normalizeRequestConclusionSettings(original)
  rules.lnkRequestBeforeHeatTreatment.systemPattern = rules.lnkRequest.systemPattern
  await withE2eDatabase(async db => {
    await db.query("update app_settings set value=$1 where key='request-conclusion'", [JSON.stringify(rules)])
    await db.query('update weld_joints set vik_request=$1,vik_request_date=$2 where project_title=$3', ['Заявка-13.10.2026-128', date, project])
  })
  expect((await reserve([request(true)]))[0].name).toBe('Заявка-13.10.2026-129')
  expect((await readSystemDocumentNextNumbers(requireDb(), ['lnkRequest'])).lnkRequest).toBe(128)
})

test('a thousand pre-TO names use the same bounded query count as one name', async () => {
  await reserve([request(true)]) // initialize before measuring the steady state
  const measured = (count: number) => requireDb().transaction(async tx => {
    let calls = 0
    const counted = new Proxy(tx, { get(target, key) {
      const value = Reflect.get(target, key)
      return ['select', 'insert', 'execute'].includes(String(key)) ? (...args: unknown[]) => { calls++; return value.apply(target, args) } : value
    } })
    const result = await reserveSystemDocumentNames(counted, Array.from({ length: count }, () => ({ request: request(true) })))
    expect(result).toHaveLength(count)
    return calls
  })
  const one = await measured(1), thousand = await measured(1000)
  expect(thousand).toBe(one)
  expect(thousand).toBeLessThanOrEqual(7)
})

test('settings show independent formulas and a reset menu; cancel and pre-TO reset preserve main and old documents', async ({ page }, info) => {
  const before = await facts(), calls: string[] = []
  page.on('request', r => { if (r.url().includes('/_serverFn/')) calls.push(rpcName(r.url())) })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Заявки и заключения', exact: true }).click()
  await expect(page.getByText('Выбранная вкладка при открытии')).toHaveCount(0)
  await expect(page.getByText('Основной этап', { exact: true })).toHaveCount(2)
  await expect(page.getByText('До ТО', { exact: true })).toHaveCount(2)
  await expect(page.getByText(/ЗНК-РК-ДО-ТО/)).toBeVisible()
  await page.screenshot({ path: info.outputPath('stage-naming-rules.png') })
  await page.getByRole('main').getByRole('button', { name: 'Документы', exact: true }).click()
  await page.getByRole('button', { name: /Заявка ЛНК Шаблон заявки/ }).click()
  await expect(page.getByText('Основной: 126')).toBeVisible()
  await expect(page.getByText('До ТО: 126')).toBeVisible()
  const oldCounts = await readSystemDocumentNextNumbers(requireDb(), ['lnkRequest', 'lnkRequest:beforeHeatTreatment'])
  await page.getByRole('button', { name: 'Обнулить счетчик', exact: true }).click()
  await page.getByRole('button', { name: 'До ТО', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Заявка ЛНК · До ТО')
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await readSystemDocumentNextNumbers(requireDb(), ['lnkRequest', 'lnkRequest:beforeHeatTreatment'])).toEqual(oldCounts)
  await page.getByRole('button', { name: 'Обнулить счетчик', exact: true }).click()
  await page.getByRole('button', { name: 'До ТО', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Обнулить счетчик', exact: true }).click()
  await expect(page.getByText('До ТО: 1', { exact: true })).toBeVisible()
  expect(await readSystemDocumentNextNumbers(requireDb(), ['lnkRequest', 'lnkRequest:beforeHeatTreatment'])).toEqual({ lnkRequest: 126, 'lnkRequest:beforeHeatTreatment': 1 })
  expect(await facts()).toEqual(before)
  expect(calls.filter(name => name.startsWith('getSystemDocumentSequence_'))).toHaveLength(1)
  await page.screenshot({ path: info.outputPath('stage-counter-reset.png') })
})

test('after reset, explicit refresh skips occupied names without consuming numbers and the shown name can be saved', async ({ page }) => {
  await withE2eDatabase(async db => {
    await db.query("insert into app_settings(key,value) values('system-document-next-number:lnkRequest:beforeHeatTreatment','1')")
    await db.query("update weld_joints set vik_request='Заявка-ДО-ТО-13.10.2026-001',vik_request_date=$1,rk_request='Заявка-ДО-ТО-13.10.2026-003',rk_request_date=$1 where project_title=$2", [date, project])
    await db.query("insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,psto_required,has_vik,officiality,material_group,connection_type,welding_method,d1,d2,t1,t2,wdi) values($1,'P','NEW','STAGE-REFRESH','2026-10-01','да','да','действующий','M01','СШ','РД',108,108,4,4,0.42)", [project])
  })
  const seed = await readSystemDocumentNextNumbers(requireDb(), ['lnkRequest:beforeHeatTreatment'])
  const quote = await requireDb().transaction(tx => reserveSystemDocumentNames(tx, [{ request: request(true) }, { request: request(true) }], { previewOnly: true }))
  expect(quote.map(item => item.name)).toEqual(['Заявка-ДО-ТО-13.10.2026-002', 'Заявка-ДО-ТО-13.10.2026-004'])
  expect(await readSystemDocumentNextNumbers(requireDb(), ['lnkRequest:beforeHeatTreatment'])).toEqual(seed)
  // Direct SQL fixtures bypass mutation invalidation. Establish the actual
  // derived state before asserting that the unrelated historical row is intact;
  // opening the report must not race null -> awaiting-NK status publication.
  const [{ markDispatcherTaskIndexDirty }, { ensureDispatcherTaskIndexFresh }] = await Promise.all([
    import('../../src/server/dispatcher-task-index-dirty'), import('../../src/server/dispatcher-task-index'),
  ])
  await markDispatcherTaskIndexDirty(requireDb())
  await ensureDispatcherTaskIndexFresh()
  const originalRow = (await facts())[0]
  expect(originalRow.final_status).toBe('ожидает НК')
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('STAGE-REFRESH')
  const row = page.getByRole('button', { name: 'Выбрать стык STAGE-REFRESH', exact: true }).locator('xpath=ancestor::tr')
  await row.getByRole('button', { name: 'Выполнить: Создать заявку НК до ТО', exact: true }).click()
  await page.getByLabel('Дата заявки', { exact: true }).fill(date)
  await page.getByRole('button', { name: 'Создать заявку до ТО', exact: true }).click()
  await expect(page.getByText(/Показанн.*системн.*(?:занято|изменился)/)).toBeVisible()
  await page.getByRole('button', { name: 'Дополнительные действия с номерами и именами' }).click()
  await page.getByRole('button', { name: 'Обновить номера и имена', exact: true }).click()
  await page.getByRole('tab', { name: /Заявки и имена/ }).click()
  await expect(page.getByRole('textbox', { name: /^Название заявки НК до ТО:/ })).toHaveValue('Заявка-ДО-ТО-13.10.2026-002')
  expect(await readSystemDocumentNextNumbers(requireDb(), ['lnkRequest:beforeHeatTreatment'])).toEqual(seed)
  await page.getByRole('button', { name: 'Создать заявку до ТО', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО', exact: true })).toBeHidden()
  expect((await facts())[0]).toEqual(originalRow)
  expect((await readSystemDocumentNextNumbers(requireDb(), ['lnkRequest:beforeHeatTreatment']))['lnkRequest:beforeHeatTreatment']).toBe(3)
})
