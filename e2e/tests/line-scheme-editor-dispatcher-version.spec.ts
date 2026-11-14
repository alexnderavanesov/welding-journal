import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture } from '../line-program-fixtures'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'
import { filterSchemeProject } from '../line-scheme-grid'
import { deserializeRpcPayload, deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import { markDispatcherTaskIndexDirty } from '../../src/server/dispatcher-task-index-dirty'

const trackProject = schemeFixtureCleanup(test)
const isRpc = (url: string, name: string) => url.includes('/_serverFn/') && rpcName(url) === `${name}_createServerFn_handler`

test('app-created joint: dispatcher refresh preserves the open PDF editor version and draft', async ({ page, baseURL }, info) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Uses the compiled real RPC manifest')
  test.setTimeout(120_000)
  const projectTitle = `Scheme coherent version ${randomUUID()}`
  const subtitleCode = 'VERSION', line = 'COHERENT-PDF'
  trackProject(info, projectTitle)
  // Only the empty line is synthetic. The weld and its initial status/version
  // must be created by the real application, never repaired with test SQL.
  await withLineProgramFixture(db => db.query(`insert into line_programs
    (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,psto_assignment)
    values($1,$2,$3,'II','A',100,100,'unassigned')`, [projectTitle, subtitleCode, line]))
  const boot = page.waitForResponse(response => isRpc(response.url(), 'getLineSchemes'))
  await page.goto('/line-schemes')
  const observed = (await boot).url()
  const call = async <T,>(name: string, data: unknown): Promise<T> => {
    const response = await page.request.post(siblingRpcUrl(observed, `${name}_createServerFn_handler`), {
      data: await serializeRpcData(data),
      headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    })
    expect(response.ok()).toBe(true)
    const payload = await deserializeRpcResponse(await response.text()) as { result?: T; error?: Error }
    expect(payload.error, `${name}: ${payload.error?.message}`).toBeUndefined()
    return payload.result as T
  }
  const created = await call<{ id: number; finalStatus: string; rowVersion: string }>('createWeldJoint', {
    projectTitle, subtitleCode, line, joint: 'S1', connectionType: 'С17', weldingMethod: 'РД', materialGroup: 'М01',
    d1: 57, d2: 57, t1: 3, t2: 3,
  })
  expect(created.finalStatus).toBe('ожидает сварку')
  expect(created.rowVersion).toMatch(/^\d+$/)
  const stored = () => withE2eDatabase(async db => (await db.query<{ version: string; row: Record<string, unknown> }>(
    'select w.xmin::text version,to_jsonb(w) row from weld_joints w where id=$1', [created.id])).rows[0])
  const createdStored = await stored()
  expect(createdStored.version).toBe(created.rowVersion)
  expect(createdStored.row.final_status).toBe('ожидает сварку')
  expect((await call<{ isFresh: boolean }>('refreshDispatcherTaskSnapshot', {})).isFresh).toBe(true)
  expect(await stored()).toEqual(createdStored)

  await filterSchemeProject(page, projectTitle)
  const pdf = await PDFDocument.create()
  pdf.addPage([842, 595])
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('row').filter({ hasText: projectTitle }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  await (await chooser).setFiles({ name: 'Coherent.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) })
  await page.getByRole('dialog', { name: `Файлы и архив линии ${line}`, exact: true })
    .getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  const scheme = page.getByRole('dialog', { name: `Схема линии ${line}`, exact: true })
  const layer = scheme.locator('[data-scheme-point-layer="1"]')
  await expect(layer).toBeVisible()
  await scheme.getByRole('button', { name: 'S1', exact: true }).click()
  await layer.click({ position: { x: 260, y: 190 } })
  const point = scheme.locator('[data-scheme-point]')
  await expect(point).toHaveCount(1)
  await point.click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Открыть картину стыка', exact: true }).click()
  const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Картина стыка S1', exact: true }) })
  await expect(picture).toBeVisible()
  const editorRead = page.waitForResponse(response => isRpc(response.url(), 'getWeldJointById'))
  await picture.getByRole('button', { name: 'Редактировать', exact: true }).click()
  const editorPayload = await deserializeRpcResponse(await (await editorRead).text()) as {
    result: { id: number; rowVersion: string; finalStatus: string }; error?: Error
  }
  expect(editorPayload.error).toBeUndefined()
  expect(editorPayload.result).toMatchObject({ id: created.id, rowVersion: created.rowVersion, finalStatus: 'ожидает сварку' })
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  await expect(editor).toBeVisible()
  await editor.getByRole('textbox', { name: 'Изометрия', exact: true }).fill('ISO-COHERENT-AFTER-REFRESH')
  const beforeRefresh = await stored()
  expect(beforeRefresh.version).toBe(editorPayload.result.rowVersion)
  // Make a real scoped calculation necessary, without modifying any weld fact
  // or its version. This is test orchestration on the isolated fixture DB.
  const dirty = await withE2eDatabase(async db => {
    await markDispatcherTaskIndexDirty(drizzle(db), { scopes: [{ projectTitle, subtitleCode, line }] })
    return (await db.query<{ source_revision: number; computed_revision: number }>(
      'select source_revision,computed_revision from dispatcher_task_index_state where id=1')).rows[0]
  })
  expect(Number(dirty.source_revision)).toBeGreaterThan(Number(dirty.computed_revision))
  const refreshed = await call<{ isFresh: boolean; sourceRevision: number; computedRevision: number }>('refreshDispatcherTaskSnapshot', {})
  expect(refreshed.isFresh).toBe(true)
  expect(refreshed.computedRevision).toBeGreaterThanOrEqual(Number(dirty.source_revision))
  const afterRefresh = await stored()
  expect(afterRefresh).toEqual(beforeRefresh)
  await expect(editor.getByRole('textbox', { name: 'Изометрия', exact: true })).toHaveValue('ISO-COHERENT-AFTER-REFRESH')

  const savedResponse = page.waitForResponse(response => isRpc(response.url(), 'updateWeldJoint'))
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  const response = await savedResponse
  const submitted = deserializeRpcPayload(response.request().postData()!) as { data: { expectedVersion: string } }
  expect(submitted.data.expectedVersion).toBe(editorPayload.result.rowVersion)
  const savedPayload = await deserializeRpcResponse(await response.text()) as { error?: Error }
  expect(savedPayload.error).toBeUndefined()
  await expect(editor).not.toBeVisible()
  await expect(point).toHaveCount(1)
  await expect(scheme.getByRole('button', { name: /^Сохранить/ })).toBeEnabled()
  const afterSave = await stored()
  expect(afterSave.version).not.toBe(beforeRefresh.version)
  expect(afterSave.row).toMatchObject({ isometry: 'ISO-COHERENT-AFTER-REFRESH', final_status: 'ожидает сварку' })
  await info.attach('coherent-editor-refresh-versions', { contentType: 'application/json', body: JSON.stringify({
    id: created.id, createdVersion: created.rowVersion, editorVersion: editorPayload.result.rowVersion,
    beforeRefreshVersion: beforeRefresh.version, afterRefreshVersion: afterRefresh.version,
    saveExpectedVersion: submitted.data.expectedVersion, savedVersion: afterSave.version,
    initialStatus: created.finalStatus, savedStatus: afterSave.row.final_status, dirty,
    refreshed: { isFresh: refreshed.isFresh, sourceRevision: refreshed.sourceRevision, computedRevision: refreshed.computedRevision },
  }, null, 2) })
})
