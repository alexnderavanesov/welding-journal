import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { generatedDocuments } from '@/db/schema'
import { inheritDocumentSpecialists, type DocumentSpecialists, type SpecialistRecord } from '@/lib/document-specialists'
import { buildSystemDocumentSummaries, type SystemDocumentReference } from '@/lib/system-document-types'
import { applySpecialistAssignments, assignCreatedDocumentSpecialists } from './specialists'
import { planCorrectedDocumentSpecialists } from './document-specialist-corrections'
import { captureTransferredSpecialists, planTransferredSpecialists } from './document-specialist-transfers'

// No database connections or fixtures: all storage boundaries fail closed or
// return explicitly supplied unit data. Requirements: specialists plan, 12–13 Oct.
const storage = vi.hoisted(() => ({ requireDb: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: storage.requireDb }))
vi.mock('./layered-control-documents', () => ({ lockLayeredControlDocumentsForWeldChange: vi.fn() }))
vi.mock('./system-document-index', () => ({ lockSystemDocumentIndexes: vi.fn() }))

const date = '2026-10-12'
const now = new Date(`${date}T00:00:00.000Z`)
const historical: DocumentSpecialists = {
  first: { id: 1, name: 'Иванов Иван Иванович', certificate: 'НК-123' },
  second: null,
}
const duplicateCard: DocumentSpecialists = {
  first: { ...historical.first!, id: 2 },
  second: null,
}
const card: SpecialistRecord = {
  id: 1, name: 'Иванов Иван Иванович', certificate: 'НК-456',
  kind: 'inspector', methods: ['ВИК'], revision: 2,
}
const document = {
  id: 11, type: 'system:lnkConclusionVik', title: 'ВИК-1', date,
  snapshot: historical, revision: 1, positions: ['system:lnkConclusionVik:1::1'], total: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  storage.requireDb.mockImplementation(() => { throw new Error('Unexpected real database access in unit audit') })
})

describe('specialist snapshot identity: confirmed name/certificate rule', () => {
  it.each(['first', 'second'] as const)('ignores duplicate-card IDs in %s and preserves the actual snapshot', role => {
    const person = Object.freeze({ id: 41, name: ' Иванов  И. И. ', certificate: ' НК-001 ' })
    const duplicate = Object.freeze({ ...person, id: 42 })
    const original = Object.freeze({ first: null, second: null, [role]: person })
    const other = Object.freeze({ first: null, second: null, [role]: duplicate })
    const merged = inheritDocumentSpecialists([original, other])
    expect(merged).toEqual({ snapshot: original, conflict: false })
    expect(merged.snapshot[role]).toBe(person)
    expect(inheritDocumentSpecialists([other, original]).snapshot[role]).toBe(duplicate)
  })

  it('preserves two separate role snapshots even when all four card IDs differ', () => {
    const first = { id: 11, name: 'Иванов', certificate: 'НК-1' }
    const second = { id: 12, name: 'Петров', certificate: 'НК-2' }
    const merged = inheritDocumentSpecialists([
      { first, second },
      { first: { ...first, id: 21 }, second: { ...second, id: 22 } },
    ])
    expect(merged).toEqual({ snapshot: { first, second }, conflict: false })
    expect(merged.snapshot.first).toBe(first)
    expect(merged.snapshot.second).toBe(second)
  })

  it.each(['first', 'second'] as const)('distinguishes null from an assigned %s role', role => {
    const assigned = { first: null, second: null, [role]: historical.first }
    expect(inheritDocumentSpecialists([assigned, null])).toEqual({
      snapshot: { first: null, second: null }, conflict: true,
    })
    expect(inheritDocumentSpecialists([null, assigned]).conflict).toBe(true)
  })

  it('does not treat a swap of roles as the same pair', () => {
    expect(inheritDocumentSpecialists([historical, { first: null, second: duplicateCard.first }])).toEqual({
      snapshot: { first: null, second: null }, conflict: true,
    })
  })

  it.each([
    ['name', 'Иванов Иван Иванович '],
    ['name', 'иванов Иван Иванович'],
    ['name', 'Иванов  Иван Иванович'],
    ['name', 'Иванов Иван Петрович'],
    ['certificate', 'НК-123 '],
    ['certificate', 'нк-123'],
    ['certificate', 'НК-124'],
  ] as const)('compares saved %s exactly: %s', (field, value) => {
    const changed = { ...historical, first: { ...historical.first!, [field]: value } }
    expect(inheritDocumentSpecialists([historical, changed])).toEqual({
      snapshot: { first: null, second: null }, conflict: true,
    })
    expect(historical.first).toEqual({ id: 1, name: 'Иванов Иван Иванович', certificate: 'НК-123' })
  })
})

