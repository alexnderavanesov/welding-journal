import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import { previewPreHeatTreatmentBatch, savePreHeatTreatmentBatch } from '../../src/server/pre-heat-treatment-batch'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { asE2eOwner } from '../with-owner-access'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const owner = <A extends unknown[], R>(action: (...args: A) => Promise<R>) => asE2eOwner(action, 'welding.edit')

for (const required of [true, false]) test(`cross-line saved chain cannot bypass SP-09 in bulk required=${required}`, async () => {
  const project = `PRE-CHAIN-AUDIT-${randomUUID()}`
  try {
    const ids = await withLineProgramFixture(async db => {
      const ids = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,psto_required,pre_heat_treatment_required)
        values($1,'NK','L1','F1','да',$2),($1,'NK','L2','F1R1','да',$2) returning id`, [project, !required])).rows.map(row => row.id)
      await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id)
        values($1,'primary',$1,null),($2,'repair',$1,$1)`, ids)
      return ids
    })
    const snapshot = () => withE2eDatabase(async db => (await db.query('select *,xmin::text version from weld_joints where project_title=$1 order by id', [project])).rows)
    const before = await snapshot()
    for (const rowIds of [[ids[0]], [ids[1]], ids]) {
      if (rowIds.length === 1 && rowIds[0] === ids[1]) {
        // The root is outside this line: no misleading partial preview, and
        // even a forged confirmation must fail with the integrity diagnosis.
        await expect(owner(previewPreHeatTreatmentBatch)({ data: { rowIds, required } })).rejects.toThrow('СП-09')
        await expect(owner(savePreHeatTreatmentBatch)({ data: { rowIds, required, token: '0'.repeat(64) } })).rejects.toThrow('СП-09')
        expect(await snapshot()).toEqual(before)
        continue
      }
      const preview = await owner(previewPreHeatTreatmentBatch)({ data: { rowIds, required } })
      expect(preview.chains.some(chain => chain.reason?.includes('СП-09'))).toBe(true)
      await expect(owner(savePreHeatTreatmentBatch)({ data: { rowIds, required, token: preview.token } })).rejects.toThrow('СП-09')
      expect(await snapshot()).toEqual(before)
    }
  } finally { await cleanupLineProgramProjects([project]) }
})

test('LNK viewer with welding edit can mark and unmark empty chains, but cannot fill or delete control data', async ({ browser, baseURL }) => {
  await resetE2eAccountFixtureLimits()
  const project = `PRE-ACL-AUDIT-${randomUUID()}`, email = `pre-mark-${randomUUID()}@e2e.test`, password = 'preMark123!'
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    const id = await withLineProgramFixture(async db => (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,
      connection_type,has_vik,psto_required,pre_heat_treatment_required) values($1,'NK','NK-L','F882','2026-11-01','С17','да','да',false) returning id`, [project])).rows[0].id)
    await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Редактор отметки', email, title: '', role: 'user', permissions: ['welding.view', 'welding.edit', 'lnk.view'] })
    await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password })
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    await page.goto('/lnk')
    // Global search deliberately requires every specialty's view permission.
    // This account only needs the shared identity and its LNK selection.
    const select = async () => {
      const row = page.locator(`[data-lnk-grid] .ag-grid-scrolling-rows .ag-row[row-id="${id}"]`)
      await expect(row).toBeVisible()
      await expect(page.locator('[data-lnk-grid] .journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
      await row.getByRole('checkbox').check()
    }
    await select()
    const menu = page.getByRole('button', { name: 'НК до ТО', exact: true })
    await menu.click()
    await expect(page.getByRole('button', { name: 'Заполнить недостающее как «Годен»', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Поставить отметку', exact: true }).click()
    const enable = page.getByRole('dialog', { name: 'Поставить отметку НК до ТО', exact: true })
    await expect(enable.getByRole('button', { name: 'Поставить, оставить незаполненным', exact: true })).toBeEnabled()
    await expect(enable.getByRole('button', { name: 'Поставить и заполнить как «Годен»', exact: true })).toBeDisabled()
    await enable.getByRole('button', { name: 'Поставить, оставить незаполненным', exact: true }).click()
    await expect(enable).toBeHidden()
    const marked = () => withE2eDatabase(async db => (await db.query('select pre_heat_treatment_required value from weld_joints where id=$1', [id])).rows[0].value)
    expect(await marked()).toBe(true)
    await menu.click()
    await page.getByRole('button', { name: 'Снять отметку', exact: true }).click()
    const disable = page.getByRole('dialog', { name: 'Снять отметку НК до ТО', exact: true })
    await disable.getByRole('button', { name: 'Подтвердить снятие и удаление', exact: true }).click()
    await expect(disable).toBeHidden()
    expect(await marked()).toBe(false)
    await withE2eDatabase(async db => {
      await db.query('update weld_joints set pre_heat_treatment_required=true where id=$1', [id])
      await db.query("insert into pre_heat_treatment_controls(weld_joint_id,method,result) values($1,'ВИК','годен')", [id])
    })
    await page.reload()
    await select()
    await menu.click()
    await page.getByRole('button', { name: 'Снять отметку', exact: true }).click()
    await expect(disable.getByRole('alert')).toContainText('право удаления ЛНК')
    await expect(disable.getByRole('button', { name: 'Подтвердить снятие и удаление', exact: true })).toBeDisabled()
    await disable.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(await marked()).toBe(true)
  } finally {
    await context.close()
    await cleanupLineProgramProjects([project])
    await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})
