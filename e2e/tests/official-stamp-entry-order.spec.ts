import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import type { WeldPayload } from '../../src/server/weld-contracts'
import { createWeldJoint, updateWeldJoint, updateWeldJoints } from '../../src/server/weld-mutations'
import { importWeldJoints, massFillWeldJoints, replaceWeldJoints } from '../../src/server/weld-import'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { editJournalJoint, journalRow } from '../journal-grid'
import { FIELD_BY_KEY } from '../../src/lib/weld-fields'
import { ensureDispatcherTaskIndexFresh } from '../../src/server/dispatcher-task-index'
import { attachDispatcherTaskCodesToPage } from '../../src/server/weld-read'

const project = 'E2E qualification entry order'
const stamp = 'QEO1'
const factualStamp = 'QEF1'
const scope = { projectTitle: project, subtitleCode: 'ORDER', line: 'ORDER' }
const qualified: WeldPayload = {
  ...scope, connectionType: 'С17', weldingMethod: 'РАД', materialGroup: 'М01 + М05',
  weldDate: '2026-07-01', d1: 57, d2: 108, t1: 3, t2: 8, stamp1K: stamp,
}
let previousSettings: { value: string; updated_at: Date } | undefined
let settingsCaptured = false

test.beforeEach(async () => {
  await withLineProgramFixture(async db => {
    previousSettings = (await db.query("select value,updated_at from app_settings where key='save-check'")).rows[0]
    settingsCaptured = true
    const settings = { ...JSON.parse(previousSettings?.value ?? '{}'), officialDls: true }
    await db.query("insert into app_settings(key,value) values ('save-check',$1) on conflict(key) do update set value=excluded.value", [JSON.stringify(settings)])
    const permit = { id: 'naks', weldType: 'РАД', materialGroups: 'М01, М05', diameterFrom: '1', diameterTo: '108',
      thicknessFrom: '1', thicknessTo: '10', validFrom: '2026-01-01', validTo: '2026-12-31', note: '', archived: false }
    await db.query('insert into welder_stamps(naks_stamp,welder_name,naks_permits,dls_permits) values ($1,$2,$3,$4)',
      [stamp, 'Порядок ввода', JSON.stringify([permit]), JSON.stringify([{ ...permit, id: 'dls', number: 'ДЛС-QEO1', validFrom: '2026-06-01', validTo: '2026-08-31' }])])
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,$2,$3,'II','Б(а)',0,0)`, [scope.projectTitle, scope.subtitleCode, scope.line])
  })
})

test.afterEach(async ({ context }) => {
  await Promise.all(context.pages().map(page => page.close()))
  await cleanupLineProgramProjects([project])
  await withLineProgramFixture(async db => {
    await db.query('delete from welder_stamps where naks_stamp in ($1,$2)', [stamp, factualStamp])
    if (settingsCaptured) {
      if (previousSettings) await db.query("update app_settings set value=$1,updated_at=$2 where key='save-check'", [previousSettings.value, previousSettings.updated_at])
      else await db.query("delete from app_settings where key='save-check'")
    }
  })
  settingsCaptured = false
})

const stored = (id: number) => withE2eDatabase(async db => (await db.query(
  'select to_jsonb(w) record,xmin::text version from weld_joints w where id=$1', [id])).rows[0])

test('сначала клеймо: поздний ввод даты, способа, материалов и каждой стороны проверяется всеми путями записи', async () => {
  test.setTimeout(180_000)
  // Expectations come from the permit's explicit bounds, independently of the
  // production list of fields that trigger revalidation. Both dissimilar sides
  // must be covered; a valid second side cannot excuse the first one.
  const cases: Array<{ field: keyof WeldPayload; invalid: string | number; reason: RegExp }> = [
    { field: 'weldDate', invalid: '2025-12-31', reason: /СП-02.*сроку действия.*31.12.2025/s },
    { field: 'weldDate', invalid: '2026-09-01', reason: /СП-02.*ДЛС/s },
    { field: 'weldingMethod', invalid: 'РД', reason: /СП-02/ },
    { field: 'materialGroup', invalid: 'М01 + М11', reason: /СП-02/ },
    { field: 'd1', invalid: 159, reason: /СП-02.*159/s },
    { field: 'd2', invalid: 159, reason: /СП-02.*159/s },
    { field: 't1', invalid: 20, reason: /СП-02.*20/s },
    { field: 't2', invalid: 20, reason: /СП-02.*20/s },
    ...(['stamp1K', 'stamp1Z', 'stamp1O', 'stamp2K', 'stamp2Z', 'stamp2O'] as const)
      .map(field => ({ field, invalid: 'UNKNOWN-QEO', reason: /СП-02.*UNKNOWN-QEO/s })),
  ]
  let number = 91000
  const peer = await createWeldJoint({ data: { ...qualified, joint: `F${number++}` } })
  for (const scenario of cases) {
    const row = await createWeldJoint({ data: { ...qualified, joint: `F${number++}`, [scenario.field]: null } })
    const before = await stored(row.id), peerBefore = await stored(peer.id)
    const change = { id: row.id, [scenario.field]: scenario.invalid }
    const expectedVersions = [{ id: row.id, version: before.version }, { id: peer.id, version: peerBefore.version }]
    await test.step(`${scenario.field}=${scenario.invalid}`, async () => {
      await expect(updateWeldJoint({ data: { ...change, expectedVersion: before.version } })).rejects.toThrow(scenario.reason)
      await expect(updateWeldJoints({ data: {
        records: [{ id: peer.id, isometry: 'MUST-ROLL-BACK' }, change], expectedVersions,
      } })).rejects.toThrow(scenario.reason)
      await expect(massFillWeldJoints({ data: {
        records: [{ id: peer.id, spool: 'MUST-ROLL-BACK' }, change], expectedVersions,
      } })).rejects.toThrow(scenario.reason)
      await expect(replaceWeldJoints({ data: { records: [change], deleteIds: [peer.id], expectedVersions } })).rejects.toThrow(scenario.reason)
      expect(await stored(row.id)).toEqual(before)
      expect(await stored(peer.id)).toEqual(peerBefore)
      // A legitimate correction still works after every rejected request.
      await massFillWeldJoints({ data: {
        records: [{ id: row.id, [scenario.field]: scenario.field.startsWith('stamp') ? stamp : qualified[scenario.field] }], expectedVersions: [expectedVersions[0]],
      } })
    })
  }
})

test('прямое создание и импорт: все шесть официальных полей проверяются, фактические не запрещают сохранение', async () => {
  let number = 92000
  const official = ['stamp1K', 'stamp1Z', 'stamp1O', 'stamp2K', 'stamp2Z', 'stamp2O'] as const
  const factual = ['stamp1KFact', 'stamp1ZFact', 'stamp1OFact', 'stamp2KFact', 'stamp2ZFact', 'stamp2OFact'] as const
  for (const field of official) {
    const data = { ...qualified, joint: `F${number++}`, [field]: 'UNKNOWN-QEO' }
    await expect(createWeldJoint({ data })).rejects.toThrow(/СП-02.*UNKNOWN-QEO/s)
    await expect(importWeldJoints({ data: { records: [
      { ...qualified, joint: `F${number++}` }, data,
    ] } })).rejects.toThrow(/СП-02.*UNKNOWN-QEO/s)
  }
  expect(await withE2eDatabase(async db => (await db.query('select count(*)::int n from weld_joints where project_title=$1', [project])).rows[0].n)).toBe(0)
  const created = await createWeldJoint({ data: {
    ...qualified, joint: `F${number++}`, ...Object.fromEntries(factual.map(field => [field, 'UNKNOWN-QEO'])),
  } })
  expect((await stored(created.id)).record.stamp_2_o_fact).toBe('UNKNOWN-QEO')
})

test('поздний тип соединения повторно проверяет клеймо старой записи после утраты реестрового допуска', async () => {
  const row = await createWeldJoint({ data: { ...qualified, joint: 'F94000', connectionType: null } })
  const peer = await createWeldJoint({ data: { ...qualified, joint: 'F94001' } })
  // Model a legacy row whose registry reference no longer exists. The expected
  // rejection is independent of the deferred homogeneous angular-joint rule.
  await withLineProgramFixture(db => db.query('delete from welder_stamps where naks_stamp=$1', [stamp]))
  const before = await stored(row.id), peerBefore = await stored(peer.id)
  const change = { id: row.id, connectionType: 'С18' }
  const expectedVersions = [{ id: row.id, version: before.version }, { id: peer.id, version: peerBefore.version }]
  await expect(updateWeldJoint({ data: { ...change, expectedVersion: before.version } })).rejects.toThrow(/СП-02/s)
  await expect(updateWeldJoints({ data: { records: [{ id: peer.id, isometry: 'MUST-ROLL-BACK' }, change], expectedVersions } })).rejects.toThrow(/СП-02/s)
  await expect(massFillWeldJoints({ data: { records: [{ id: peer.id, spool: 'MUST-ROLL-BACK' }, change], expectedVersions } })).rejects.toThrow(/СП-02/s)
  await expect(replaceWeldJoints({ data: { records: [change], deleteIds: [peer.id], expectedVersions } })).rejects.toThrow(/СП-02/s)
  expect(await stored(row.id)).toEqual(before)
  expect(await stored(peer.id)).toEqual(peerBefore)
})

async function expectLegacyStampTask(id: number) {
  await ensureDispatcherTaskIndexFresh()
  expect(await withE2eDatabase(async db => (await db.query(
    "select exists(select 1 from dispatcher_row_tasks where weld_joint_id=$1 and code='СП-02') present", [id])).rows[0].present)).toBe(true)
  const [row] = await attachDispatcherTaskCodesToPage([{ id, dispatcherTasks: '' }])
  expect(String(row.dispatcherTasks)).toContain('СП-02')
}

for (const mode of ['Массовое заполнение', 'Замена данных'] as const) test(`Excel UI: ${mode} разрешает несвязанные правки старого клейма и сохраняет СП-02`, async ({ page }) => {
  const row = await createWeldJoint({ data: { ...qualified, joint: 'F96001', d2: null } })
  await withLineProgramFixture(db => db.query('delete from welder_stamps where naks_stamp=$1', [stamp]))
  const before = await stored(row.id)
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await expect(journalRow(page, row.id)).toBeVisible()
  await page.getByRole('button', { name: 'Импорт', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Импорт данных', exact: true })
  await dialog.getByRole('button', { name: mode, exact: true }).click()
  // Follow the visible workflow: downloading waits for the existing-row scope
  // and reveals the upload button. setInputFiles alone bypasses this UI gate.
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
  expect(await (await downloading).failure()).toBeNull()
  const apply = dialog.getByRole('button', { name: mode === 'Замена данных' ? /^Заменить/ : /^Заполнить/ })
  const upload = async (qualifying: boolean) => {
    const keys = ['isometry', 'weldingJournalNote', 'stamp1KFact', 'stamp1ZFact', 'stamp1OFact', 'stamp2KFact', 'stamp2ZFact', 'stamp2OFact'] as const
    const headers = ['ID записи', '__Версия записи', ...keys.map(key => FIELD_BY_KEY.get(key)!.label), ...(qualifying ? ['D2'] : [])]
    const values = [row.id, before.version, ...keys.map(key => key.startsWith('stamp') ? factualStamp : 'CORRECTED-EXCEL'), ...(qualifying ? [159] : [])]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, values]), 'Правки')
    await dialog.locator('input[type=file]').setInputFiles({ name: qualifying ? 'invalid-dimensions.xlsx' : 'unrelated.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) })
  }
  await upload(true)
  await expect(dialog.locator('#import-error-0')).toContainText('СП-02')
  await expect(apply).toBeDisabled()
  expect(await stored(row.id)).toEqual(before)
  await upload(false)
  await expect(dialog.locator('[id^="import-error-"]')).toHaveCount(0)
  await expect(apply).toBeEnabled()
  await apply.click()
  await expect(dialog).toBeHidden()
  expect((await stored(row.id)).record).toMatchObject({ isometry: 'CORRECTED-EXCEL', welding_journal_note: 'CORRECTED-EXCEL', stamp_1_k: stamp,
    d2: null, stamp_1_k_fact: factualStamp, stamp_1_z_fact: factualStamp, stamp_1_o_fact: factualStamp,
    stamp_2_k_fact: factualStamp, stamp_2_z_fact: factualStamp, stamp_2_o_fact: factualStamp })
  await expectLegacyStampTask(row.id)
})

test('старое клеймо: несвязанные серверные правки сохраняются всеми путями, СП-02 остаётся', async () => {
  const entries = ['single', 'bulk', 'mass', 'replacement'] as const
  const rows = []
  for (let index = 0; index < entries.length; index++) rows.push(await createWeldJoint({ data: { ...qualified, joint: `F${95010 + index}` } }))
  await withLineProgramFixture(db => db.query('delete from welder_stamps where naks_stamp=$1', [stamp]))
  for (const [index, entry] of entries.entries()) {
    const row = rows[index]
    const before = await stored(row.id)
    const record = { id: row.id, isometry: entry, weldingJournalNote: 'Уточнение факта', stamp2OFact: 'FACT-UNKNOWN' }
    const expectedVersions = [{ id: row.id, version: before.version }]
    if (entry === 'single') await updateWeldJoint({ data: { ...record, expectedVersion: before.version } })
    else if (entry === 'bulk') await updateWeldJoints({ data: { records: [record], expectedVersions } })
    else if (entry === 'mass') await massFillWeldJoints({ data: { records: [record], expectedVersions } })
    else await replaceWeldJoints({ data: { records: [record], deleteIds: [], expectedVersions } })
    const after = (await stored(row.id)).record
    expect(after).toMatchObject({ isometry: entry, welding_journal_note: 'Уточнение факта', stamp_2_o_fact: 'FACT-UNKNOWN', stamp_1_k: stamp })
    for (const key of ['weld_date', 'connection_type', 'welding_method', 'material_group', 'd1', 'd2', 't1', 't2']) expect(after[key]).toEqual(before.record[key])
    await expectLegacyStampTask(row.id)
  }
})

test('UI: несвязанные и все фактические клейма старого стыка сохраняются со СП-02, новые параметры блокируются', async ({ page }) => {
  const row = await createWeldJoint({ data: { ...qualified, joint: 'F95001' } })
  await withLineProgramFixture(async db => {
    await db.query('delete from welder_stamps where naks_stamp=$1', [stamp])
    await db.query('insert into welder_stamps(naks_stamp,welder_name) values($1,$2)', [factualStamp, 'Фактическое клеймо'])
  })
  await page.goto('/journal')
  await editJournalJoint(page, row.id)
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  await expect(dialog.getByRole('combobox', { name: 'Корень_1', exact: true })).toHaveValue(stamp)
  await dialog.getByRole('textbox', { name: 'Изометрия', exact: true }).fill('CORRECTED-LEGACY')
  const fields = ['stamp1KFact', 'stamp1ZFact', 'stamp1OFact', 'stamp2KFact', 'stamp2ZFact', 'stamp2OFact'] as const
  for (const field of fields) {
    const label = FIELD_BY_KEY.get(field)!.label
    await dialog.getByRole('combobox', { name: label, exact: true }).click()
    const search = dialog.getByRole('combobox', { name: `Поиск: ${label}`, exact: true })
    await search.fill('EF')
    await dialog.getByRole('listbox').getByRole('option', { name: factualStamp, exact: true }).click()
  }
  const save = dialog.getByRole('button', { name: 'Сохранить', exact: true })
  await expect(save).toBeEnabled()
  await save.click()
  await expect(dialog).toBeHidden()
  expect((await stored(row.id)).record).toMatchObject({ isometry: 'CORRECTED-LEGACY', stamp_1_k: stamp,
    stamp_1_k_fact: factualStamp, stamp_1_z_fact: factualStamp, stamp_1_o_fact: factualStamp,
    stamp_2_k_fact: factualStamp, stamp_2_z_fact: factualStamp, stamp_2_o_fact: factualStamp })
  await expectLegacyStampTask(row.id)
  await page.reload()
  await editJournalJoint(page, row.id)
  await expect(dialog.getByRole('combobox', { name: 'Корень_1', exact: true })).toHaveValue(stamp)
  for (const field of fields) await expect(dialog.getByRole('combobox', { name: FIELD_BY_KEY.get(field)!.label, exact: true })).toHaveValue(factualStamp)
  await dialog.getByRole('textbox', { name: 'D2', exact: true }).fill('159')
  await expect(save).toBeDisabled()
  await expect(dialog).toContainText('не найдено в реестре')
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect((await stored(row.id)).record.d2).toBe(108)
  await expectLegacyStampTask(row.id)
})

test('UI: клеймо сохраняется до заполнения параметров, затем неподходящая дата или сторона блокирует сохранение', async ({ page }) => {
  const created = await createWeldJoint({ data: { ...qualified, joint: 'F93000', weldDate: null, d1: null } })
  await page.goto('/journal')
  await editJournalJoint(page, created.id)
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  const save = dialog.getByRole('button', { name: 'Сохранить', exact: true })
  await expect(dialog.getByRole('combobox', { name: 'Корень_1', exact: true })).toHaveValue(stamp)
  await dialog.getByLabel('Дата сварки', { exact: true }).fill('2026-09-01')
  await dialog.getByRole('textbox', { name: 'D1', exact: true }).fill('57')
  await expect(save).toBeDisabled()
  await expect(dialog).toContainText('ДЛС')
  await dialog.getByLabel('Дата сварки', { exact: true }).fill('2026-07-01')
  await expect(save).toBeEnabled()
  await dialog.getByRole('textbox', { name: 'D1', exact: true }).fill('159')
  await expect(save).toBeDisabled()
  await dialog.getByRole('textbox', { name: 'D1', exact: true }).fill('57')
  await save.click()
  await expect(dialog).toBeHidden()
  await editJournalJoint(page, created.id)
  await expect(dialog.getByLabel('Дата сварки', { exact: true })).toHaveValue('2026-07-01')
  await expect(dialog.getByRole('textbox', { name: 'D1', exact: true })).toHaveValue('57')
  await expect(dialog.getByRole('combobox', { name: 'Корень_1', exact: true })).toHaveValue(stamp)
})
