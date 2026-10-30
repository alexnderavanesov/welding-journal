import { expect, test, type Page } from '@playwright/test'
import { asE2eOwner } from '../with-owner-access'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../../src/db/schema'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { editJournalJoint } from '../journal-grid'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import type { WelderStampRegistrySnapshot } from '../../src/server/welder-stamps'
import { getTodayIsoDate } from '../../src/lib/date-format'
import { FACTUAL_WELDER_STAMP_FIELD_KEYS, OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '../../src/lib/report-config'
import { FIELD_BY_KEY } from '../../src/lib/weld-fields'

const PROJECT = 'E2E archive policy'
const ARCHIVED = 'EWA1', ACTIVE = 'EWA2'
let observed = ''
async function snapshot(page: Page): Promise<WelderStampRegistrySnapshot> {
  const response = await page.request.get(observed, { headers: {
    'x-tsr-serverFn': 'true', origin: new URL(observed).origin, 'sec-fetch-site': 'same-origin',
  } })
  const payload = await deserializeRpcResponse(await response.text()) as { result: WelderStampRegistrySnapshot; error?: Error }
  if (payload.error) throw payload.error
  return payload.result
}
async function save(page: Page, state: WelderStampRegistrySnapshot) {
  const response = await page.request.post(siblingRpcUrl(observed, 'saveWelderStampRecords_createServerFn_handler'), {
    data: await serializeRpcData({ records: state.stamps, expectedRevision: state.revision }),
    headers: { origin: new URL(observed).origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
  })
  const payload = await deserializeRpcResponse(await response.text()) as { result: WelderStampRegistrySnapshot; error?: Error }
  if (payload.error) throw payload.error
  return payload.result
}
async function registry(page: Page) {
  page.on('request', request => { if (request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('loadWelderStampRegistrySnapshot_')) observed = request.url() })
  await page.goto('/welder-stamps')
  await expect(page.getByRole('button', { name: 'Добавить клеймо', exact: true })).toBeVisible()
  await expect.poll(() => observed).not.toBe('')
  return snapshot(page)
}
async function seed() {
  return withLineProgramFixture(async db => {
    const permit = [{ id: 'n1', weldType: 'РАД', materialGroups: 'М01', diameterFrom: '1', diameterTo: '500',
      thicknessFrom: '1', thicknessTo: '20', validFrom: '2026-01-01', validTo: '2026-12-31', note: '', archived: false }]
    await db.query(`insert into welder_stamps(naks_stamp,internal_stamp,welder_name,naks_permits,dls_permits,archived,archived_at)
      values ($1,'ВН-АРХ','Архивный сварщик',$3,'[]',true,'2026-08-01'),($2,'ВН-ФАКТ','Активный сварщик',$3,'[]',false,null)`, [ARCHIVED, ACTIVE, JSON.stringify(permit)])
    const line = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'ARCHIVE','ARC','II','Б(а)',0,0) returning id`, [PROJECT])).rows[0]
    return (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,
      connection_type,welding_method,material_group,d1,d2,t1,t2,has_vik,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,$2,'ARCHIVE','ARC','F8800','действующий','актуальная','С17','РАД','М01',108,108,6,6,'да','II','Б(а)',0,0) returning id`, [line.id, PROJECT])).rows[0].id as number
  })
}
test.beforeEach(() => { observed = '' })
test.afterEach(async ({ context }) => {
  await Promise.all(context.pages().map(page => page.close()))
  await cleanupLineProgramProjects([PROJECT])
  await withLineProgramFixture(async db => {
    await db.query('delete from welder_stamp_suspensions where naks_stamp=any($1::text[])', [[ACTIVE, ARCHIVED]])
    await db.query('delete from welder_stamps where naks_stamp=any($1::text[])', [[ACTIVE, ARCHIVED]])
  })
})

