import { expect, test } from '@playwright/test'
import { asE2eOwner } from '../with-owner-access'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { editJournalJoint } from '../journal-grid'
import { createWeldJoint, updateWeldJoint } from '../../src/server/weld-mutations'
import { saveJournalCellEdits } from '../../src/server/journal-inline-edit'
import { changeCard, previewAssignments, applyAssignments } from '../../src/server/technology-cards'
import { TECHNOLOGY_CARD_MATERIAL_FIELDS } from '../../src/lib/technology-card-materials'
import type { WeldInput } from '../../src/lib/weld-fields'

const project = 'E2E TK materials', name = 'E2E TK material defaults'
const create = asE2eOwner(createWeldJoint, 'welding.edit'), update = asE2eOwner(updateWeldJoint, 'welding.edit')
const inline = asE2eOwner(saveJournalCellEdits, 'welding.edit')
const change = asE2eOwner(changeCard, 'references.edit'), preview = asE2eOwner(previewAssignments, 'welding.view'), apply = asE2eOwner(applyAssignments, 'welding.edit')
const saved = (id: number) => withE2eDatabase(async db => (await db.query('select *,xmin::text version from weld_joints where id=$1', [id])).rows[0])
const registry = () => withE2eDatabase(async db => (await db.query('select * from technology_cards where name=$1', [name])).rows[0])
const base: WeldInput = { projectTitle: project, subtitleCode: 'MAT', line: 'L', category: 'II', groupName: 'Б(а)', weldControlPercent: 0,
  weldingMethod: 'РАД', connectionType: 'С17', materialGroup: 'М01', d1: 57, d2: 159, t1: 6, t2: 3,
  stamp1KFact: 'TKA1', stamp1ZFact: 'TKA1', stamp1OFact: 'TKA1' }
test.afterEach(async ({ page }) => {
  await page.close(); await cleanupLineProgramProjects([project])
  await withLineProgramFixture(db => db.query('delete from technology_cards where name=$1', [name]))
})

