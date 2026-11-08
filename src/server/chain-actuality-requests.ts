import { sql } from 'drizzle-orm'
import { preHeatTreatmentControls, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { primaryActualityRequestFields, type PendingActualityRequest } from '@/lib/chain-actuality-requests'
import type { SystemDocumentSourcePosition } from '@/lib/system-document-types'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'
import { clearPendingPstoRepeatRequests } from './psto-cycle-state'
import { removeSourcedSystemDocumentPositionsInTransaction, syncSystemDocumentsForWeldChangesInTransaction } from './system-document-index'

/** The caller owns all chain rows and the document locks, and has confirmed the
 * exact pending positions. Work by method/stage, never by one SQL call per row. */
export async function persistChainActualityRequestRemovals(tx: SystemDocumentSequenceTransaction,
  previous: readonly WeldRow[], pending: readonly PendingActualityRequest[]) {
  if (!pending.length) return
  const primary = new Map<string, number[]>()
  const preIds: number[] = [], repeatPstoIds: number[] = [], repeatTvmtIds: number[] = []
  const pstoPositions: SystemDocumentSourcePosition[] = [], tvmtPositions: SystemDocumentSourcePosition[] = []
  const affected = new Map<number, WeldRow>()
  const previousById = new Map(previous.map(row => [row.id, row]))
  for (const position of pending) {
    if (position.stage === 'primary') {
      const ids = primary.get(position.method) ?? []
      ids.push(position.rowId); primary.set(position.method, ids)
      const next = affected.get(position.rowId) ?? { ...previousById.get(position.rowId)! }
      for (const field of primaryActualityRequestFields(position.method)) (next as unknown as Record<string, unknown>)[field] = null
      affected.set(next.id, next)
    } else if (position.stage === 'beforeHeatTreatment') preIds.push(position.relationId)
    else (position.method === 'ПСТО' ? repeatPstoIds : repeatTvmtIds).push(position.relationId)
    if (position.stage !== 'beforeHeatTreatment' && ['ПСТО', 'ТВМТ'].includes(position.method)) {
      (position.method === 'ПСТО' ? pstoPositions : tvmtPositions).push({ kind: 'pstoCycle',
        weldJointId: position.rowId, relationId: position.relationId, sequence: position.sequence,
        ...(position.method === 'ТВМТ' ? { methodCode: 'ТВМТ' } : {}),
      })
    }
  }
  for (const [method, ids] of primary) {
    await tx.update(weldJoints).set({ ...Object.fromEntries(primaryActualityRequestFields(method).map(field => [field, null])),
      ...(['ПСТО', 'ТВМТ'].includes(method) ? { pstoUpdatedAt: new Date() } : { lnkUpdatedAt: new Date() }),
      updatedAt: sql`greatest(clock_timestamp(), ${weldJoints.updatedAt} + interval '1 millisecond')`,
    }).where(buildNumberArrayMatch(weldJoints.id, ids))
  }
  if (preIds.length) {
    await removeSourcedSystemDocumentPositionsInTransaction({ tx, sourceKind: 'beforeHeatTreatment', relationIds: preIds, documentTypes: ['lnkRequest'] })
    await tx.update(preHeatTreatmentControls).set({ requestName: null, requestDate: null, result: null, updatedAt: new Date() })
      .where(buildNumberArrayMatch(preHeatTreatmentControls.id, preIds))
  }
  for (const [kind, ids, positions, documentType] of [
    ['psto', repeatPstoIds, pstoPositions, 'pstoRequest'],
    ['tvmt', repeatTvmtIds, tvmtPositions, 'lnkRequest'],
  ] as const) {
    if (positions.length) await removeSourcedSystemDocumentPositionsInTransaction({ tx, sourceKind: 'pstoCycle', sourcePositions: positions, documentTypes: [documentType] })
    if (ids.length) {
      await removeSourcedSystemDocumentPositionsInTransaction({ tx, sourceKind: 'pstoRepeat', relationIds: ids, documentTypes: [documentType] })
      await clearPendingPstoRepeatRequests(tx, ids, kind)
    }
  }
  if (affected.size) {
    // Normal primary requests use the shared synchronizer; it also preserves a
    // completed second method in the same document and deletes empty requests.
    await syncSystemDocumentsForWeldChangesInTransaction(tx, [...affected.values()],
      new Map([...affected.keys()].map(id => [id, previousById.get(id)!])), { documentNamesOnly: true })
  }
}
