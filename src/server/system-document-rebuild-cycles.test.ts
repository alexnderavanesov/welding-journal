import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { WeldRow } from '@/lib/dispatcher-types'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import { buildSystemDocumentRebuildDocuments, type SystemDocumentRebuildSource } from '@/lib/system-document-rebuild'
import { buildSystemDocumentSummaries } from '@/lib/system-document-types'
import { indexRebuildCyclePositions, planRebuildCycleGroup } from './system-document-rebuild-cycles'
import { assertNoRebuildIdentityCollisions, getDocumentIdentityKey, persistRebuildDocumentNames } from './system-document-rebuild'

function source(): SystemDocumentRebuildSource {
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

describe('rebuilding exact PSTO/TVMT cycle positions', () => {
  it('does not merge a rebuilt cycle group into an existing legacy first-cycle document with the same name/date', () => {
    const input = source()
    const legacy = { ...input, document: { ...input.document, documentId: 8, sourceKind: undefined, title: 'Occupied' } }
    expect(() => assertNoRebuildIdentityCollisions([input, legacy], new Map([
      [7, [getDocumentIdentityKey(input.document, 'Occupied')]],
    ]))).toThrow('одинаковые названия')
  })
  it('includes mixed first/repeat cycles and splits by line, never by cycle number', () => {
    const input = source()
    const build = (mode: 'line' | 'none') => buildSystemDocumentRebuildDocuments({ sources: [input],
      settings: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
        splitModes: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes, pstoRequest: mode } }, nextNumbers: { pstoRequest: 6 } })
    const preview = build('line')
    expect(preview.checkedDocumentCount).toBe(1)
    expect(preview.documents[0].groups.map(group => [group.rowIds, group.cycleSequences])).toEqual([[[1], [2]], [[2], [1]]])
    expect(preview.documents[0].groups.map(group => group.joints)).toEqual([['S1 (циклы: 2)'], ['S2 (циклы: 1)']])
    expect(build('none').documents[0].groups).toHaveLength(1)
    expect(build('none').documents[0].groups[0].cycleSequences).toEqual([1, 2])
    const custom = structuredClone(input)
    custom.document.title = 'Ручное имя'
    const customPreview = buildSystemDocumentRebuildDocuments({ sources: [custom], settings: {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS, splitModes: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes, pstoRequest: 'line' },
    }, nextNumbers: {} }).documents[0]
    expect(customPreview).toMatchObject({ requiresCustomNameDecision: true, willChangeAutomatically: false })
  })

  it.each(['pstoRequest', 'pstoConclusion', 'tvmtRequest', 'tvmtConclusion'] as const)('renames only %s on the exact cycle', field => {
    const input = source(), name = 'Common', date = '2026-08-24'
    const dateField = ({ pstoRequest: 'pstoRequestDate', pstoConclusion: 'pstoDate', tvmtRequest: 'tvmtRequestDate', tvmtConclusion: 'tvmtConclusionDate' } as const)[field]
    const nameField = field === 'pstoConclusion' ? 'heatTreatmentDiagram' : field
    input.document = { ...input.document, title: name, date,
      type: field === 'tvmtRequest' ? 'lnkRequest' : field === 'tvmtConclusion' ? 'lnkConclusion' : field,
      ...(field.startsWith('tvmt') ? { methodCode: 'ТВМТ' } : {}) }
    input.rows[1] = { ...input.rows[1], [nameField]: name, [dateField]: date }
    input.cyclePositions![0].cycle = { ...input.cyclePositions![0].cycle!, [nameField]: name, [dateField]: date }
    const before = structuredClone(input), nextCycles = new Map()
    const planned = planRebuildCycleGroup({ source: input, rows: input.rows,
      positionsByRow: indexRebuildCyclePositions(input), nextName: 'New', nextCyclesById: nextCycles })
    expect(input).toEqual(before)
    expect(planned.primaryRows).toEqual([{ ...before.rows[1], [nameField]: 'New' }])
    expect([...nextCycles.values()]).toEqual([{ ...before.cyclePositions![0].cycle, [nameField]: 'New' }])
    expect(planned.document.sourcePositions).toEqual(before.cyclePositions!.map(item => item.position))
    expect(planned.document.summary.cycleSequences).toEqual([1, 2])
  })

  it.each([101, 1])('preserves distinct cycles even with colliding weld/repeat ID %i, and legacy repeat documents', relationId => {
    const input = source()
    input.cyclePositions![0].position.relationId = relationId
    input.cyclePositions![0].cycle!.id = relationId
    input.rows = [input.rows[0]]
    input.cyclePositions![1] = { position: { kind: 'pstoCycle', weldJointId: 1, relationId: 1, sequence: 1 } }
    const cycles = new Map()
    const plan = planRebuildCycleGroup({ source: input, rows: input.rows, positionsByRow: indexRebuildCyclePositions(input),
      nextName: 'Renamed', nextCyclesById: cycles })
    expect(plan.document.sourcePositions).toHaveLength(2)
    expect(plan.document.summary.rowIds).toEqual([1])
    input.document.sourceKind = 'pstoRepeat'
    input.cyclePositions = [{ ...input.cyclePositions![0], position: { ...input.cyclePositions![0].position, kind: 'pstoRepeat' } }]
    expect(planRebuildCycleGroup({ source: input, rows: input.rows, positionsByRow: indexRebuildCyclePositions(input),
      nextName: 'Again', nextCyclesById: new Map() }).document.sourcePositions[0].kind).toBe('pstoRepeat')
  })

  it.each(['missing', 'wrong-weld', 'wrong-sequence', 'wrong-name'] as const)('rejects stale or inconsistent %s positions', kind => {
    const input = source(), item = input.cyclePositions![0]
    if (kind === 'missing') item.cycle = undefined
    if (kind === 'wrong-weld') item.cycle!.weldJointId = 2
    if (kind === 'wrong-sequence') item.cycle!.sequence = 3
    if (kind === 'wrong-name') item.cycle!.pstoRequest = 'Different'
    expect(() => planRebuildCycleGroup({ source: input, rows: input.rows, positionsByRow: indexRebuildCyclePositions(input),
      nextName: 'New', nextCyclesById: new Map() })).toThrow('Обновите предварительный просмотр')
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
