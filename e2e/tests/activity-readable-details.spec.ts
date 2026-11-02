import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'

test('saved document history is readable, searchable, bounded and unchanged by viewing', async ({ page }, info) => {
  const operation = randomUUID()
  const before = { label: 'Заключение ПСТО', sourceKind: 'pstoCycle', cycleSequences: [1], positionCount: 1,
    projects: ['Риформинг'], lines: ['330-FG-03-000'], periodFrom: '2026-08-21', periodTo: '2026-08-21',
    sourcePositions: [{ kind: 'pstoCycle', weldJointId: 2881, relationId: 2881, sequence: 1 }] }
  const after = { ...before, positionCount: 2, lines: [...before.lines, '330-P42/P59-03-000'], periodTo: '2026-09-23',
    sourcePositions: [...before.sourcePositions, { kind: 'pstoCycle', weldJointId: 6832, relationId: 6832, sequence: 1 }] }
  const changes = [
    { label: '502', kind: 'update', changes: { rowCount: { before: 1, after: 2 }, sourceMetadata: { before: JSON.stringify(before), after: JSON.stringify(after) } } },
    { label: 'Риформинг-ПСТО-126', kind: 'delete', changes: { type: { before: 'system:pstoRequest' }, title: { before: 'Риформинг-ПСТО-126' }, mimeType: { before: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } } },
    { label: 'Служебное обновление', kind: 'update', changes: { sourceMetadata: { before: JSON.stringify(before), after: JSON.stringify({ ...before, rowIds: [2881] }) } } },
    { label: '', entity: 'generated_document_weld_joints', kind: 'update', changes: { documentId: { before: 268, after: 217 } } },
  ]
  await withE2eDatabase(async db => {
    await db.query("insert into audit_operations(id,actor_name,action,area,source) values ($1,'Проверка понятной истории','savePstoRepeatWorkflow','psto','application')", [operation])
    for (let i = 0; i < changes.length; i++) await db.query("insert into audit_changes(operation_id,entity,entity_id,label,area,kind,changes) values ($1,$2,$3,$4,'documents',$5,$6)", [operation, changes[i].entity ?? 'generated_documents', String(i), changes[i].label, changes[i].kind, JSON.stringify(changes[i].changes)])
  })
  const saved = () => withE2eDatabase(async db => (await db.query('select id,changes from audit_changes where operation_id=$1 order by id', [operation])).rows)
  const original = await saved()
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  try {
    await page.goto('/activity')
    const grid = page.getByRole('grid', { name: 'Журнал действий' })
    await expect(grid).toBeVisible()
    const first = grid.getByRole('row').filter({ hasText: 'Проверка понятной истории' })
    await expect(first).toBeVisible()
    for (const viewport of [{ width: 1600, height: 1000 }, { width: 1280, height: 720 }]) {
      await page.setViewportSize(viewport)
      await expect.poll(async () => {
        const box = await page.locator('.activity-panel').boundingBox()
        return Math.abs(viewport.height - box!.y - box!.height - 32)
      }).toBeLessThan(2)
      await expect(page.getByRole('button', { name: 'Далее', exact: true })).toBeInViewport()
    }
    await page.screenshot({ path: info.outputPath('activity-full-height.png'), fullPage: true })
    await first.getByRole('button', { name: 'Подробности', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Заявки и результаты ПСТО / ТВМТ' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('table')).toHaveCount(0)
    await expect(dialog.getByText('Обновлён состав связанных документов.')).toBeVisible()
    await expect(dialog.getByText(/Технические подробности|стык ID|documentId/)).toHaveCount(0)
    const count = calls.filter(name => name.startsWith('getActivityDetails')).length
    expect(count).toBe(1)
    await dialog.getByRole('button', { name: 'Документ · 502 · Изменение' }).click()
    await expect(dialog.getByRole('rowheader', { name: 'Количество стыков и позиций' })).toBeVisible()
    await expect(dialog.getByText('23.09.2026')).toBeVisible()
    await expect(dialog.getByText('330-P42/P59-03-000')).toBeVisible()
    await expect(dialog.getByText(/"sourceKind"/)).toHaveCount(0)
    await expect(dialog.getByText(/weldJointId|sourcePositions|relationId/)).toHaveCount(0)
    await expect(dialog.getByText('Состав позиций документа изменён.')).toBeVisible()
    await page.screenshot({ path: info.outputPath('activity-readable-desktop.png'), fullPage: true })
    await dialog.getByRole('textbox', { name: 'Найти запись на этой странице' }).fill('Риформинг-ПСТО-126')
    await dialog.getByRole('button', { name: 'Документ · Риформинг-ПСТО-126 · Удаление' }).click()
    await expect(dialog.getByRole('columnheader', { name: 'До удаления' })).toBeVisible()
    await expect(dialog.getByText('Заявка ПСТО', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Excel (.xlsx)')).toBeVisible()
    await expect(dialog.getByText('Не задано')).toHaveCount(0)
    await dialog.getByRole('textbox').fill('Служебное обновление')
    await dialog.getByRole('button', { name: 'Документ · Служебное обновление · Изменение' }).click()
    await expect(dialog.getByText('Обновлены дополнительные сведения.')).toBeVisible()
    await expect(dialog.getByText(/Технические подробности|rowIds|2881/)).toHaveCount(0)
    expect(calls.filter(name => name.startsWith('getActivityDetails'))).toHaveLength(count)
    await page.setViewportSize({ width: 390, height: 844 })
    await dialog.getByRole('textbox').fill('502')
    await dialog.getByRole('button', { name: 'Документ · 502 · Изменение' }).click()
    await expect(dialog.getByText('23.09.2026')).toBeVisible()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeInViewport()
    await page.screenshot({ path: info.outputPath('activity-readable-mobile.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await page.getByRole('button', { name: 'Далее', exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'Далее', exact: true })).toBeVisible()
    expect(await saved()).toEqual(original)
    expect(errors).toEqual([])
  } finally {
    await withE2eDatabase(async db => {
      await db.query('delete from audit_changes where operation_id=$1', [operation])
      await db.query('delete from audit_operations where id=$1', [operation])
    })
  }
})
