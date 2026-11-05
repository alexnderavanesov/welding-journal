import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { generatedDocuments, generatedDocumentWeldJoints, preHeatTreatmentControls, pstoRepeatCycles, duplicateControls, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { persistRemovedControlAssignmentRequests } from './control-assignment-request-removal'
import { getSystemDocumentIntegrityReason } from './weld-save-validation'
import { getControlAvailabilityReportHistoryIssues } from '@/lib/weld-form-save-reasons'

const base: WeldRow = { id: 1, joint: 'F1', hasRk: 'да', hasUzk: 'да' }
const pre = { id: 11, weldJointId: 1, method: 'РК', requestName: 'A1', requestDate: '2026-11-01' }
const position = (relationId: number, weldJointId = 1, methodCode = 'РК') => ({ kind: 'beforeHeatTreatment', relationId, weldJointId, methodCode })
const document = (id: number, positions: unknown[], type = 'system:lnkRequest') => ({ id, type, title: 'A1', sourceMetadata: JSON.stringify({ sourceKind: 'beforeHeatTreatment', sourcePositions: positions }) })

/** Deterministic query adapter exercises actual hydration and document planning;
 * rollback/locking against real PostgreSQL is covered by the integration run. */
function transaction(relations: unknown[] = [], documents: unknown[] = [], repeats: unknown[] = []) {
  const statements: Array<{ sql: string; params: unknown[] }> = [], deletes: Array<{ table: unknown; params: unknown[] }> = [], updates: Array<{ table: unknown; values: Record<string, unknown> }> = []
  const contents = new Map<unknown, unknown[]>([[preHeatTreatmentControls, relations], [pstoRepeatCycles, repeats], [duplicateControls, []],
    [generatedDocumentWeldJoints, documents.map(document => ({ document }))], [weldJoints, [{ id: 1 }, { id: 2 }]]])
  const tx = {
    select: () => {
      let table: unknown
      const query = { from: (value: unknown) => { table = value; return query }, innerJoin: () => query, where: () => query, orderBy: () => query,
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(contents.get(table) ?? []).then(resolve) }
      return query
    },
    execute: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => { statements.push(new PgDialect().sqlToQuery(query)); return { rows: [] } },
    delete: (table: unknown) => ({ where: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => { deletes.push({ table, params: new PgDialect().sqlToQuery(query).params }) } }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async () => { updates.push({ table, values }) } }) }),
  }
  return { tx: tx as never, statements, deletes, updates }
}

