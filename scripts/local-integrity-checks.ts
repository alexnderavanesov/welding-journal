import { getDocumentOperationPositions, type DocumentOperationSource } from '../src/lib/system-document-operation'
import { SYSTEM_DOCUMENT_TEMPLATE_PROFILES } from '../src/lib/system-document-template-types'
import type { SystemDocumentSummary, SystemDocumentSourcePosition } from '../src/lib/system-document-types'
import type { WeldRow } from '../src/lib/dispatcher-types'
import type { PreHeatTreatmentControlRecord } from '../src/lib/lnk-control-stage'
import type { PstoRepeatCycleRecord } from '../src/lib/psto-cycle'
import type { ProgramChainState } from '../src/lib/line-program-chain-state'
import { ALL_LNK_FIELD_METHODS } from '../src/lib/lnk-report-config'

export type IntegrityFinding = { code: string; category: 'relation' | 'derived' | 'review'; ids: number[] }
type StoredDocument = { id: number; type: string; title: string; periodFrom: string | null; rowCount: number; sourceMetadata: string | null }
export function inspectHistoricalRelations({ rows, documents, links, preControls, cycles, chainStates, checkUnindexedFacts = false }: {
  rows: WeldRow[]; documents: StoredDocument[]; links: { documentId: number; weldJointId: number }[]
  preControls: PreHeatTreatmentControlRecord[]; cycles: PstoRepeatCycleRecord[]; chainStates: ProgramChainState[]
  checkUnindexedFacts?: boolean
}) {
  const findings: IntegrityFinding[] = []
  const add = (code: string, category: IntegrityFinding['category'], ...ids: number[]) => findings.push({ code, category, ids })
  const rowById = new Map(rows.map(row => [row.id, row]))
  const documentById = new Map(documents.map(document => [document.id, document]))
  const preById = new Map(preControls.map(control => [control.id, control]))
  const cycleById = new Map(cycles.map(cycle => [cycle.id, cycle]))
  const linksByDocument = new Map<number, Set<number>>()
  for (const link of links) {
    if (!documentById.has(link.documentId) || !rowById.has(link.weldJointId)) add('ORPHAN_DOCUMENT_LINK', 'relation', link.documentId, link.weldJointId)
    const current = linksByDocument.get(link.documentId) ?? new Set<number>()
    if (current.has(link.weldJointId)) add('DUPLICATE_DOCUMENT_LINK', 'relation', link.documentId, link.weldJointId)
    current.add(link.weldJointId); linksByDocument.set(link.documentId, current)
  }
  for (const control of preControls) if (!rowById.has(control.weldJointId!)) add('ORPHAN_PRE_CONTROL', 'relation', control.id!, control.weldJointId!)
  const sequences = new Set<string>()
  const covered = new Set<string>()
  const factKey = (id: number, stage: string, relation: number, field: string) => JSON.stringify([id, stage, relation, field])
  for (const cycle of cycles) {
    if (!rowById.has(cycle.weldJointId!)) add('ORPHAN_REPEAT_CYCLE', 'relation', cycle.id!, cycle.weldJointId!)
    const key = `${cycle.weldJointId}:${cycle.sequence}`
    if (sequences.has(key) || !Number.isInteger(cycle.sequence) || cycle.sequence < 2) add('INVALID_REPEAT_SEQUENCE', 'relation', cycle.id!)
    sequences.add(key)
  }
  const documentIdentities = new Map<string, number>()
  for (const stored of documents) {
    if (!stored.type.startsWith('system:')) continue // Ordinary files may keep an intentional historical snapshot.
    const profile = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.find(item => `system:${item.id}` === stored.type)
    if (!profile) { add('UNKNOWN_SYSTEM_DOCUMENT_TYPE', 'review', stored.id); continue }
    const idSet = linksByDocument.get(stored.id) ?? new Set<number>()
    const ids = [...idSet]
    if (stored.rowCount !== ids.length) add('SYSTEM_DOCUMENT_ROW_COUNT', 'derived', stored.id)
    // Empty historical documents are allowed and must never be auto-deleted.
    if (!ids.length) continue
    let metadata: Partial<SystemDocumentSummary> & { sourcePositions?: SystemDocumentSourcePosition[] } = {}
    try {
      const parsed: unknown = stored.sourceMetadata ? JSON.parse(stored.sourceMetadata) : {}
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid metadata')
      metadata = parsed
    } catch { add('INVALID_SYSTEM_DOCUMENT_METADATA', 'derived', stored.id); continue }
    const identity = JSON.stringify([stored.type, stored.title.trim(), stored.periodFrom, metadata.sourceKind === 'beforeHeatTreatment' ? 'pre' : metadata.sourceKind === 'pstoRepeat' || metadata.sourceKind === 'pstoCycle' ? 'cycle' : 'primary', metadata.methodCode ?? ''])
    if (documentIdentities.has(identity)) add('DUPLICATE_SYSTEM_DOCUMENT_IDENTITY', 'derived', documentIdentities.get(identity)!, stored.id)
    else documentIdentities.set(identity, stored.id)
    const positions = metadata.sourcePositions ?? []
    if (!Array.isArray(positions) || positions.some(position => !position || typeof position !== 'object' ||
      !['beforeHeatTreatment', 'pstoRepeat', 'pstoCycle'].includes(position.kind) ||
      !Number.isInteger(position.weldJointId) || position.weldJointId <= 0 || !Number.isInteger(position.relationId) || position.relationId <= 0)) {
      add('INVALID_SOURCE_POSITIONS', 'derived', stored.id); continue
    }
    if (metadata.sourceKind && !positions.length) { add('LEGACY_MISSING_EXACT_POSITIONS', 'review', stored.id); continue }
    const linkedRows = ids.flatMap(id => rowById.has(id) ? [rowById.get(id)!] : [])
    const source: DocumentOperationSource = {
      document: { ...metadata, type: profile.documentType, documentId: stored.id, id: String(stored.id), title: stored.title, date: stored.periodFrom ?? '', rowIds: ids, rowCount: ids.length } as SystemDocumentSummary,
      rows: linkedRows,
    }
    if (metadata.sourceKind === 'beforeHeatTreatment') {
      source.controls = []
      for (const position of positions) {
        const control = preById.get(position.relationId)
        if (!control || control.weldJointId !== position.weldJointId || !idSet.has(position.weldJointId)) add('WRONG_PRE_CONTROL_POSITION', 'relation', stored.id, position.relationId)
        if (control) source.controls.push({ position, control })
      }
    } else if (metadata.sourceKind === 'pstoRepeat' || metadata.sourceKind === 'pstoCycle') {
      source.cyclePositions = positions.map(position => {
        const cycle = cycleById.get(position.relationId)
        const primary = position.kind === 'pstoCycle' && position.sequence === 1
        if (!idSet.has(position.weldJointId) || (primary ? position.relationId !== position.weldJointId
          : !cycle || cycle.weldJointId !== position.weldJointId || cycle.sequence !== position.sequence)) add('WRONG_CYCLE_POSITION', 'relation', stored.id, position.relationId)
        return { position, ...(primary ? {} : { cycle }) }
      })
    }
    try {
      for (const position of getDocumentOperationPositions(source)) covered.add(factKey(position.row.id,
        position.stage === 'До ТО' ? 'pre' : (position.cycle ?? 1) > 1 ? 'repeat' : 'primary',
        position.relationId ?? position.row.id, position.field))
    } catch { add('DOCUMENT_FACT_COMPOSITION_MISMATCH', 'derived', stored.id) }
  }
  // Reverse direction: a valid-looking document cannot prove that every saved
  // factual request/result is actually represented in the registry.
  if (checkUnindexedFacts) {
    const check = (record: object, id: number, stage: string, relation: number, fields: string[]) => {
      for (const field of fields) if (String((record as Record<string, unknown>)[field] ?? '').trim() && !covered.has(factKey(id, stage, relation, field))) {
        add('FACT_WITHOUT_INDEXED_DOCUMENT_POSITION', 'derived', id, relation)
      }
    }
    const cycleFields = ['pstoRequest', 'heatTreatmentDiagram', 'tvmtRequest', 'tvmtConclusion']
    for (const row of rows) check(row, row.id, 'primary', row.id, [...ALL_LNK_FIELD_METHODS.flatMap(method => [method.requestKey, method.conclusionKey]), 'pstoRequest', 'heatTreatmentDiagram'])
    for (const control of preControls) check(control, control.weldJointId!, 'pre', control.id!, ['requestName', 'conclusionName'])
    for (const cycle of cycles) check(cycle, cycle.weldJointId!, 'repeat', cycle.id!, cycleFields)
  }
  // Deleted states are deliberate tombstones. Only a cycle in predecessor
  // edges is invalid; missing live rows and self physicalRootId are allowed.
  const states = new Map(chainStates.map(state => [state.weldJointId, state]))
  const finished = new Set<number>(), active = new Set<number>()
  function visit(id: number) {
    if (active.has(id)) { add('CHAIN_PREDECESSOR_CYCLE', 'relation', id); return }
    if (finished.has(id)) return
    active.add(id)
    const state = states.get(id)
    for (const parent of new Set([state?.sourceRowId, state?.coilParentId])) if (parent != null && states.has(parent)) visit(parent)
    active.delete(id); finished.add(id)
  }
  for (const id of states.keys()) visit(id)
  return findings
}
