import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { deserializeRpcResponse, rpcName } from '../rpc'

test('повтор импорта после потери ответа возвращает те же стыки и сохраняет одну запись истории', async ({ page }) => {
  const project = 'E2E lost import acknowledgement'
  try {
    await page.goto('/journal')
    await page.getByRole('button', { name: 'Импорт', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Импорт данных', exact: true })
    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
    const book = XLSX.read(await readFile((await (await download).path())!), { type: 'buffer' })
    const sheet = book.Sheets[book.SheetNames[0]]
    const headers = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })[0].map(String)
    const cells: Record<string, string> = { Проект: project, Шифр: 'ACK', Линия: 'RETRY', Стык: 'F955' }
    XLSX.utils.sheet_add_aoa(sheet, [headers.map(header => cells[header] ?? '')], { origin: 'A2' })
    const file = { name: 'retry.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) }
    await dialog.locator('input[type=file]').setInputFiles(file)
    const save = dialog.getByRole('button', { name: 'Импортировать 1 строк', exact: true })
    let dropped = false
    await page.route('**/_serverFn/**', async route => {
      if (dropped || !rpcName(route.request().url()).startsWith('importWeldJoints_')) return route.continue()
      dropped = true
      const results = await Promise.all([route.fetch(), route.fetch()])
      const bodies = await Promise.all(results.map(async response => {
        expect(response.ok()).toBe(true)
        return await deserializeRpcResponse(await response.text()) as { result: { inserted: number; rows: { id: number }[] } }
      }))
      expect(bodies[0].result.inserted).toBe(1)
      expect(bodies[1].result).toEqual(bodies[0].result)
      await route.abort('connectionreset')
    })
    await save.click()
    await expect(dialog.getByText(/Подтверждение от сервера не получено/)).toContainText('Нажмите «Импортировать» ещё раз в этом окне')
    await save.click()
    await expect(dialog).toBeHidden()
    const facts = () => withE2eDatabase(db => db.query(`
      select count(distinct j.id)::int as joints, count(c.id)::int as creates
      from weld_joints j left join audit_changes c on c.joint_id=j.id and c.entity='weld_joints' and c.kind='create'
      where j.project_title=$1
    `, [project]))
    expect((await facts()).rows).toEqual([{ joints: 1, creates: 1 }])

    await page.getByRole('button', { name: 'Импорт', exact: true }).click()
    const nextDownload = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
    await nextDownload
    const chooser = page.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Загрузить шаблон', exact: true }).click()
    await (await chooser).setFiles(file)
    await expect(save).toBeEnabled()
    expect((await facts()).rows).toEqual([{ joints: 1, creates: 1 }])
    await save.click()
    await expect(dialog).toBeHidden()
    expect((await facts()).rows).toEqual([{ joints: 2, creates: 2 }])
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project])
  }
})
