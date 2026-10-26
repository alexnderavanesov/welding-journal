import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { dispatcherTaskIndexState, welderStamps, welderStampSuspensions, weldJoints } from '@/db/schema'
import { prepareWelderStampRecordsForPersistence } from '@/lib/welder-stamp-persistence-validation'

const storage = vi.hoisted(() => ({ requireDb: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: storage.requireDb }))
vi.mock('@/server/security-functions', () => ({ assertSecurityScope: vi.fn() }))
// Exercise the actual handler/transaction and business validation without HTTP.
vi.mock('@tanstack/react-start', () => ({ createServerOnlyFn: (fn: unknown) => fn, createServerFn: () => {
  const builder = { validator: (_validator: unknown) => builder, handler: (handler: unknown) => handler }
  return builder
} }))

import {
  assertRegistryRevision,
  assertWelderStampArchiveDatesAreUnused,
  getRemovedWelderStampReferenceAliases,
  loadWelderStampRegistrySnapshot,
  saveWelderStampRecords,
  saveWelderStampSuspensionRecords,
} from '@/server/welder-stamps'

beforeEach(() => vi.clearAllMocks())

function registryDatabase(options: { scopes?: Array<{ projectTitle: string; subtitleCode: string; line: string }>; joints?: number; dirtyScopes?: string;
  suspensions?: Array<{ id: number; naksStamp: string; suspendedFrom: string; suspendedTo: string }>;
  profiles?: unknown[];
  references?: Array<{ id: number; joint: string }> } = {}) {
  const records = prepareWelderStampRecordsForPersistence([{ id: 1, naksStamp: 'AB12', internalStamp: 'I-1', welderName: 'Иванов',
    naksPermits: [{ id: 'n1', weldType: 'РАД', materialGroups: 'М01', diameterFrom: '1', diameterTo: '500', thicknessFrom: '1', thicknessTo: '20',
      validFrom: '2026-01-01', validTo: '2026-12-31', note: '', archived: false }], dlsPermits: [], archived: false, archivedAt: '' }])
  const rows = records.map(record => ({ ...record, naksPermits: JSON.stringify(record.naksPermits), dlsPermits: null }))
  const events: string[] = [], selectedTables: unknown[] = []
  const scopes = options.scopes ?? []
  const execute = vi.fn(async (statement: SQL) => {
    const query = new PgDialect().sqlToQuery(statement)
    if (query.sql.includes('qualification_use_profiles')) {
      events.push('profiles')
      return { rows: options.profiles ?? [{ stamp1K: 'AB12', stamp1Z: '', stamp1O: '', stamp2K: '', stamp2Z: '', stamp2O: '',
        weldingMethod: 'РАД', materialGroup: 'М01', connectionType: 'С17', d1: '300', d2: '300', t1: '5', t2: '5', weldDate: '2026-07-01' }] }
    }
    if (query.sql.includes('changed_qualification_profiles')) { events.push('qualification-scopes'); return { rows: scopes } }
    if (query.sql.includes('affected_scopes')) { events.push('capture'); return { rows: scopes.map(scope => ({ ...scope, unsafe: false })) } }
    if (query.sql.includes('derived_state')) events.push('invalidate')
    return { rows: [] }
  })
  const select = vi.fn(() => ({ from: (table: unknown) => {
    selectedTables.push(table)
    const result = table === welderStamps ? rows : table === welderStampSuspensions ? options.suspensions ?? []
      : table === weldJoints ? options.references ?? []
      : table === dispatcherTaskIndexState ? [{ dirtyScopes: options.dirtyScopes ?? '[]', fullRebuild: false }] : []
    const limit = async (count: number) => result.slice(0, count)
    const ordered = Object.assign(Promise.resolve(result), { limit })
    const chain = { where: (_condition: unknown) => chain, orderBy: () => ordered, limit,
      groupBy: () => ({ limit: async () => scopes.map(scope => ({ ...scope, joints: options.joints ?? 1 })) }) }
    return chain
  } }))
  const insert = vi.fn((table: unknown) => ({ values: (_records: unknown) => {
    if (table === welderStampSuspensions) events.push('insert-suspensions')
    return Object.assign(Promise.resolve(), { onConflictDoUpdate: async () => { events.push('upsert') } })
  } }))
  const remove = vi.fn(() => { events.push('delete'); return { where: async () => undefined } })
  const tx = { execute, select, insert, delete: remove }
  storage.requireDb.mockReturnValue({ transaction: (run: (tx: unknown) => unknown) => run(tx) })
  return { records, execute, insert, remove, events, selectedTables }
}