describe('assignment removal persists exact request positions', () => {
  it('retains another method on the same joint, another completed position and all conclusion documents', async () => {
    const positions = [position(11), position(12, 1, 'УЗК'), position(21, 2)]
    const db = transaction([pre, { ...pre, id: 12, method: 'УЗК', result: 'годен', conclusionName: 'C1' }, { ...pre, id: 21, weldJointId: 2, result: 'ремонт' }],
      [document(101, positions), document(102, positions, 'system:lnkConclusionRk')])
    const next = { ...base, hasRk: null }
    await persistRemovedControlAssignmentRequests(db.tx, [next], new Map([[1, base]]))
    const write = db.statements.find(item => item.sql.includes('update "generated_documents"'))!
    expect(write).toBeDefined()
    expect(write.params[1]).toEqual([101])
    const metadata = JSON.parse((write.params[3] as string[])[0])
    expect(metadata.sourcePositions).toEqual(positions.slice(1))
    expect(metadata.positionCount).toBe(2)
    expect(db.deletes.filter(item => item.table === generatedDocuments)).toEqual([])
    expect(db.updates).toEqual([{ table: preHeatTreatmentControls, values: expect.objectContaining({ requestName: null, requestDate: null, result: null }) }])
  })
  it('deletes the last request completely without touching a conclusion or leaving an archived copy', async () => {
    const db = transaction([pre], [document(101, [position(11)]), document(102, [position(11)], 'system:lnkConclusionRk')])
    await persistRemovedControlAssignmentRequests(db.tx, [{ ...base, hasRk: null }], new Map([[1, base]]))
    expect(db.deletes.filter(item => item.table === generatedDocuments).map(item => item.params)).toEqual([[[101]]])
    expect(db.statements.some(item => item.sql.includes('insert into "generated_documents"'))).toBe(false)
  })
  it('rechecks stored relations before any mutation, even when the earlier primary snapshot omitted them', async () => {
    const db = transaction([{ ...pre, result: 'вырез', conclusionName: 'C1' }])
    await expect(persistRemovedControlAssignmentRequests(db.tx, [{ ...base, hasRk: null }], new Map([[1, base]]))).rejects.toThrow('нельзя снять')
    expect(db.updates).toEqual([]); expect(db.deletes).toEqual([])
  })
  it('preserves a validated whole-package stage transfer instead of treating it as deletion of facts', async () => {
    const previous = { ...base, pstoRequired: 'да' }
    const next = { ...previous, pstoRequired: null, rkRequest: 'A1', rkResult: 'годен', rkConclusion: 'C1' }
    const db = transaction([{ ...pre, result: 'годен', conclusionName: 'C1' }])
    await persistRemovedControlAssignmentRequests(db.tx, [next], new Map([[1, previous]]), { transferredPreControlIds: [11] })
    expect(next).toMatchObject({ rkRequest: 'A1', rkResult: 'годен', rkConclusion: 'C1' })
    expect(db.updates.some(item => item.table === preHeatTreatmentControls)).toBe(false)
  })
  it('keeps recorded pre-NK and its requests when a validated line move only changes the derived PSTO assignment', async () => {
    const previous = { ...base, pstoRequired: 'да', pstoRequest: 'P1' }
    const next = { ...previous, pstoRequired: null, line: 'TARGET' }
    const db = transaction([{ ...pre, result: 'годен', conclusionName: 'C1' }], [document(101, [position(11)])])
    await persistRemovedControlAssignmentRequests(db.tx, [next], new Map([[1, previous]]), { preserveRecordedControlHistoryRowIds: new Set([1]) })
    expect(next.pstoRequest).toBe('P1')
    expect(db.updates).toEqual([]); expect(db.deletes).toEqual([]); expect(db.statements).toEqual([])
  })
  it('still protects freshly loaded method facts and removes safe method requests during that validated move', async () => {
    const previous = { ...base, pstoRequired: 'да' }
    const next = { ...previous, pstoRequired: null, line: 'TARGET', hasRk: null }
    const db = transaction([{ ...pre, result: 'годен', conclusionName: 'C1' }])
    const options = { preserveRecordedControlHistoryRowIds: new Set([1]) }
    await expect(persistRemovedControlAssignmentRequests(db.tx, [next], new Map([[1, previous]]), options)).rejects.toThrow('РК: нельзя снять')
    expect(db.updates).toEqual([]); expect(db.deletes).toEqual([])
    const safe = transaction([pre], [document(101, [position(11)])])
    await persistRemovedControlAssignmentRequests(safe.tx, [next], new Map([[1, previous]]), options)
    expect(safe.deletes.filter(item => item.table === generatedDocuments).map(item => item.params)).toEqual([[[101]]])
  })
  it.each([{ pstoDate: '2026-11-01' }, { heatTreatmentDiagram: 'Д1' }])('rejects new actual PSTO requisites without its result and diagnoses stored contradictions: %o', facts => {
    const row = { ...base, pstoRequired: 'да', pstoRequest: 'P1', pstoRequestDate: '2026-11-01', ...facts }
    expect(getSystemDocumentIntegrityReason(row, undefined)).toContain('без результата «проведено»')
    expect(getControlAvailabilityReportHistoryIssues(row).some(issue => /результат.*проведено/.test(issue.message))).toBe(true)
    expect(getSystemDocumentIntegrityReason({ ...row, responsible: 'Иванов' }, row as never)).toBe('')
  })
})