describe('specialist precommit audit: independently derived snapshot semantics', () => {
  it('preserves equal saved names/certificates when cards have different IDs', () => {
    // Registry permits duplicate cards. The agreed merge criterion is the saved
    // FIO/certificate of each role, not equality of registry primary keys.
    const merged = inheritDocumentSpecialists([historical, duplicateCard])
    expect(merged.conflict).toBe(false)
    expect(merged.snapshot.first).toMatchObject({ name: historical.first!.name, certificate: historical.first!.certificate })
    expect(merged.snapshot.second).toBeNull()
  })

  it('ordinary result correction does not clear equal saved facts from duplicate cards', () => {
    const before = [document, { ...document, id: 12, snapshot: duplicateCard, positions: ['system:lnkConclusionVik:2::1'] }]
    const after = [{ ...document, id: 13, snapshot: null, positions: before.flatMap(value => value.positions), total: 2 }]
    const changes = planCorrectedDocumentSpecialists(before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0].conflict).toBe(false)
    expect(changes[0].snapshot.first).toMatchObject({ name: historical.first!.name, certificate: historical.first!.certificate })
  })

  it('transfer snapshot contract preserves equal facts across registry IDs', async () => {
    const documents = [
      { ...document, stage: 'beforeHeatTreatment', member: true, updatedAt: now },
      { ...document, id: 12, stage: '', member: false, snapshot: duplicateCard, updatedAt: now },
    ]
    const chain = { from: () => chain, where: () => chain, orderBy: async () => documents }
    const tx = { select: vi.fn(() => chain) }
    const plan = await planTransferredSpecialists(tx as never, [1], 'primary')
    expect(plan.conflicts).toEqual([])
    expect(plan.transfers[0].snapshot.first).toMatchObject({ name: historical.first!.name, certificate: historical.first!.certificate })
  })

  it('creation lookup distinguishes same-name conclusions on different stages', async () => {
    const queries: Array<ReturnType<PgDialect['sqlToQuery']>> = []
    for (const sourceKind of [undefined, 'beforeHeatTreatment'] as const) {
      const tx = { execute: vi.fn(async (_query: SQL) => ({ rows: [
        { id: 11, type: document.type, title: document.title, periodFrom: date, specialists: null },
      ] })) }
      await assignCreatedDocumentSpecialists(tx as never,
        [{ title: document.title, selection: { first: null } }],
        [{ type: 'lnkConclusion', methodCode: 'ВИК', title: document.title, date, ...(sourceKind ? { sourceKind } : {}) }])
      queries.push(new PgDialect().sqlToQuery(tx.execute.mock.calls[0][0]))
    }
    // A database lookup must distinguish these independently stored documents;
    // identical SQL + parameters necessarily select the same candidate set.
    expect(queries[0]).not.toEqual(queries[1])
  })

  it('invalidates transfer clearing consent after an older destination member is deleted', async () => {
    // Primary index persistence takes updatedAt from the maximum surviving weld
    // timestamp. Deleting an older member can therefore leave it unchanged.
    const welds = [
      { id: 21, vikConclusion: document.title, vikConclusionDate: date, updatedAt: now.toISOString() },
      { id: 22, vikConclusion: document.title, vikConclusionDate: date, updatedAt: '2026-10-11T00:00:00.000Z' },
    ]
    const before = buildSystemDocumentSummaries(welds, 'lnkConclusion')[0]
    const after = buildSystemDocumentSummaries(welds.slice(0, 1), 'lnkConclusion')[0]
    expect(before.updatedAt).toBe(after.updatedAt)
    expect(before.rowIds).not.toEqual(after.rowIds)
    const fingerprint = async (summary: typeof before) => {
      const source = { ...document, stage: 'beforeHeatTreatment', member: true, updatedAt: now }
      const destination = { ...source, id: 12, stage: '', member: false, snapshot: null,
        updatedAt: new Date(summary.updatedAt), rowCount: summary.rowCount,
        membership: JSON.stringify(summary.rowIds), rowIds: summary.rowIds }
      const tx = { select: vi.fn((fields: Record<string, unknown>) => {
        // Respect the actual select projection, including a future lightweight
        // membership fingerprint; do not supply unselected hidden metadata.
        const rows = [source, destination].map(value => Object.fromEntries(
          Object.keys(fields).map(key => [key, (value as Record<string, unknown>)[key]]),
        ))
        const chain = { from: () => chain, where: () => chain, orderBy: async () => rows }
        return chain
      }) }
      return planTransferredSpecialists(tx as never, [1], 'primary')
    }
    const original = await fingerprint(before), changed = await fingerprint(after)
    expect(original.conflicts).toHaveLength(1)
    expect(changed.confirmation).not.toBe(original.confirmation)
  })

  it('deleting one document does not transfer its signers to another cycle', () => {
    const firstCycle = { ...document, type: 'system:pstoConclusion', positions: ['system:pstoConclusion:1:cycle:1'] }
    const nextCycle = { ...firstCycle, id: 12, positions: ['system:pstoConclusion:1:cycle:2'], snapshot: null }
    expect(planCorrectedDocumentSpecialists([firstCycle, nextCycle], [nextCycle])).toEqual([])
    expect(historical.first?.certificate).toBe('НК-123')
  })
})

