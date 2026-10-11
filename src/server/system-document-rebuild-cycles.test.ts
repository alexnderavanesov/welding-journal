import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { WeldRow } from '@/lib/dispatcher-types'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import { buildSystemDocumentSummaries } from '@/lib/system-document-types'
import { buildDocumentOperationGroups, getDocumentOperationPositions, type DocumentOperationSource } from '@/lib/system-document-operation'
import { persistRebuildDocumentNames } from './system-document-rebuild'

function source(): DocumentOperationSource {
  const rows = [1, 2].map(id => ({ id, joint: `S${id}`, line: `L${id}`, projectTitle: 'P', subtitleCode: 'C',
    pstoRequest: 'ЗПСТО-24.08.2026-005', pstoRequestDate: '2026-08-24',
    pstoDate: '2026-08-25', heatTreatmentDiagram: 'Diagram-1', pstoResult: 'выполнено',
    tvmtResult: 'не годен', tvmtConclusion: 'Historical-TVMT', tvmtConclusionDate: '2026-08-26',
  })) as WeldRow[]
  return {
    document: { ...buildSystemDocumentSummaries(rows, 'pstoRequest')[0], documentId: 7, sourceKind: 'pstoCycle', cycleSequences: [1, 2] }, rows,
    cyclePositions: [
      { position: { kind: 'pstoCycle', weldJointId: 1, relationId: 101, sequence: 2 },
        cycle: { id: 101, weldJointId: 1, sequence: 2, pstoRequest: String(rows[0].pstoRequest), pstoRequestDate: '2026-08-24',
          pstoDate: '2026-08-25', pstoResult: 'выполнено', heatTreatmentDiagram: 'Diagram-2', tvmtResult: 'годен',
          tvmtConclusionDate: '2026-08-26', tvmtConclusion: 'TVMT-2', pstoNote: '  Original note  ' } },
      { position: { kind: 'pstoCycle', weldJointId: 2, relationId: 2, sequence: 1 } },
    ],
  }
}

describe('current document operation exact PSTO/TVMT positions', () => {
  it('splits mixed first/repeat cycles by line without changing facts or requiring matching cycle numbers', () => {
    const input = source(), before = structuredClone(input)
    const build = (mode: 'line' | 'none') => buildDocumentOperationGroups({ sources: [input], settings: REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      request: { documentIds: [7], action: 'split', mode, merge: false }, nextNumbers: { pstoRequest: 6 } })
    expect(build('line').map(group => group.positions.map(p => [p.row.id, p.cycle]))).toEqual([[[1, 2]], [[2, 1]]])
    expect(build('none')[0].positions.map(p => p.cycle)).toEqual([2, 1])
    expect(input).toEqual(before)
  })

  it.each(['pstoRequest', 'pstoConclusion', 'tvmtRequest', 'tvmtConclusion'] as const)('identifies only the selected %s field in each exact cycle', field => {
    const input = source(), name = 'Common', date = '2026-08-24'
    const dateField = ({ pstoRequest: 'pstoRequestDate', pstoConclusion: 'pstoDate', tvmtRequest: 'tvmtRequestDate', tvmtConclusion: 'tvmtConclusionDate' } as const)[field]
    const nameField = field === 'pstoConclusion' ? 'heatTreatmentDiagram' : field
    input.document = { ...input.document, title: name, date,
      type: field === 'tvmtRequest' ? 'lnkRequest' : field === 'tvmtConclusion' ? 'lnkConclusion' : field,
      ...(field.startsWith('tvmt') ? { methodCode: 'ТВМТ' } : {}) }
    input.rows[1] = { ...input.rows[1], [nameField]: name, [dateField]: date }
    input.cyclePositions![0].cycle = { ...input.cyclePositions![0].cycle!, [nameField]: name, [dateField]: date }
    const before = structuredClone(input), positions = getDocumentOperationPositions(input)
    expect(positions.map(p => [p.row.id, p.relationId, p.cycle, p.field])).toEqual([[1, 101, 2, nameField], [2, 2, 1, nameField]])
    expect(input).toEqual(before)
  })

  it.each([101, 1])('preserves distinct cycles with colliding weld/repeat ID %i, including legacy repeat sources', relationId => {
    const input = source()
    input.cyclePositions![0].position.relationId = relationId; input.cyclePositions![0].cycle!.id = relationId
    input.rows = [input.rows[0]]; input.document.rowIds = [1]; input.document.rowCount = 1
    input.cyclePositions![1] = { position: { kind: 'pstoCycle', weldJointId: 1, relationId: 1, sequence: 1 } }
    const positions = getDocumentOperationPositions(input)
    expect(positions).toHaveLength(2); expect(new Set(positions.map(p => p.key)).size).toBe(2)
    input.document.sourceKind = 'pstoRepeat'
    input.cyclePositions = [{ ...input.cyclePositions![0], position: { ...input.cyclePositions![0].position, kind: 'pstoRepeat' } }]
    expect(getDocumentOperationPositions(input)[0].sourcePosition?.kind).toBe('pstoRepeat')
  })

  it.each(['missing', 'wrong-weld', 'wrong-sequence', 'wrong-name'] as const)('rejects stale %s positions in the active operation', kind => {
    const input = source(), item = input.cyclePositions![0]
    if (kind === 'missing') item.cycle = undefined
    if (kind === 'wrong-weld') item.cycle!.weldJointId = 2
    if (kind === 'wrong-sequence') item.cycle!.sequence = 3
    if (kind === 'wrong-name') item.cycle!.pstoRequest = 'Different'
    expect(() => getDocumentOperationPositions(input)).toThrow('Проверить изменения')
  })

  it.each([2, 2001])('writes %i positions in batches, never updating factual fields', async count => {
    const input = source()
    const execute = vi.fn(async query => {
      const compiled = new PgDialect().sqlToQuery(query)
      expect(compiled.sql).not.toMatch(/"(?:psto_result|tvmt_result|final_status|psto_date|sequence|psto_note|created_at)"\s*=/)
      const payload = JSON.parse(compiled.params[0] as string)
      return { rows: payload.map((row: { id: number }) => ({ id: row.id })) }
    })
    await persistRebuildDocumentNames({ execute } as never,
      Array.from({ length: count }, (_, i) => ({ ...input.rows[0], id: i + 1 })),
      Array.from({ length: count }, (_, i) => ({ ...input.cyclePositions![0].cycle!, id: i + 1 })))
    expect(execute).toHaveBeenCalledTimes(2 * Math.ceil(count / 1000))
  })
})