describe('registry save invalidation', () => {
  it.each([1, 1000])('uses one bounded archive-reference query for %i changed cards and none for unchanged cards', async count => {
    const db = registryDatabase()
    const records = Array.from({ length: count }, (_, index) => ({ ...db.records[0], id: index + 1 }))
    const archived = records.map(record => ({ ...record, archived: true, archivedAt: '2026-08-01' }))
    const tx = { execute: db.execute } as unknown as Parameters<typeof assertWelderStampArchiveDatesAreUnused>[0]
    await assertWelderStampArchiveDatesAreUnused(tx, records, archived)
    expect(db.execute).toHaveBeenCalledTimes(1)
    const query = new PgDialect().sqlToQuery(db.execute.mock.calls[0][0])
    expect(query.sql).toContain('limit 1')
    expect(query.sql).toContain('"weld_date" >= a.date')
    for (const suffix of ['1_k', '1_z', '1_o', '2_k', '2_z', '2_o']) {
      expect(query.sql).toContain(`"stamp_${suffix}"`)
      expect(query.sql).toContain(`"stamp_${suffix}_fact"`)
    }
    expect(query.sql).not.toMatch(/officiality|revision_actuality/)
    await assertWelderStampArchiveDatesAreUnused(tx, archived, archived)
    expect(db.execute).toHaveBeenCalledTimes(1)
  })

  it('validates a no-op revision before skipping writes, including empty suspension resubmission', async () => {
    const db = registryDatabase()
    const snapshot = await loadWelderStampRegistrySnapshot()
    await expect(saveWelderStampRecords({ data: { records: db.records, expectedRevision: snapshot.revision } })).resolves.toEqual(snapshot)
    await expect(saveWelderStampSuspensionRecords({ data: { records: [], expectedRevision: snapshot.revision } })).resolves.toEqual(snapshot)
    await expect(saveWelderStampRecords({ data: { records: db.records, expectedRevision: 'stale' } })).rejects.toThrow('изменён другим')
    expect(db.insert).not.toHaveBeenCalled()
    expect(db.remove).not.toHaveBeenCalled()
    expect(db.events).toEqual([])
  })

  it('keeps FIO/statistics cache invalidation while avoiding any joint dependency reads', async () => {
    const db = registryDatabase(), snapshot = await loadWelderStampRegistrySnapshot()
    await saveWelderStampRecords({ data: { records: db.records.map(record => ({ ...record, welderName: 'Петров' })), expectedRevision: snapshot.revision } })
    expect(db.selectedTables).not.toContain(weldJoints)
    expect(db.events).toEqual(['upsert', 'invalidate'])
    const query = db.execute.mock.calls.map(([statement]) => new PgDialect().sqlToQuery(statement)).find(query => query.sql.includes('derived_state'))!
    expect(query.sql).toContain('delete from "derived_calculation_cache"')
    expect(query.params).toContain('[]')
    expect(query.params).not.toContain(true)
  })

  it.each([1, 5001, 200000])('selects a bounded mode for %i complete-context joints', async joints => {
    const scope = { projectTitle: 'P', subtitleCode: 'S', line: 'L' }
    const db = registryDatabase({ scopes: [scope], joints }), snapshot = await loadWelderStampRegistrySnapshot()
    await saveWelderStampRecords({ data: { records: db.records.map(record => ({ ...record,
      naksPermits: record.naksPermits.map(permit => ({ ...permit, diameterTo: '100' })),
    })), expectedRevision: snapshot.revision } })
    const query = db.execute.mock.calls.map(([statement]) => new PgDialect().sqlToQuery(statement)).find(query => query.sql.includes('derived_state'))!
    expect(query.params.includes(true)).toBe(joints > 5000)
    expect(query.params).toContain(JSON.stringify(joints > 5000 ? [] : [scope]))
    expect(db.events).toEqual(['profiles', 'qualification-scopes', 'upsert', 'invalidate'])
  })

  it('skips full 200k dependency expansion when changed permits leave all use profiles unchanged', async () => {
    const db = registryDatabase({ scopes: [{ projectTitle: 'P', subtitleCode: 'S', line: 'L' }], joints: 200000 })
    const snapshot = await loadWelderStampRegistrySnapshot()
    await saveWelderStampRecords({ data: { records: db.records.map(record => ({ ...record,
      naksPermits: record.naksPermits.map(permit => ({ ...permit, diameterTo: '400' })),
    })), expectedRevision: snapshot.revision } })
    expect(db.events).toEqual(['profiles', 'upsert', 'invalidate'])
    expect(db.selectedTables).not.toContain(weldJoints)
    const queries = db.execute.mock.calls.map(([statement]) => new PgDialect().sqlToQuery(statement))
    const invalidation = queries.find(query => query.sql.includes('derived_state'))!
    expect(invalidation.params).toContain('[]')
    expect(invalidation.params).not.toContain(true)
    const profileIndex = queries.findIndex(query => query.sql.includes('qualification_use_profiles'))
    const lockIndex = queries.findIndex(query => query.sql.includes('pg_advisory_xact_lock(hashtext('))
    expect(lockIndex).toBeGreaterThanOrEqual(0)
    expect(profileIndex).toBeGreaterThan(lockIndex)
  })

  it('keeps the conservative whole-alias loader when distinct profiles overflow', async () => {
    const scope = { projectTitle: 'P', subtitleCode: 'S', line: 'L' }
    const db = registryDatabase({ scopes: [scope], profiles: Array.from({ length: 513 }, () => ({})) })
    const snapshot = await loadWelderStampRegistrySnapshot()
    await saveWelderStampRecords({ data: { records: db.records.map(record => ({ ...record,
      naksPermits: record.naksPermits.map(permit => ({ ...permit, diameterTo: '400' })),
    })), expectedRevision: snapshot.revision } })
    expect(db.events).toEqual(['profiles', 'capture', 'upsert', 'invalidate'])
    const query = db.execute.mock.calls.map(([statement]) => new PgDialect().sqlToQuery(statement)).find(query => query.sql.includes('derived_state'))!
    expect(query.params).toContain(JSON.stringify([scope]))
  })

  it('does not read usage profiles for permit metadata-only changes', async () => {
    const db = registryDatabase(), snapshot = await loadWelderStampRegistrySnapshot()
    await saveWelderStampRecords({ data: { records: db.records.map(record => ({ ...record,
      naksPermits: record.naksPermits.map(permit => ({ ...permit, note: 'Комментарий' })),
    })), expectedRevision: snapshot.revision } })
    expect(db.events).toEqual(['upsert', 'invalidate'])
    expect(db.selectedTables).not.toContain(weldJoints)
  })

  it('captures cascaded decision lines before owner deletion', async () => {
    const db = registryDatabase({ scopes: [{ projectTitle: 'P', subtitleCode: 'S', line: 'Decision line' }] })
    const snapshot = await loadWelderStampRegistrySnapshot()
    await saveWelderStampRecords({ data: { records: [], expectedRevision: snapshot.revision } })
    expect(db.events).toEqual(['capture', 'delete', 'invalidate'])
  })

  it('promotes malformed dirty metadata to a full invalidation even for a name-only change', async () => {
    const db = registryDatabase({ dirtyScopes: 'broken' }), snapshot = await loadWelderStampRegistrySnapshot()
    await saveWelderStampRecords({ data: { records: db.records.map(record => ({ ...record, welderName: 'Петров' })), expectedRevision: snapshot.revision } })
    const query = db.execute.mock.calls.map(([statement]) => new PgDialect().sqlToQuery(statement)).find(query => query.sql.includes('derived_state'))!
    expect(query.params).toContain(true)
  })

  it('keeps official/factual history guards ahead of deletion and rename invalidation', async () => {
    const db = registryDatabase({ references: [{ id: 9, joint: 'F9' }] }), snapshot = await loadWelderStampRegistrySnapshot()
    for (const records of [[], db.records.map(record => ({ ...record, naksStamp: 'CD34' }))]) {
      await expect(saveWelderStampRecords({ data: { records, expectedRevision: snapshot.revision } })).rejects.toThrow('оно уже используется')
    }
    expect(db.events).toEqual([])
  })

  it('checks registry references even for an otherwise unchanged suspension snapshot', async () => {
    const suspension = { id: 2, naksStamp: 'MISS', suspendedFrom: '2026-07-01', suspendedTo: '' }
    const db = registryDatabase({ suspensions: [suspension] }), snapshot = await loadWelderStampRegistrySnapshot()
    await expect(saveWelderStampSuspensionRecords({ data: { records: [suspension], expectedRevision: snapshot.revision } }))
      .rejects.toThrow('отсутствует в справочнике')
    expect(db.events).toEqual([])
  })

  it('skips unchanged nonempty suspensions but never a stale resubmission', async () => {
    const suspension = { id: 2, naksStamp: 'AB12', suspendedFrom: '2026-07-01', suspendedTo: '' }
    const db = registryDatabase({ suspensions: [suspension] }), snapshot = await loadWelderStampRegistrySnapshot()
    await expect(saveWelderStampSuspensionRecords({ data: { records: [suspension], expectedRevision: snapshot.revision } })).resolves.toEqual(snapshot)
    await expect(saveWelderStampSuspensionRecords({ data: { records: [suspension], expectedRevision: 'stale' } })).rejects.toThrow('изменён другим')
    expect(db.events).toEqual([])
  })

  it.each([false, true])('captures whole-line suspension dependencies before replacement (remove=%s)', async remove => {
    const suspension = { id: 2, naksStamp: 'AB12', suspendedFrom: '2026-07-01', suspendedTo: '' }
    const scope = { projectTitle: 'P', subtitleCode: 'S', line: 'L' }
    const db = registryDatabase({ suspensions: [suspension], scopes: [scope] }), snapshot = await loadWelderStampRegistrySnapshot()
    await saveWelderStampSuspensionRecords({ data: { records: remove ? [] : [{ ...suspension, suspendedTo: '2026-07-31' }], expectedRevision: snapshot.revision } })
    expect(db.events).toEqual(['capture', 'delete', ...(remove ? [] : ['insert-suspensions']), 'invalidate'])
    const query = db.execute.mock.calls.map(([statement]) => new PgDialect().sqlToQuery(statement)).find(query => query.sql.includes('derived_state'))!
    expect(query.params).toContain(JSON.stringify([scope]))
    expect(query.params).not.toContain(true)
  })
})

