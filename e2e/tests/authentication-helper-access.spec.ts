import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'
import { resetE2eAccountFixtureLimits, latestE2eToken } from '../authentication'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import type { Permission } from '../../src/lib/access-permissions'
import { changeCard } from '../../src/server/technology-cards'
import * as XLSX from 'xlsx'
import { saveRemoteDocumentTemplate } from '../../src/server/document-templates'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'

test.beforeEach(resetE2eAccountFixtureLimits)

for (const screen of ['welding', 'data', 'indexes'] as const) test(`${screen}: separately granted screen access includes its bounded helper reads`, async ({ browser, baseURL }) => {
  const email = `helper-${randomUUID()}@e2e.test`
  const project = `HELPER-${randomUUID()}`
  const permissions: Permission[] = screen === 'welding' ? ['welding.view', 'welding.edit'] : [`${screen}.view`]
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Отдельные права', email, title: '', role: 'user', permissions })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'helper123' })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'helper123' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    if (screen === 'welding') {
      await withE2eDatabase(db => db.query(`insert into line_programs (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
        values ($1,'A',$1,'II','Б(а)',30,10)`, [project]))
      await page.goto('/journal')
      await page.getByRole('button', { name: 'Новый стык', exact: true }).click()
      const editor = page.getByRole('dialog')
      const field = (label: string) => editor.getByRole('textbox', { name: label, exact: true })
      await field('Линия').fill(project)
      await editor.getByRole('button', { name: `${project} Проект: ${project} · Шифр: A`, exact: true }).click()
      await expect(field('Группа трубопровода')).toHaveValue('Б(а)')
      await expect(field('Категория трубопровода')).toHaveValue('II')
      await expect(field('Контроль швов, (%)')).toHaveValue('30')
      await field('Стык').fill('F991')
      await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
      await expect(editor).toBeHidden()
      expect(await withE2eDatabase(async db => (await db.query('select category,group_name,weld_control_percent::float from weld_joints where project_title=$1', [project])).rows))
        .toEqual([{ category: 'II', group_name: 'Б(а)', weld_control_percent: 30 }])
    } else {
      await page.goto('/settings')
      await expect(page.getByRole('heading', { name: screen === 'data' ? 'Данные' : 'Системные индексы', exact: true })).toBeVisible()
      await expect(page.getByText('Недостаточно прав для этого действия.', { exact: true })).toHaveCount(0)
      await expect(page.getByText(screen === 'data' ? 'Способ сварки' : /Буквы индексов закреплены:/, { exact: true }).first()).toBeVisible()
    }
    expect(errors).toEqual([])
  } finally {
    await context.close()
    await withE2eDatabase(async db => {
      await db.query('delete from weld_joints where project_title=$1', [project])
      await db.query('delete from line_programs where project_title=$1', [project])
      await db.query('delete from auth_users where email=$1', [email])
    })
  }
})