test('material defaults, manual overrides and explicit refresh preserve empty-card fields and reject stale previews', async ({ page }, info) => {
  test.setTimeout(120000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/welder-stamps')
  await page.getByRole('tab', { name: 'Технологические карты', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить ТК', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Название ТК', { exact: true }).fill(name)
  await dialog.getByLabel('РАД', { exact: true }).check(); await dialog.getByLabel('М01', { exact: true }).check()
  await dialog.getByLabel('Тип соединения', { exact: true }).selectOption('С17')
  for (const [label, value] of [['Диаметр от', '57'], ['Диаметр до', '159'], ['Толщина от', '3'], ['Толщина до', '8']]) await dialog.getByLabel(label, { exact: true }).fill(value)
  for (const [field, label] of TECHNOLOGY_CARD_MATERIAL_FIELDS) {
    await expect(dialog.getByLabel(label, { exact: true })).toBeVisible()
    if (field !== 'fillerWire') await dialog.getByLabel(label, { exact: true }).fill(`ТК: ${field}`)
  }
  await page.screenshot({ path: info.outputPath('technology-card-materials.png') })
  await dialog.getByRole('button', { name: 'Сохранить ТК', exact: true }).click(); await expect(dialog).toBeHidden()
  const row = await create({ data: { ...base, joint: 'F981', weldDate: '2026-10-01', fillerWire: 'Ручная проволока' } })
  expect(await saved(row.id)).toMatchObject({
    welding_electrodes: 'ТК: weldingElectrodes', welding_electrodes_certificate_number: 'ТК: weldingElectrodesCertificateNumber',
    filler_wire: 'Ручная проволока', filler_wire_certificate_number: 'ТК: fillerWireCertificateNumber',
    shielding_gas: 'ТК: shieldingGas', shielding_gas_certificate_number: 'ТК: shieldingGasCertificateNumber',
  })
  await page.goto('/journal'); await editJournalJoint(page, 'F981')
  await dialog.getByRole('button', { name: 'Сварочный материал и ТК', exact: true }).click()
  await expect(dialog.getByLabel('Сварочные электроды', { exact: true })).toHaveValue('ТК: weldingElectrodes')
  await dialog.getByLabel('Сварочные электроды', { exact: true }).fill('Ручные электроды')
  await dialog.getByLabel('Защитный газ', { exact: true }).fill('Ручной газ')
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(dialog).toBeHidden()
  let current = await saved(row.id)
  expect(current.welding_electrodes).toBe('Ручные электроды')
  await update({ data: { id: row.id, expectedVersion: current.version, weldingJournalNote: 'Обычная правка сохраняет ручные значения' } })
  expect((await saved(row.id)).welding_electrodes).toBe('Ручные электроды')
  current = await saved(row.id)
  await inline({ edits: [{ id: row.id, version: current.version, values: { weldingElectrodes: 'Электроды из ячейки', fillerWire: null } }] })
  expect(await saved(row.id)).toMatchObject({ technology_card_number: current.technology_card_number,
    welding_electrodes: 'Электроды из ячейки', filler_wire: null, shielding_gas: 'Ручной газ' })
  await page.goto('/welder-stamps'); await page.getByRole('tab', { name: 'Технологические карты', exact: true }).click()
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'Изменить', exact: true }).click()
  await dialog.getByLabel('Сварочные электроды', { exact: true }).fill('Электроды после изменения ТК')
  await dialog.getByLabel('Защитный газ', { exact: true }).fill('')
  await dialog.getByLabel('Номер сертификата (электроды)', { exact: true }).fill('E-CERT-2')
  await dialog.getByLabel('Номер сертификата (проволока)', { exact: true }).fill('W-CERT-2')
  await dialog.getByLabel('Номер сертификата (газ)', { exact: true }).fill('G-CERT-2')
  await dialog.getByRole('button', { name: 'Сохранить ТК', exact: true }).click(); await expect(dialog).toBeHidden()
  expect((await saved(row.id)).welding_electrodes).toBe('Электроды из ячейки')
  await page.getByRole('button', { name: 'Проверить и назначить ТК', exact: true }).click()
  await dialog.getByRole('button', { name: 'Начать проверку', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: 'Обновить материалы', exact: true })).toBeChecked()
  await expect(dialog.getByText('Электроды после изменения ТК', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Электроды из ячейки', { exact: false })).toBeVisible()
  await dialog.getByRole('button', { name: 'Применить выбранное (1)', exact: true }).click()
  await page.getByRole('button', { name: 'Применить изменения', exact: true }).click()
  await expect(dialog.getByText('Результат операции', { exact: true })).toBeVisible()
  current = await saved(row.id)
  expect(current.welding_electrodes).toBe('Электроды после изменения ТК')
  expect(current.filler_wire).toBeNull()
  expect(current.shielding_gas).toBe('Ручной газ')
  expect(current).toMatchObject({ welding_electrodes_certificate_number: 'E-CERT-2', filler_wire_certificate_number: 'W-CERT-2', shielding_gas_certificate_number: 'G-CERT-2' })
  expect(current.welding_journal_note).toBe('Обычная правка сохраняет ручные значения')
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
  const before = await preview({})
  expect(before.chunks.reduce((sum, chunk) => sum + chunk.counts.materials, 0)).toBe(0)
  // A material-only registry change invalidates the entire preview fingerprint.
  const card = await registry()
  const parameters = { name, weldingMethods: card.welding_methods, connectionType: card.connection_type, materialGroups: card.material_groups,
    diameterFrom: card.diameter_from, diameterTo: card.diameter_to, thicknessFrom: card.thickness_from, thicknessTo: card.thickness_to, psto: card.psto,
    weldingElectrodes: 'Новая ревизия' }
  await change({ action: 'update', id: card.id, expectedRevision: card.revision, card: parameters })
  await expect(apply({ context: before.context, chunk: before.chunks[0], actions: ['materials'], excludedIds: [] })).rejects.toThrow('Реестр ТК')
  expect((await saved(row.id)).welding_electrodes).toBe(current.welding_electrodes)
  const fresh = await preview({})
  await inline({ edits: [{ id: row.id, version: current.version, values: { weldingElectrodes: 'Из другого окна' } }] })
  await expect(apply({ context: fresh.context, chunk: fresh.chunks[0], actions: ['materials'], excludedIds: [] })).rejects.toThrow('изменились')
  expect((await saved(row.id)).welding_electrodes).toBe('Из другого окна')
  expect(errors).toEqual([])
})