describe('specialist creation: stage-aware bounded lookup', () => {
  const cases: Array<[string, Partial<SystemDocumentReference>, string, string[]]> = [
    ['primary NK', { type: 'lnkConclusion', methodCode: 'ВИК' }, 'system:lnkConclusionVik', ['']],
    ['pre-TO NK', { type: 'lnkConclusion', methodCode: 'ВИК', sourceKind: 'beforeHeatTreatment' }, 'system:lnkConclusionVik', ['beforeHeatTreatment']],
    ...(['pstoConclusion', 'tvmtConclusion'] as const).flatMap(type =>
      ([undefined, 'pstoCycle', 'pstoRepeat'] as const).map(sourceKind => [
        `${type}/${sourceKind ?? 'legacy'}`,
        { type: type === 'pstoConclusion' ? 'pstoConclusion' : 'lnkConclusion', ...(type === 'tvmtConclusion' ? { methodCode: 'ТВМТ' } : {}), sourceKind },
        `system:${type}`, ['', 'pstoCycle', 'pstoRepeat'],
      ] as [string, Partial<SystemDocumentReference>, string, string[]]),
    ),
  ]

  it.each(cases)('%s constrains storage stage without returning source metadata', async (_name, reference, type, sourceKinds) => {
    const tx = { execute: vi.fn(async (_query: SQL) => ({ rows: [{ id: 11, type, title: document.title, periodFrom: date, specialists: null }] })) }
    await assignCreatedDocumentSpecialists(tx as never, [{ title: document.title, selection: { first: null } }],
      [{ type: 'lnkConclusion', title: document.title, date, ...reference }])
    const query = new PgDialect().sqlToQuery(tx.execute.mock.calls[0][0])
    expect(JSON.parse(query.params[0] as string)).toEqual([{ type, title: document.title, date, sourceKinds }])
    expect(query.sql).toContain("coalesce(nullif(d.source_metadata, '')::jsonb->>'sourceKind', '') = any(n.\"sourceKinds\")")
    expect(query.sql.split('from')[0]).not.toContain('source_metadata')
    expect(query.sql).toContain('order by d.id for update of d')
    expect(tx.execute).toHaveBeenCalledTimes(2)
  })

  it.each([0, 2])('rejects %i matching stored documents without a partial assignment', async count => {
    const tx = { execute: vi.fn(async (_query: SQL) => ({ rows: Array.from({ length: count }, (_, index) => ({
      id: 11 + index, type: document.type, title: document.title, periodFrom: date, specialists: null,
    })) })) }
    await expect(assignCreatedDocumentSpecialists(tx as never, [{ title: document.title, selection: { first: null } }],
      [{ type: 'lnkConclusion', methodCode: 'ВИК', title: document.title, date }])).rejects.toThrow('Не удалось определить')
    expect(tx.execute).toHaveBeenCalledOnce()
  })

  it.each([1, 10000])('looks up and clears %i newly created documents in two SQL calls', async count => {
    const rows = Array.from({ length: count }, (_, index) => ({
      id: index + 1, type: document.type, title: `ВИК-${index}`, periodFrom: date, specialists: null,
    }))
    const tx = { execute: vi.fn(async (_query: SQL) => ({ rows })) }
    await assignCreatedDocumentSpecialists(tx as never,
      rows.map(row => ({ title: row.title, selection: { first: null } })),
      rows.map(row => ({ type: 'lnkConclusion', methodCode: 'ВИК', title: row.title, date, sourceKind: 'beforeHeatTreatment' })))
    expect(tx.execute).toHaveBeenCalledTimes(2)
    const lookup = new PgDialect().sqlToQuery(tx.execute.mock.calls[0][0])
    const write = new PgDialect().sqlToQuery(tx.execute.mock.calls[1][0])
    expect(lookup.params).toHaveLength(1)
    expect(JSON.parse(lookup.params[0] as string)).toHaveLength(count)
    expect(write.params).toHaveLength(2)
    expect(write.params[0]).toEqual(rows.map(row => row.id))
  })
})

