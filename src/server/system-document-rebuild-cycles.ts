import type { WeldRow } from '@/lib/dispatcher-types'
import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import type { SystemDocumentRebuildSource } from '@/lib/system-document-rebuild'
import { buildSystemDocumentSummaries, type SystemDocumentSummary } from '@/lib/system-document-types'
import { buildPrimaryPstoSystemDocumentRow, buildPstoRepeatSystemDocumentRow } from '@/lib/system-document-virtual-row'
import type { SourcedSystemDocumentUpsertInput } from '@/server/system-document-index'

export function getRebuildCycleField(document: SystemDocumentSummary) {
  if (document.type === 'pstoRequest') return { name: 'pstoRequest', date: 'pstoRequestDate' } as const
  if (document.type === 'pstoConclusion') return { name: 'heatTreatmentDiagram', date: 'pstoDate' } as const
  if (document.methodCode === 'ТВМТ') {
    return document.type === 'lnkRequest'
      ? { name: 'tvmtRequest', date: 'tvmtRequestDate' } as const
      : { name: 'tvmtConclusion', date: 'tvmtConclusionDate' } as const
  }
  throw new Error('Некорректный вид документа цикла ПСТО/ТВМТ. Обновите предварительный просмотр.')
}

// Build once per source; group lookups then stay linear in total positions,
// including a single weld represented by several distinct cycles.
export function indexRebuildCyclePositions(source: SystemDocumentRebuildSource) {
  const byRow = new Map<number, NonNullable<SystemDocumentRebuildSource['cyclePositions']>>()
  for (const item of source.cyclePositions ?? []) {
    const positions = byRow.get(item.position.weldJointId) ?? []
    positions.push(item)
    byRow.set(item.position.weldJointId, positions)
  }
  return byRow
}

export function planRebuildCycleGroup({
  source, rows, positionsByRow, nextName, nextCyclesById,
}: {
  source: SystemDocumentRebuildSource
  rows: WeldRow[]
  positionsByRow: ReturnType<typeof indexRebuildCyclePositions>
  nextName: string
  nextCyclesById: Map<number, PstoRepeatCycleRecord>
}): { primaryRows: WeldRow[]; document: SourcedSystemDocumentUpsertInput } {
  const field = getRebuildCycleField(source.document)
  const primaryRows: WeldRow[] = []
  const virtualRows: WeldRow[] = []
  const sourcePositions = [] as SourcedSystemDocumentUpsertInput['sourcePositions']
  const sequences = new Set<number>()
  for (const row of rows) {
    const positions = positionsByRow.get(row.id)
    if (!positions?.length) throw staleCycleError(source.document)
    for (const { position, cycle } of positions) {
      const sequence = position.sequence ?? cycle?.sequence
      const isPrimary = position.kind === 'pstoCycle' && sequence === 1
      if (isPrimary ? position.relationId !== row.id : (
        !cycle || cycle.id !== position.relationId || cycle.weldJointId !== row.id || cycle.sequence !== sequence || cycle.sequence < 2
      )) throw staleCycleError(source.document)
      const record = isPrimary ? row : cycle!
      if (String(record[field.name] ?? '').trim() !== source.document.title.trim() ||
        String(record[field.date] ?? '').slice(0, 10) !== source.document.date.slice(0, 10)) {
        throw staleCycleError(source.document)
      }
      if (isPrimary) {
        const next = { ...row, [field.name]: nextName }
        primaryRows.push(next)
        virtualRows.push(buildPrimaryPstoSystemDocumentRow(next))
      } else {
        const next = { ...(nextCyclesById.get(cycle!.id) ?? cycle!), [field.name]: nextName }
        nextCyclesById.set(next.id, next)
        virtualRows.push(buildPstoRepeatSystemDocumentRow(row, next))
      }
      sourcePositions.push(position)
      sequences.add(sequence!)
    }
  }
  const summary = buildSystemDocumentSummaries(virtualRows, source.document.type).find(candidate =>
    candidate.title === nextName && candidate.date === source.document.date &&
    (candidate.methodCode ?? '') === (source.document.methodCode ?? ''),
  )
  if (!summary) throw staleCycleError(source.document)
  return {
    primaryRows,
    document: { summary: { ...summary, sourceKind: source.document.sourceKind!,
      cycleSequences: [...sequences].sort((a, b) => a - b),
    }, sourcePositions },
  }
}

function staleCycleError(document: SystemDocumentSummary) {
  return new Error(`Позиции или циклы документа «${document.title}» изменились. Обновите предварительный просмотр.`)
}
