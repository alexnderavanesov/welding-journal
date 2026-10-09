import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { eq, getTableColumns } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { withE2eDatabase } from '../database'
import { linePrograms, weldJoints } from '../../src/db/schema'
import { loadRebuildWeldFacts } from '../../src/server/system-document-rebuild-facts'

test('компактные факты пересборки совпадают с обычным SELECT, включая ревизию всех полей', async () => {
  await withE2eDatabase(async client => {
    const db = drizzle(client)
    await client.query('begin')
    try {
      const [created] = await db.insert(weldJoints).values({ joint: 'FACT-transport', projectTitle: 'Точный  проект\u00a0',
        weldDate: '2026-10-09', d1: 57.123, d2: null, wdi: 0, pstoNote: '',
        preHeatTreatmentLnkExempt: false, layeredControlAssigned: true,
        createdAt: new Date('2026-09-01T23:59:59.123Z'), updatedAt: new Date('2026-10-09T00:00:00.987Z'),
        technologyCardNumber: 'ТК «12»\nстрока',
      }).returning({ id: weldJoints.id })
      const [ordinary] = await db.select().from(weldJoints).where(eq(weldJoints.id, created.id))
      const [compact] = await loadRebuildWeldFacts(db as never, [created.id])
      expect(compact.row).toEqual(Object.fromEntries(Object.entries(ordinary).filter(([, value]) => value !== null)))
      const originalRevision = createHash('sha256').update(JSON.stringify(Object.fromEntries(
        Object.keys(ordinary).filter(key => key !== 'dispatcherTasks').sort()
          .map(key => [key, ordinary[key as keyof typeof ordinary]]),
      ))).digest('base64url')
      expect(compact.revision).toBe(originalRevision)
      await db.update(weldJoints).set({ pstoNote: null }).where(eq(weldJoints.id, created.id))
      const [changed] = await loadRebuildWeldFacts(db as never, [created.id])
      expect(changed.revision).not.toBe(compact.revision)
      expect(changed.row.pstoNote).toBeUndefined()
      expect(await loadRebuildWeldFacts(db as never, [])).toEqual([])
    } finally { await client.query('rollback') }
  })
})

for (const timezone of ['UTC', 'Europe/Moscow', 'America/New_York']) {
  test(`все заполненные поля пересборки сохраняют значения и ревизию при ${timezone}`, async () => {
    await withE2eDatabase(async client => {
      const db = drizzle(client)
      await client.query('begin')
      try {
        await client.query("select set_config('TimeZone', $1, true)", [timezone])
        const [line] = await db.insert(linePrograms).values({ line: `FACT-${timezone}` }).returning({ id: linePrograms.id })
        const values = Object.fromEntries(Object.entries(getTableColumns(weldJoints)).flatMap(([key, column], index): Array<[string, unknown]> => {
          if (key === 'id') return []
          if (key === 'lineProgramId') return [[key, line.id]]
          if (column.getSQLType() === 'date') return [[key, '2026-03-08']]
          if (column.dataType === 'date') return [[key, new Date('2026-03-08T06:59:59.987Z')]]
          if (column.dataType === 'boolean') return [[key, index % 2 === 0]]
          if (column.dataType === 'number') return [[key, index % 2 === 0 ? 0 : 123456789.123]]
          if (column.dataType === 'string') return [[key, `${key}: М05 + М01\nТК «12»  \u00a0<&>`]]
          throw new Error(`Add an independent transport fixture for ${key}`)
        })) as typeof weldJoints.$inferInsert
        const [created] = await db.insert(weldJoints).values(values).returning({ id: weldJoints.id })
        const [ordinary] = await db.select().from(weldJoints).where(eq(weldJoints.id, created.id))
        const [compact] = await loadRebuildWeldFacts(db as never, [created.id])
        expect(compact.row).toEqual(ordinary)
        const revision = createHash('sha256').update(JSON.stringify(Object.fromEntries(
          Object.keys(ordinary).filter(key => key !== 'dispatcherTasks').sort()
            .map(key => [key, ordinary[key as keyof typeof ordinary]]),
        ))).digest('base64url')
        expect(compact.revision).toBe(revision)
      } finally { await client.query('rollback') }
    })
  })
}