test('списки: пустая дата, архив и отстранение по дате, все фактические клейма, сохранение выбранного значения', async ({ page }) => {
  const id = await seed()
  await withLineProgramFixture(async db => {
    await db.query("insert into welder_stamp_suspensions(naks_stamp,suspended_from,suspended_to) values ($1,'2026-07-31','2026-08-02')", [ACTIVE])
  })
  await page.goto('/')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('F8800')
  await editJournalJoint(page, id)
  const dialog = page.getByRole('dialog'), official = dialog.getByLabel('Корень_1', { exact: true })
  const factual = dialog.getByLabel('Корень_1 - факт', { exact: true }), date = dialog.getByLabel('Дата сварки', { exact: true })
  await expect(official.locator(`option[value="${ARCHIVED}"]`)).toHaveText(`${ARCHIVED} (в архиве)`)
  await expect(factual.locator(`option[value="${ARCHIVED}"]`)).toHaveText(`${ARCHIVED} (в архиве)`)
  await official.selectOption(ARCHIVED)
  await factual.selectOption(ARCHIVED)
  await date.fill('2026-07-31')
  await expect(official.locator(`option[value="${ACTIVE}"]`)).toHaveCount(0)
  await expect(factual.locator(`option[value="${ACTIVE}"]`)).toHaveCount(1)
  await date.fill('2026-08-01')
  await expect(official).toHaveValue(ARCHIVED)
  await expect(official.locator(`option[value="${ARCHIVED}"]`)).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled()
  await official.selectOption('')
  await expect(official.locator(`option[value="${ARCHIVED}"]`)).toHaveCount(0)
  await expect(factual).toHaveValue(ARCHIVED)
  await date.fill('')
  await official.selectOption(ARCHIVED)
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => withE2eDatabase(async db => (await db.query('select stamp_1_k,stamp_1_k_fact,weld_date from weld_joints where id=$1', [id])).rows[0]))
    .toEqual({ stamp_1_k: ARCHIVED, stamp_1_k_fact: ARCHIVED, weld_date: null })
})

