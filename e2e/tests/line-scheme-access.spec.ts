import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import type { Permission } from '../../src/lib/access-permissions'
import type { SchemeJoint, SchemeWeldInfo } from '../../src/lib/line-schemes'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture } from '../line-program-fixtures'
import { filterSchemeProject } from '../line-scheme-grid'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import { asE2eOwner } from '../with-owner-access'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'

const trackProject = schemeFixtureCleanup(test)

test('scheme RPCs and tooltips preserve labels/statuses without bypassing welding-field access', async ({ page, browser, context, baseURL }, info) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the real production RPC manifest and response middleware')
  test.setTimeout(120_000)
  await resetE2eAccountFixtureLimits()
  const project = `SCHEME-ACCESS-${randomUUID()}`, line = 'SCHEME-ACL'
  trackProject(info, project)
  const contexts: BrowserContext[] = [], accounts: string[] = []
  const expectedInfo: SchemeWeldInfo = {
    date: '2014-04-17', material1: 'PRIVATE-STEEL-1', material2: 'PRIVATE-STEEL-2', element1: 'PRIVATE-MATERIAL-1', element2: 'PRIVATE-MATERIAL-2',
    d1: 108, d2: 89, t1: 6, t2: 4, stamp1: 'PRIVATE-OFFICIAL-1', stamp1Fact: 'PRIVATE-FACTUAL-1', stamp2: 'PRIVATE-OFFICIAL-2', stamp2Fact: 'PRIVATE-FACTUAL-2',
  }
  const fixture = await withLineProgramFixture(async db => {
    const lineId = (await db.query(`insert into line_programs(project_title,subtitle_code,line,psto_assignment)
      values($1,'ACL',$2,'unassigned') returning id`, [project, line])).rows[0].id as number
    const ids = (await db.query<{ id: number }>(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,
      officiality,revision_actuality,connection_type,weld_date,has_vik,vik_result,psto_required,
      material_1,material_2,element_1,element_2,d1,d2,t1,t2,stamp_1_k,stamp_1_k_fact,stamp_1_z,stamp_1_z_fact,lnk_note,psto_note)
      select $1,$2,'ACL',$3,'S'||n,'действующий','актуальная','С17','2014-04-17','Да','годен','Нет',
      'PRIVATE-STEEL-1','PRIVATE-STEEL-2','PRIVATE-MATERIAL-1','PRIVATE-MATERIAL-2',108,89,6,4,
      'PRIVATE-OFFICIAL-1','PRIVATE-FACTUAL-1','PRIVATE-OFFICIAL-2','PRIVATE-FACTUAL-2','PRIVATE-LNK','PRIVATE-PSTO'
      from generate_series(1,2) n returning id`, [lineId, project, line])).rows.map(row => row.id)
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where line_program_id=$1`, [lineId])
    return { lineId, ids }
  })
  try {
    await page.goto('/line-schemes')
    await filterSchemeProject(page, project)
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('row').filter({ hasText: project }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
    const pdf = await PDFDocument.create(); pdf.addPage([842, 595])
    await (await chooser).setFiles({ name: 'Access drawing.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) })
    const files = page.getByRole('dialog', { name: `Файлы и архив линии ${line}`, exact: true })
    const readResponse = page.waitForResponse(response => response.url().includes('/_serverFn/') && /^getLineSchemeJoints(?:_|$)/.test(rpcName(response.url())))
    await files.getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
    const observed = await readResponse
    expect(observed.ok()).toBe(true)
    const dialog = page.getByRole('dialog', { name: `Схема линии ${line}`, exact: true })
    const layer = dialog.locator('[data-scheme-point-layer="1"]')
    await expect(layer).toBeVisible()
    await dialog.getByRole('button', { name: 'S1', exact: true }).click()
    await layer.click({ position: { x: 220, y: 180 } })
    await dialog.getByRole('button', { name: /^Сохранить/ }).click()
    await expect(dialog.getByRole('button', { name: 'S1 Лист 1', exact: true })).toHaveAttribute('data-scheme-placement', 'saved')
    const revisionId = await dialog.getByLabel('Редакция PDF').inputValue()
    const bundleId = await withE2eDatabase(async db => (await db.query('select id from line_scheme_bundles where line_program_id=$1', [fixture.lineId])).rows[0].id as number)
    await dialog.locator('[data-scheme-point]').hover()
    const ownerTip = page.getByRole('tooltip', { name: 'Сведения о стыке S1', exact: true })
    await expect(ownerTip).toContainText('PRIVATE-FACTUAL-1')
    await expect(ownerTip).toContainText('17.04.2014')
    await dialog.getByRole('button', { name: 'Закрыть схему', exact: true }).click()

    const call = async (client: APIRequestContext, name: string, data: unknown, denied = false, method = 'GET') => {
      const url = new URL(siblingRpcUrl(observed.url(), `${name}_createServerFn_handler`))
      const encoded = await serializeRpcData(data)
      if (method === 'GET') url.searchParams.set('payload', encoded)
      const response = await client.fetch(url.toString(), { method, ...(method === 'POST' ? { data: encoded } : {}), headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'x-tsr-serverFn': 'true', 'content-type': 'application/json' } })
      expect(response.headers()['cache-control']).toContain('no-store')
      const payload = await deserializeRpcResponse(await response.text()) as { result?: any; error?: Error }
      if (denied) { expect(payload.error, name).toBeDefined(); expect(payload.result).toBeUndefined(); return }
      expect(payload.error).toBeUndefined()
      return payload.result
    }
    const readAll = async (client: APIRequestContext) => {
      const joints = await call(client, 'getLineSchemeJoints', { bundleId, revisionId })
      const points = await call(client, 'getLineSchemePoints', { revisionId, page: 1 })
      const drafts = await call(client, 'getLineSchemeDraftStates', { bundleId, roots: [fixture.ids[1]] })
      expect(joints.rows).toHaveLength(2); expect(points.points).toHaveLength(1); expect(drafts).toHaveLength(1)
      return [joints.rows[0], points.points[0].joint, drafts[0]] as SchemeJoint[]
    }
    const owner = await readAll(context.request)
    for (const joint of owner) expect(joint.weldInfo).toEqual(expectedInfo)

    for (const extra of [[], ['lnk.view'], ['welding.view']] as Permission[][]) {
      const canInspect = extra.includes('welding.view')
      const email = `scheme-viewer-${randomUUID()}@e2e.test`, password = 'scheme123!'
      accounts.push(email)
      await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Читатель схем', email, title: '', role: 'user', permissions: ['schemes.view', ...extra] })
      await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password })
      const viewer = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
      contexts.push(viewer)
      expect((await viewer.request.post('/api/auth/sign-in/email', { data: { email, password }, headers: { origin: baseURL! } })).ok()).toBe(true)
      const expected = Object.fromEntries(Object.keys(expectedInfo).map(key => [key, null]))
      if (extra.includes('lnk.view')) Object.assign(expected, { d1: 108, d2: 89, t1: 6, t2: 4 })
      if (canInspect) Object.assign(expected, expectedInfo)
      const reads = await readAll(viewer.request)
      for (const [index, joint] of reads.entries()) {
        expect(joint).toEqual({ ...owner[index], weldInfo: expected })
        if (!canInspect) {
          expect(JSON.stringify(joint)).not.toContain('PRIVATE-')
          expect(JSON.stringify(joint)).not.toContain('2014-04-17')
        }
      }
      // The existing operation matrix requires journal viewing for both
      // picture reads. Scheme/other-specialty rights must not bypass it.
      for (const name of ['getWeldJointById', 'listWeldJointChain']) {
        const read = await call(viewer.request, name, { id: fixture.ids[0] }, !canInspect)
        if (canInspect) {
          expect(JSON.stringify(read)).toContain('2014-04-17')
          expect(JSON.stringify(read)).not.toContain('PRIVATE-LNK')
          expect(JSON.stringify(read)).not.toContain('PRIVATE-PSTO')
        }
      }
      await call(viewer.request, 'updateWeldJoint', { id: fixture.ids[0], mutationScope: 'welding', weldingJournalNote: 'forbidden' }, true, 'POST')
      const tab = await viewer.newPage()
      await tab.goto('/line-schemes')
      await filterSchemeProject(tab, project)
      await tab.getByRole('row').filter({ hasText: project }).getByRole('button', { name: 'Access drawing', exact: true }).click()
      const drawing = tab.getByRole('dialog', { name: `Схема линии ${line}`, exact: true })
      const marker = drawing.locator('[data-scheme-point]')
      await expect(marker).toBeVisible()
      await marker.hover()
      const tooltip = tab.getByRole('tooltip', { name: 'Сведения о стыке S1', exact: true })
      await expect(tooltip).toBeVisible()
      await expect(drawing.getByRole('button', { name: /^Сохранить/ })).toBeDisabled()
      if (canInspect) {
        await expect(tooltip).toContainText('PRIVATE-FACTUAL-1')
        await expect(tooltip).toContainText('17.04.2014')
      } else {
        await expect(tooltip).not.toContainText('PRIVATE-')
        await expect(tooltip).not.toContainText('17.04.2014')
      }
      if (canInspect || extra.includes('lnk.view')) await expect(tooltip).toContainText('Ø 108 × 6')
      else await expect(tooltip).not.toContainText('Ø 108')
      await marker.click({ button: 'right' })
      const inspect = tab.getByTestId('context-action-menu').getByRole('button', { name: 'Открыть картину стыка', exact: true })
      if (!canInspect) {
        await expect(inspect).toBeDisabled()
        await expect(inspect).toContainText('Для картины стыка нужен просмотр сварочного журнала')
      }
      else {
        const chainRead = tab.waitForResponse(response => response.url().includes('/_serverFn/') && /^listWeldJointChain(?:_|$)/.test(rpcName(response.url())))
        await inspect.click()
        expect((await chainRead).ok()).toBe(true)
        await expect(tab.getByRole('heading', { name: 'Картина стыка S1', exact: true })).toBeVisible()
        await expect(tab.getByText('Загружаем историю и действия стыка...', { exact: true })).not.toBeVisible()
        await expect(tab.getByText('Не удалось загрузить историю и действия стыка.', { exact: true })).not.toBeVisible()
        await expect(tab.locator('body')).not.toContainText('PRIVATE-LNK')
        await expect(tab.locator('body')).not.toContainText('PRIVATE-PSTO')
      }
      await viewer.close()
    }
  } finally {
    for (const viewer of contexts) await viewer.close()
    if (accounts.length) await withE2eDatabase(db => db.query('delete from auth_users where email=any($1::text[])', [accounts]))
    // The afterEach hook removes this fixture's drawing and journal project;
    // temporary PDF bytes remain owned by the isolated runner directory.
  }
})