function transferCompositionFixture(target: 'primary' | 'beforeHeatTreatment' = 'primary') {
  const sourceStage = target === 'primary' ? 'beforeHeatTreatment' : ''
  const targetStage = target === 'primary' ? '' : 'beforeHeatTreatment'
  const documents = [
    { ...document, stage: sourceStage, member: true, updatedAt: now, rowIds: [1, 2] },
    { ...document, id: 12, stage: targetStage, member: false, snapshot: null, updatedAt: now, rowIds: [3, 4] },
  ].map(value => ({ ...value, rowCount: 2, sourcePositions: value.stage === 'beforeHeatTreatment'
    ? value.rowIds.map(id => ({ kind: 'beforeHeatTreatment', weldJointId: id, relationId: 100 + id, methodCode: 'ВИК' })) : [],
  }))
  const tx = { select: vi.fn((fields: Record<string, unknown>) => {
    const read = () => documents.map(value => {
      // Model only the digest returned by PostgreSQL; this is a token-contract
      // test, not DB execution. SQL structure is checked separately below.
      const membership = createHash('sha256').update(JSON.stringify([
        [...value.rowIds].sort((a, b) => a - b),
        value.sourcePositions.map(position => JSON.stringify(position)).sort(),
      ])).digest('hex')
      const result = { ...value, membership } as Record<string, unknown>
      return Object.fromEntries(Object.keys(fields).map(key => [key, result[key]]))
    })
    const chain = { from: () => chain, where: () => chain, orderBy: () => chain, for: async () => read(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(read()).then(resolve) }
    return chain
  }) }
  return { tx, documents }
}

describe('specialist transfer consent: exact composition', () => {
  it.each([
    ['primary', 0], ['primary', 1], ['beforeHeatTreatment', 0], ['beforeHeatTreatment', 1],
  ] as const)('rejects equal-cardinality replacement toward %s in document %i with unchanged revisions/times', async (target, index) => {
    const { tx, documents } = transferCompositionFixture(target)
    const original = await planTransferredSpecialists(tx as never, [1], target)
    expect(original.conflicts).toHaveLength(1)
    const previous = { ...documents[index] }
    documents[index].rowIds = [documents[index].rowIds[0], 99]
    expect(documents[index].rowCount).toBe(previous.rowCount)
    expect(documents[index].updatedAt).toBe(previous.updatedAt)
    expect(documents[index].revision).toBe(previous.revision)
    await expect(captureTransferredSpecialists(tx as never, [1], target, original.confirmation)).rejects.toThrow('Обновите проверку')
    const refreshed = await planTransferredSpecialists(tx as never, [1], target)
    await expect(captureTransferredSpecialists(tx as never, [1], target, refreshed.confirmation)).resolves.toHaveLength(1)
  })

  it.each(['primary', 'beforeHeatTreatment'] as const)('rejects replacement of a pre-TO relation with the same weld membership toward %s', async target => {
    const { tx, documents } = transferCompositionFixture(target)
    const original = await planTransferredSpecialists(tx as never, [1], target)
    const pre = documents.find(value => value.stage === 'beforeHeatTreatment')!
    pre.sourcePositions[0].relationId = 999
    await expect(captureTransferredSpecialists(tx as never, [1], target, original.confirmation)).rejects.toThrow('Обновите проверку')
  })

  it('keeps consent on an order-only change and keeps read/projection size bounded', async () => {
    const { tx, documents } = transferCompositionFixture()
    const original = await planTransferredSpecialists(tx as never, [1], 'primary')
    expect(tx.select).toHaveBeenCalledOnce()
    const fields = tx.select.mock.calls[0][0]
    expect(fields).not.toHaveProperty('sourceMetadata')
    expect(fields).not.toHaveProperty('rowIds')
    expect(fields).not.toHaveProperty('sourcePositions')
    const digest = new PgDialect().sqlToQuery(fields.membership as SQL)
    expect(digest.params).toEqual([]) // No rowIds restriction: every document member is hashed.
    expect(digest.sql).toContain('sha256(convert_to(jsonb_build_array(')
    expect(digest.sql).toContain('jsonb_agg(a.weld_joint_id order by a.weld_joint_id)')
    expect(digest.sql).toContain('a.document_id = "generated_documents"."id"')
    expect(digest.sql).toContain('jsonb_agg(p.value order by p.value)')
    expect(digest.sql).toContain("->'sourcePositions'")
    expect(digest.sql).not.toMatch(/\bcount\s*\(|\bany\s*\(|select\s+\*/i)
    documents.forEach(value => { value.rowIds.reverse(); value.sourcePositions.reverse() })
    await expect(captureTransferredSpecialists(tx as never, [1], 'primary', original.confirmation)).resolves.toHaveLength(1)
    expect(tx.select).toHaveBeenCalledTimes(2)
  })
})

function assignmentFixture(records: SpecialistRecord[] = [card]) {
  const documents = [11, 12].map(id => ({ id, type: document.type, title: `ВИК-${id}`, periodFrom: date,
    specialists: historical, specialistsRevision: 1, updatedAt: now, documentVersion: '101' }))
  const tx = {
    select: vi.fn(() => ({ from(table: unknown) {
      const chain = { where: () => chain, orderBy: () => chain, for: vi.fn(async () => table === generatedDocuments ? documents : records) }
      return chain
    } })),
    execute: vi.fn(async (_query: SQL) => ({ rows: [] })),
  }
  storage.requireDb.mockReturnValue({ transaction: (run: (value: typeof tx) => unknown) => run(tx) })
  const targets = documents.map(value => ({ id: value.id, revision: value.specialistsRevision, updatedAt: value.updatedAt.toISOString(), documentVersion: value.documentVersion }))
  return { tx, targets, documents }
}

describe('specialist precommit audit: stale selections and all-or-nothing assignment', () => {
  it.each([
    ['archived card', [{ ...card, archived: true }]],
    ['removed qualification', [{ ...card, methods: ['РК'] }]],
    ['missing card', []],
  ] as Array<[string, SpecialistRecord[]]>)('rejects a stale selection after %s before any write', async (_label, records) => {
    const { tx, targets } = assignmentFixture(records)
    await expect(applySpecialistAssignments({ documents: targets, selection: { first: 1 } })).rejects.toThrow('Обновите выбор')
    expect(tx.execute).not.toHaveBeenCalled()
  })

  it('rejects changed document composition/time even if specialist revision did not change', async () => {
    const { tx, targets, documents } = assignmentFixture()
    documents[1].updatedAt = new Date(now.getTime() + 1000)
    await expect(applySpecialistAssignments({ documents: targets, selection: { first: null } })).rejects.toThrow('Документы изменились')
    expect(tx.execute).not.toHaveBeenCalled()
  })

  it('rejects a deleted selected document without partially assigning the surviving one', async () => {
    const { tx, targets, documents } = assignmentFixture()
    documents.pop()
    await expect(applySpecialistAssignments({ documents: targets, selection: { first: 1 } })).rejects.toThrow('Документы изменились')
    expect(tx.execute).not.toHaveBeenCalled()
  })

  it('rejects a mixed inspector/thermist selection even when the requested change only clears', async () => {
    const { tx, targets, documents } = assignmentFixture()
    documents[1].type = 'system:pstoConclusion'
    await expect(applySpecialistAssignments({ documents: targets, selection: { first: null } })).rejects.toThrow('ПСТО отдельно')
    expect(tx.execute).not.toHaveBeenCalled()
  })
})