test('клейма: поиск по части, архив внизу и сохранение во всех 12 полях', async ({ page }, info) => {
  const id = await seed(), errors: string[] = [], searchRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await editJournalJoint(page, id)
  const dialog = page.getByRole('dialog')
  const labels = [...OFFICIAL_WELDER_STAMP_FIELD_KEYS, ...FACTUAL_WELDER_STAMP_FIELD_KEYS].map(key => FIELD_BY_KEY.get(key)!.label)
  expect(labels).toHaveLength(12)
  let searching = false
  page.on('request', request => {
    if (searching && request.url().includes('/_serverFn/')) searchRequests.push(rpcName(request.url()))
  })
  for (const label of labels) {
    const select = dialog.getByRole('combobox', { name: label, exact: true })
    await select.click()
    const search = dialog.getByRole('combobox', { name: `Поиск: ${label}`, exact: true })
    const list = dialog.getByRole('listbox')
    await expect(search).toBeFocused()
    searching = true
    await search.fill('wa')
    await expect(list.getByRole('option')).toHaveText([ACTIVE, `${ARCHIVED} (в архиве)`])
    await expect(select).toHaveValue('')
    await search.fill('нет-такого-клейма')
    await expect(dialog.getByText('Ничего не найдено')).toBeVisible()
    await search.press('Enter')
    await expect(select).toHaveValue('')
    await search.fill('wa1')
    await expect(list.getByRole('option')).toHaveText([`${ARCHIVED} (в архиве)`])
    searching = false
    await search.press('Enter')
    await expect(select).toHaveValue(ARCHIVED)
    await expect(select).toBeFocused()
  }
  expect(searchRequests).toEqual([])
  const first = dialog.getByRole('combobox', { name: labels[0], exact: true })
  await first.click()
  const search = dialog.getByRole('combobox', { name: `Поиск: ${labels[0]}`, exact: true })
  await expect(search).toHaveValue('')
  await page.screenshot({ path: info.outputPath('stamp-search.png') })
  await search.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(first).toBeFocused()
  await first.click()
  await search.press('Tab')
  await expect(dialog.getByRole('listbox')).toHaveCount(0)
  await expect(dialog.getByRole('combobox', { name: labels[1], exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(dialog).toBeHidden()
  await editJournalJoint(page, id)
  for (const label of labels) await expect(dialog.getByRole('combobox', { name: label, exact: true })).toHaveValue(ARCHIVED)
  await first.click()
  // Reopening scrolls to the selected archived stamp at the end. In a full
  // registry the first, empty option is outside the virtualized viewport.
  await search.fill('Пусто')
  await dialog.getByRole('listbox').getByRole('option', { name: 'Пусто', exact: true }).click()
  await expect(first).toHaveValue('')
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  await page.getByRole('button', { name: 'Новый стык', exact: true }).click()
  for (const label of [labels[0], labels[6]]) {
    const select = dialog.getByRole('combobox', { name: label, exact: true })
    await select.click()
    await dialog.getByRole('combobox', { name: `Поиск: ${label}`, exact: true }).fill('wa2')
    await dialog.getByRole('listbox').getByRole('option', { name: ACTIVE, exact: true }).click()
    await expect(select).toHaveValue(ACTIVE)
  }
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(errors).toEqual([])
})

test('архивация: все 12 полей, статусы стыка, граница даты, пустая дата, внутреннее клеймо и атомарность', async ({ page }) => {
  const id = await seed()
  const state = await registry(page)
  const target = state.stamps.find(record => record.naksStamp === ACTIVE)!
  const candidate = { ...state, stamps: state.stamps.map(record => record.id === target.id ? { ...record, archived: true, archivedAt: '2026-08-01' } : record) }
  const keys = ['stamp_1_k','stamp_1_z','stamp_1_o','stamp_2_k','stamp_2_z','stamp_2_o',
    'stamp_1_k_fact','stamp_1_z_fact','stamp_1_o_fact','stamp_2_k_fact','stamp_2_z_fact','stamp_2_o_fact']
  for (const [index, key] of keys.entries()) {
    await withLineProgramFixture(async db => {
      await db.query(`update weld_joints set ${keys.filter(field => field !== key).map(field => `${field}=null`).join(',')},${key}=$2,weld_date=$3,
        officiality=$4,revision_actuality=$5 where id=$1`, [id, key.endsWith('_fact') ? ' вн-факт ' : ' ewa2 ',
        index % 2 ? '2026-08-02' : '2026-08-01', index % 2 ? 'неофициальный' : 'действующий', index % 3 ? 'неактуальная' : 'актуальная'])
    })
    await expect(save(page, candidate)).rejects.toThrow('Нельзя архивировать клеймо')
    expect((await snapshot(page)).revision).toBe(state.revision)
  }
  await withLineProgramFixture(async db => { await db.query('update weld_joints set weld_date=null where id=$1', [id]) })
  const archived = await save(page, candidate)
  expect(archived.stamps.find(record => record.id === target.id)?.archived).toBe(true)
  await expect(save(page, candidate)).rejects.toThrow('изменён другим пользователем')
  // Editing the archive date must recheck both aliases, and roll back the FIO edit too.
  await withLineProgramFixture(async db => { await db.query("update weld_joints set weld_date='2026-07-31' where id=$1", [id]) })
  const invalid = { ...archived, stamps: archived.stamps.map(record => ({ ...record, welderName: 'Не сохранять', ...(record.id === target.id ? { archivedAt: '2026-07-31' } : {}) })) }
  await expect(save(page, invalid)).rejects.toThrow('Нельзя архивировать клеймо')
  expect((await snapshot(page)).revision).toBe(archived.revision)
  // The next day is allowed; the existing archive date already meets this rule.
  const restored = await save(page, { ...archived, stamps: archived.stamps.map(record => record.id === target.id ? { ...record, archived: false, archivedAt: '' } : record) })
  await save(page, { ...restored, stamps: restored.stamps.map(record => record.id === target.id ? { ...record, archived: true, archivedAt: '2026-08-01' } : record) })
})

test('кнопка архива не сообщает об успехе при стыке сегодняшней даты; после очистки даты архив доступен', async ({ page }) => {
  const id = await seed()
  await withLineProgramFixture(async db => { await db.query('update weld_joints set weld_date=$2,stamp_2_o_fact=$3 where id=$1', [id, getTodayIsoDate(), 'ВН-ФАКТ']) })
  await registry(page)
  await page.getByRole('button', { name: /Фильтры и поиск/ }).click()
  await page.getByRole('textbox', { name: 'Поиск', exact: true }).fill(ACTIVE)
  await page.getByText(ACTIVE, { exact: true }).click()
  await page.getByRole('button', { name: 'В архив', exact: true }).click()
  await expect(page.getByText(/Нельзя архивировать клеймо/)).toBeVisible()
  expect((await snapshot(page)).stamps.find(record => record.naksStamp === ACTIVE)?.archived).toBe(false)
  await withLineProgramFixture(async db => { await db.query('update weld_joints set weld_date=null where id=$1', [id]) })
  await page.getByRole('button', { name: 'В архив', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).stamps.find(record => record.naksStamp === ACTIVE)?.archived).toBe(true)
})

test('сервер и импорт проверяют архив по итоговой строке; фактические данные остаются свободными', async ({ page }) => {
  const id = await seed()
  await registry(page)
  const { importWeldJoints: rawImportWeldJoints, massFillWeldJoints: rawMassFillWeldJoints } = await import('../../src/server/weld-import')
  const importWeldJoints = asE2eOwner(rawImportWeldJoints, 'welding.import')
  const massFillWeldJoints = asE2eOwner(rawMassFillWeldJoints, 'welding.import')
  const date = '2026-08-01'
  const input = { projectTitle: PROJECT, subtitleCode: 'ARCHIVE', line: 'ARC', joint: 'F8801', weldDate: date,
    connectionType: 'С17', weldingMethod: 'РАД', materialGroup: 'М01', d1: 108, d2: 108, t1: 6, t2: 6, stamp1K: ARCHIVED }
  await expect(importWeldJoints({ data: { records: [input] } })).rejects.toThrow('архиве')
  await importWeldJoints({ data: { records: [{ ...input, stamp1K: null, stamp1KFact: ARCHIVED }] } })
  await withLineProgramFixture(async db => { await db.query('update weld_joints set stamp_1_k=$2 where id=$1', [id, ARCHIVED]) })
  const version = await withE2eDatabase(async db => (await db.query('select xmin::text version from weld_joints where id=$1', [id])).rows[0].version)
  await expect(massFillWeldJoints({ data: { records: [{ id, weldDate: date }], expectedVersions: [{ id, version }] } })).rejects.toThrow('архиве')
  expect(await withE2eDatabase(async db => (await db.query('select weld_date from weld_joints where id=$1', [id])).rows[0].weld_date)).toBeNull()
})

test('архивация дожидается параллельного сохранения стыка и проверяет уже записанную дату', async ({ page }) => {
  const id = await seed(), state = await registry(page)
  const candidate = { ...state, stamps: state.stamps.map(record => record.naksStamp === ACTIVE
    ? { ...record, archived: true, archivedAt: '2026-08-01' } : record) }
  await withE2eDatabase(async writer => {
    await writer.query('begin')
    try {
      // Same shared lock as the weld save/import validation workflow.
      await writer.query("select pg_advisory_xact_lock_shared(hashtext('welder_stamp_registry'))")
      await writer.query("update weld_joints set weld_date='2026-08-01',stamp_1_k=$2 where id=$1", [id, ACTIVE])
      const pending = save(page, candidate).then(() => null, error => error as Error)
      await expect.poll(() => withE2eDatabase(async db => (await db.query(
        "select count(*)::int count from pg_locks where locktype='advisory' and not granted and objid=(hashtext('welder_stamp_registry')::bigint & 4294967295)::oid",
      )).rows[0].count)).toBeGreaterThan(0)
      await writer.query('commit')
      expect((await pending)?.message).toContain('Нельзя архивировать клеймо')
      expect((await snapshot(page)).revision).toBe(state.revision)
    } finally { await writer.query('rollback') }
  })
})

test('200000 стыков: проверка архивации выполняет один запрос и возвращает не больше одного конфликта', async () => {
  test.setTimeout(120_000)
  await seed()
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,stamp_1_k_fact)
      select p.id,p.project_title,p.subtitle_code,p.line,'F'||(9000+g),'2026-07-31','OTHER'
      from line_programs p cross join generate_series(1,200000) g where p.project_title=$1`, [PROJECT])
    await db.query('analyze weld_joints')
  })
  const { assertWelderStampArchiveDatesAreUnused } = await import('../../src/server/welder-stamps')
  const { prepareWelderStampRecordsForPersistence } = await import('../../src/lib/welder-stamp-persistence-validation')
  const archived = prepareWelderStampRecordsForPersistence([{ id: 999999, naksStamp: '', internalStamp: 'OTHER', naksPermits: [], dlsPermits: [], archived: true, archivedAt: '2026-08-01' }])
  await withE2eDatabase(async db => {
    const queries: string[] = []
    const connection = drizzle(db, { schema, logger: { logQuery(query) { queries.push(query) } } })
    await connection.transaction(async tx => {
      queries.length = 0 // Measure the guard, excluding transaction setup.
      const start = Date.now()
      await assertWelderStampArchiveDatesAreUnused(tx, [], archived)
      expect(queries).toHaveLength(1)
      expect(queries[0]).toContain('limit 1')
      console.info('Archive guard, 200001 fixture joints:', Date.now() - start, 'ms; queries:', queries.length)
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  })
})