describe('welder stamp registry concurrency', () => {
  it('accepts the exact loaded revision', () => {
    expect(() => assertRegistryRevision('current', 'current')).not.toThrow()
  })

  it('rejects a stale revision', () => {
    expect(() => assertRegistryRevision('current', 'stale')).toThrow(/изменён другим пользователем/i)
  })

  it('does not allow callers to bypass the check with an empty revision', () => {
    expect(() => assertRegistryRevision('current', '')).toThrow(/изменён другим пользователем/i)
  })
})

describe('welder stamp registry references', () => {
  it('validates existing suspensions before replacing the stamp registry', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server/welder-stamps.ts'), 'utf8')
    const saveStart = source.indexOf('export const saveWelderStampRecords')
    const suspensionSaveStart = source.indexOf('export const saveWelderStampSuspensionRecords')
    const saveSource = source.slice(saveStart, suspensionSaveStart)
    const validationIndex = saveSource.indexOf('assertWelderStampSuspensionsReferenceRegistry(')
    const deleteIndex = saveSource.indexOf('persistWelderStampObjects(tx')

    expect(validationIndex).toBeGreaterThanOrEqual(0)
    expect(deleteIndex).toBeGreaterThan(validationIndex)
  })

  it('distinguishes official and factual aliases removed from the registry', () => {
    expect(getRemovedWelderStampReferenceAliases(
      [
        { naksStamp: 'ABC1', internalStamp: 'I-1' },
        { naksStamp: 'KEEP', internalStamp: 'I-2' },
      ],
      [
        { naksStamp: 'KEEP', internalStamp: 'I-1' },
      ],
    )).toEqual({
      official: ['ABC1'],
      factual: ['ABC1', 'I-2'],
    })
  })

  it('checks weld references before replacing the stamp registry', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server/welder-stamps.ts'), 'utf8')
    const saveStart = source.indexOf('export const saveWelderStampRecords')
    const suspensionSaveStart = source.indexOf('export const saveWelderStampSuspensionRecords')
    const saveSource = source.slice(saveStart, suspensionSaveStart)
    const referenceValidationIndex = saveSource.indexOf('assertRemovedWelderStampAliasesAreUnused(')
    const deleteIndex = saveSource.indexOf('persistWelderStampObjects(tx')

    expect(referenceValidationIndex).toBeGreaterThanOrEqual(0)
    expect(deleteIndex).toBeGreaterThan(referenceValidationIndex)
  })
})