test('reference deletion alone allows archive and deletion, while editing stays closed', async ({ browser, baseURL }) => {
  const email = `reference-${randomUUID()}@e2e.test`, name = `Проверка отдельных прав ${randomUUID()}`
  const permissions: Permission[] = ['references.view', 'references.delete', 'history.view']
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Архивариус', email, title: '', role: 'user', permissions })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'helper123' })
  const specialistId = await withE2eDatabase(async db => (await db.query("insert into specialists(name,certificate,kind,methods) values($1,'123','inspector',array['ВИК']) returning id", [name])).rows[0].id)
  const stampId = await withE2eDatabase(async db => (await db.query("insert into welder_stamps(naks_stamp,welder_name,naks_permits) values($1,$1,$2) returning id", [name, JSON.stringify([{ id: 'permit', connectionType: 'С', materialGroup: 'М01' }])])).rows[0].id)
  const card = await asE2eOwner(changeCard, 'references.edit')({ action: 'create', card: { name, weldingMethods: ['РАД'], connectionType: 'С17', materialGroups: ['М01'], diameterFrom: 57, diameterTo: 159, thicknessFrom: 3, thicknessTo: 8, psto: 'any' } })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'helper123' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    let observed = ''
    page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
    await page.goto('/references')
    await page.getByRole('tab', { name: 'Специалисты', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Поиск специалистов в справочнике' }).fill(name)
    const person = page.getByRole('row').filter({ hasText: name })
    await expect(page.getByRole('button', { name: 'Добавить специалиста', exact: true })).toBeDisabled()
    await expect(person.getByRole('button', { name: 'Изменить', exact: true })).toBeDisabled()
    await person.getByRole('button', { name: 'В архив', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'В архив', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(await withE2eDatabase(async db => (await db.query('select archived from specialists where id=$1', [specialistId])).rows[0].archived)).toBe(true)
    await page.getByRole('tab', { name: 'Технологические карты', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Поиск технологических карт' }).fill(name)
    const technology = page.getByRole('row').filter({ hasText: name })
    await expect(technology.getByRole('cell', { name: 'РАД · С17', exact: true })).toBeVisible()
    await expect(technology.getByRole('button', { name: 'Изменить', exact: true })).toBeDisabled()
    await technology.getByRole('button', { name: 'Удалить', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить ТК', exact: true }).click()
    await expect(technology).toHaveCount(0)
    expect(await withE2eDatabase(async db => (await db.query('select id from technology_cards where id=$1', [card.id])).rowCount)).toBe(0)
    expect(await withE2eDatabase(async db => (await db.query("select count(*)::int n from audit_operations where actor_id=(select id from auth_users where email=$1) and action in ('archiveSpecialist','changeTechnologyCard')", [email])).rows[0].n)).toBe(2)
    const call = async (name: string, data: unknown, method = 'GET') => {
      const url = new URL(siblingRpcUrl(observed, `${name}_createServerFn_handler`)), encoded = await serializeRpcData(data)
      if (method === 'GET') url.searchParams.set('payload', encoded)
      const response = await context.request.fetch(url.toString(), { method, ...(method === 'POST' ? { data: encoded } : {}), headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
      const result = await deserializeRpcResponse(await response.text()) as { result?: any; error?: Error }
      expect(result.error, name).toBeUndefined()
      return result.result
    }
    const stamps = await call('loadWelderStampRegistrySnapshot', {})
    expect(stamps.stamps.find((stamp: any) => stamp.id === stampId)).toMatchObject({ naksPermits: [{ id: 'permit', connectionType: 'С', materialGroup: 'М01' }] })
    const history = await call('listActivityHistory', { action: 'archiveSpecialist' }, 'POST')
    expect(history.rows.length).toBeGreaterThan(0)
    expect(history.rows.every((row: any) => typeof row.id === 'string' && row.id.length > 0)).toBe(true)
    const filters = await call('getActivityFilters', {}, 'POST')
    expect(filters.authors.some((author: any) => author.name === 'Архивариус' && typeof author.id === 'string')).toBe(true)
  } finally {
    await context.close()
    await withE2eDatabase(async db => {
      await db.query('delete from specialists where id=$1', [specialistId])
      await db.query('delete from welder_stamps where id=$1', [stampId])
      await db.query('delete from technology_cards where id=$1', [card.id])
      await db.query('delete from auth_users where email=$1', [email])
    })
  }
})

test('template viewing, deletion and numbering work independently of template editing', async ({ browser, baseURL }) => {
  const email = `templates-${randomUUID()}@e2e.test`
  expect(process.env.DOCUMENT_TEMPLATE_STORAGE_PATH).toContain('welding-e2e-templates-')
  expect(await withE2eDatabase(async db => (await db.query("select id from document_templates where id='weldingJournal'")).rowCount)).toBe(0)
  const store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Стык'], ['']]), 'Бланк')
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  await asE2eOwner(saveRemoteDocumentTemplate, 'templates.edit')({ data: { id: 'weldingJournal', fileName: 'access.xlsx', fileType: 'xlsx', fileSize: buffer.length,
    fileDataBase64: buffer.toString('base64'), sheetNames: ['Бланк'], fields: [], markerCount: 0, locations: [], warnings: [], expectedVersion: null } })
  await asE2eOwner(inviteAccount, 'templates.view')({ name: 'Работа с шаблонами', email, title: '', role: 'user', permissions: ['templates.view', 'templates.delete', 'numbering.view', 'numbering.edit'] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'helper123' })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'helper123' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    await page.goto('/settings')
    await expect(page.getByText('access.xlsx', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Открыть конструктор' })).toBeDisabled()
    await page.getByRole('button', { name: /^Чек-лист/ }).click()
    await expect(page.getByRole('button', { name: 'Загрузить первый шаблон' })).toBeDisabled()
    await page.getByRole('button', { name: /^ЖСР/ }).click()
    await expect(page.getByRole('button', { name: 'Обнулить счетчик', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Обнулить счетчик', exact: true }).click()
    const resetResponse = page.waitForResponse(response => response.url().includes('/_serverFn/') && rpcName(response.url()).startsWith('resetRemoteGeneratedDocumentSequence'))
    await page.getByRole('dialog').getByRole('button', { name: 'Обнулить счетчик', exact: true }).click()
    const reset = await deserializeRpcResponse(await (await resetResponse).text()) as { error?: unknown }
    expect(reset.error).toBeUndefined()
    await page.getByLabel('Управление файлом шаблона', { exact: true }).click()
    await expect(page.getByRole('button', { name: /Заменить файл шаблона/ })).toBeDisabled()
    await page.getByRole('button', { name: /Удалить шаблон/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить шаблон', exact: true }).click()
    await expect(page.getByText('access.xlsx', { exact: true })).toHaveCount(0)
    expect(await withE2eDatabase(async db => (await db.query("select id from document_templates where id='weldingJournal'")).rowCount)).toBe(0)
  } finally {
    await context.close()
    await withE2eDatabase(async db => {
      await db.query("delete from document_templates where id='weldingJournal'")
      await db.query('delete from auth_users where email=$1', [email])
    })
    for (const key of await store.list('weldingJournal/')) await store.delete(key)
  }
})

test('own-domain reads preserve line settings, statistics and reference history without opening weld facts', async ({ browser, baseURL }) => {
  const project = `DOMAIN-${randomUUID()}`, email = `domain-${randomUUID()}@e2e.test`
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Отдельные разделы', email, title: '', role: 'user', permissions: ['lines.view', 'statistics.view', 'references.view', 'history.view'] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'helper123' })
  const lineId = await withE2eDatabase(async db => {
    const id = (await db.query("insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent) values($1,'A','L1','II','Б(а)',30,10) returning id", [project])).rows[0].id
    await db.query("insert into weld_joints(project_title,subtitle_code,line,joint,line_program_id,welding_journal_note,lnk_note) values($1,'A','L1','F1',$2,'PRIVATE-WELD','PRIVATE-LNK')", [project, id])
    return id
  })
  const card = await asE2eOwner(changeCard, 'references.edit')({ action: 'create', card: { name: project, weldingMethods: ['РАД'], connectionType: 'С17', materialGroups: ['М01'], diameterFrom: 57, diameterTo: 159, thicknessFrom: 3, thicknessTo: 8, psto: 'any' } })
  const operationId = await withE2eDatabase(async db => (await db.query("select operation_id from audit_changes where entity='technology_cards' and entity_id=$1 order by id desc limit 1", [String(card.id)])).rows[0].operation_id)
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'helper123' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    let observed = ''
    page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
    const call = async (name: string, data: unknown, method = 'GET') => {
      const url = new URL(siblingRpcUrl(observed, `${name}_createServerFn_handler`)), encoded = await serializeRpcData(data)
      if (method === 'GET') url.searchParams.set('payload', encoded)
      const response = await context.request.fetch(url.toString(), { method, ...(method === 'POST' ? { data: encoded } : {}), headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
      const result = await deserializeRpcResponse(await response.text()) as { result?: any; error?: Error }
      expect(result.error, name).toBeUndefined()
      return result.result
    }
    const program = await call('getLineProgramPage', { tab: 'lines', search: project, page: 0 })
    expect(program.rows).toHaveLength(1)
    expect(program.rows[0]).toMatchObject({ groupName: 'Б(а)', category: 'II', weldControlPercent: 30, pvkControlPercent: 10 })
    const calculation = await call('getLineProgramCalculation', { id: lineId })
    expect(calculation.line).toMatchObject({ weldControlPercent: 30, pvkControlPercent: 10 })
    const joints = await call('getLineProgramJointPage', { id: lineId })
    expect(JSON.stringify(joints)).not.toContain('PRIVATE-')
    const statistics = await call('getStatisticsServerResult', { tab: 'lineSummary', from: '', to: '', unit: 'joints', projectFilter: '', selectedSubtitles: [], jointFilter: 'all' }, 'POST')
    expect(statistics.lineSummary.rows.find((row: any) => row.projectTitle === project)).toMatchObject({ line: 'L1', subtitleCode: 'A', total: 1 })
    const details = await call('getActivityDetails', { operationId }, 'POST')
    expect(details.rows.find((row: any) => row.entity === 'technology_cards').changes.connectionType).toEqual({ after: 'С17' })
  } finally {
    await context.close()
    await withE2eDatabase(async db => {
      await db.query('delete from weld_joints where project_title=$1', [project])
      await db.query('delete from line_programs where id=$1', [lineId])
      await db.query('delete from technology_cards where id=$1', [card.id])
      await db.query('delete from auth_users where email=$1', [email])
    })
  }
})
