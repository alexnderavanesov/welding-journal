import { expect, it, vi } from 'vitest'
import { getTableColumns, sql, type SQL } from 'drizzle-orm'
import { integer, pgTable, primaryKey, PgDialect, type PgTable } from 'drizzle-orm/pg-core'
import { auditChanges, auditOperations, authUsers, generatedDocumentWeldJoints } from '@/db/schema'
import type { AccessIdentity } from '@/lib/access-permissions'
vi.mock('@/db', () => ({ requireDb: () => { throw new Error('No database in this unit regression') } }))
import { auditSql, withAuditedTransactions } from './audited-database'
import { accessContext } from './access-store'

type Link = { documentId: number; weldJointId: number; createdAt?: Date }
const identity: AccessIdentity = { id: 'composition-editor', name: 'Editor', title: '', email: '', role: 'user', revision: 1,
  permissions: ['documents.view', 'documents.edit', 'documents.delete'] }

// Only the database transport is replaced. The real transaction wrapper,
// schema/Drizzle metadata, before/after comparison and audit flush all run.
function harness(reads: Record<string, unknown>[][], expectedTable: PgTable = generatedDocumentWeldJoints) {
  const saved: Array<typeof auditChanges.$inferInsert> = []
  const operations: unknown[] = []
  const linkReads: Array<{ where?: SQL; order: unknown[]; lock?: string }> = []
  const tx: any = {
    execute: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    select: () => ({ from: (table: PgTable) => {
      const read: { where?: SQL; order: unknown[]; lock?: string } = { order: [] }
      const execute = async () => {
        if (table === authUsers) return [{ ...identity, status: 'active', emailVerified: true }]
        expect(table).toBe(expectedTable)
        linkReads.push(read)
        const rows = reads.shift()
        if (!rows) throw new Error('Unexpected membership read')
        return rows
      }
      const builder: any = {
        where: (where?: SQL) => { read.where = where; return builder },
        orderBy: (...order: unknown[]) => { read.order = order; return builder },
        for: (lock: string) => { read.lock = lock; return execute() },
        then: (resolve: any, reject: any) => execute().then(resolve, reject),
      }
      return builder
    } }),
    insert: (table: PgTable) => {
      let rows: any[] = [], selection: Record<string, unknown> | undefined
      const builder: any = {
        values: (value: any) => { rows = Array.isArray(value) ? value : [value]; return builder },
        returning: (value: Record<string, unknown>) => { selection = value; return builder },
        onConflictDoNothing: () => builder,
        then: (resolve: any, reject: any) => Promise.resolve().then(() => {
          if (table === auditChanges) { saved.push(...rows); return [] }
          if (table === auditOperations) { operations.push(...rows); return [] }
          expect(table).toBe(expectedTable)
          const columns = Object.entries(getTableColumns(table))
          return rows.map(row => Object.fromEntries(Object.entries(selection ?? {}).map(([alias, column]) => {
            const name = columns.find(([, candidate]) => candidate === column)?.[0]
            if (!name) throw new Error('Unexpected returning column')
            return [alias, row[name]]
          })))
        }).then(resolve, reject),
      }
      return builder
    },
  }
  const db = withAuditedTransactions({ transaction: async (run: (tx: any) => unknown) => run(tx) } as any)
  return { saved, operations, linkReads, run: (operation: (current: any) => Promise<unknown>) => accessContext.run({
    identity, operationId: 'composition-regression', operation: 'applyDocumentOperation', area: 'documents',
    permissions: ['documents.edit', 'documents.delete'],
  }, () => db.transaction(operation)) }
}

const links: Link[] = [
  { documentId: 11, weldJointId: 101 },
  { documentId: 11, weldJointId: 102 },
  { documentId: 12, weldJointId: 101 },
]
const scope = { table: generatedDocumentWeldJoints, where: sql`${generatedDocumentWeldJoints.documentId} in (11, 12)` }

it('records each new document/joint pair with both ordered key parts and its own joint history', async () => {
  const h = harness([[], links])
  await h.run(tx => auditSql(tx, [scope], async () => undefined))
  expect(h.saved.map(row => [row.entityId, row.jointId, row.kind])).toEqual([
    ['11:101', 101, 'create'], ['11:102', 102, 'create'], ['12:101', 101, 'create'],
  ])
  expect(h.saved.map(row => row.changes)).toEqual(links.map(row => ({
    documentId: { after: row.documentId }, weldJointId: { after: row.weldJointId },
  })))
  expect(h.operations).toHaveLength(1)
})

it('keeps every removed pair and its original values after document composition deletion', async () => {
  const h = harness([links, []])
  await h.run(tx => auditSql(tx, [scope], async () => undefined))
  expect(h.saved.map(row => [row.entityId, row.jointId, row.kind])).toEqual([
    ['11:101', 101, 'delete'], ['11:102', 102, 'delete'], ['12:101', 101, 'delete'],
  ])
  expect(h.saved.map(row => row.changes)).toEqual(links.map(row => ({
    documentId: { before: row.documentId }, weldJointId: { before: row.weldJointId },
  })))
})

it('records same-count replacement as the exact added and removed pair, leaving retained pairs alone', async () => {
  const after = [{ documentId: 12, weldJointId: 102 }, links[1], links[2]]
  const h = harness([links, after])
  await h.run(tx => auditSql(tx, [scope], async () => undefined))
  expect(h.saved.map(row => [row.entityId, row.jointId, row.kind]).sort()).toEqual([
    ['11:101', 101, 'delete'], ['12:102', 102, 'create'],
  ])
  expect(h.saved.find(row => row.kind === 'create')?.changes).toEqual({ documentId: { after: 12 }, weldJointId: { after: 102 } })
  expect(h.saved.find(row => row.kind === 'delete')?.changes).toEqual({ documentId: { before: 11 }, weldJointId: { before: 101 } })
})

it('omits a composition rebuild that only changes technical timestamps', async () => {
  const h = harness([links.map(row => ({ ...row, createdAt: new Date('2026-01-01') })),
    [...links].reverse().map(row => ({ ...row, createdAt: new Date('2026-11-13') }))])
  await h.run(tx => auditSql(tx, [scope], async () => undefined))
  expect(h.saved).toEqual([])
  expect(h.operations).toEqual([])
})

it('limits insert pre-read and locks to the submitted composite keys, never the entire relation table', async () => {
  const h = harness([[]])
  await h.run(async tx => { await tx.insert(generatedDocumentWeldJoints).values([links[0], links[2]]) })
  expect(h.linkReads).toHaveLength(1)
  expect(h.linkReads[0].where).toBeDefined()
  const query = new PgDialect().sqlToQuery(h.linkReads[0].where!)
  expect(query.params).toEqual([11, 101, 12, 101])
  expect(query.sql).toContain('"document_id"')
  expect(query.sql).toContain('"weld_joint_id"')
  expect(h.linkReads[0].lock).toBe('update')
  expect(h.saved.map(row => row.entityId)).toEqual(['11:101', '12:101'])
})

it('uses declared composite-key order even when property declaration order differs', async () => {
  const table = pgTable('audit_composite_order_fixture', {
    joint: integer('joint_id').notNull(), document: integer('document_id').notNull(),
  }, columns => [primaryKey({ columns: [columns.document, columns.joint] })])
  const h = harness([[], [{ document: 11, joint: 101 }, { document: 12, joint: 102 }]], table)
  await h.run(tx => auditSql(tx, [{ table, where: sql`true` }], async () => undefined))
  expect(h.saved.map(row => row.entityId)).toEqual(['11:101', '12:102'])
})

it('rejects a keyless raw-audit scope before reading or executing its mutation', async () => {
  const table = pgTable('audit_keyless_fixture', { value: integer('value') })
  const h = harness([], table), mutate = vi.fn(async () => undefined)
  await expect(h.run(tx => auditSql(tx, [{ table, where: sql`true` }], mutate)))
    .rejects.toThrow('Запись истории требует первичного ключа таблицы.')
  expect(h.linkReads).toEqual([])
  expect(mutate).not.toHaveBeenCalled()
  expect(h.saved).toEqual([])
})
