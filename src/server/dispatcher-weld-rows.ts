import { asc, desc } from 'drizzle-orm'
import { weldJoints } from '@/db/schema'
import { encodeIdentityKey } from '@/lib/identity-key'
import { normalizeJointChainPart } from '@/lib/joint-chain'
import { readDispatcherWeldBatch } from './dispatcher-weld-hydration'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

export const DISPATCHER_WELD_READ_BATCH_SIZE = 5_000
// Four small hydration reads share one set of relation queries. This keeps
// the pre-existing <200-query budget at 200k joints without retaining the
// entire journal or increasing an individual wide PostgreSQL result.
export const DISPATCHER_WELD_WORKING_SET_SIZE = 20_000

type ScopeIdentity = { projectTitle?: unknown; subtitleCode?: unknown; line?: unknown }
type Scope = { key: string; contextKey: string; ids: number[] }
type Row = typeof weldJoints.$inferSelect

export function getDispatcherScopeKey(scope: ScopeIdentity) {
  return encodeIdentityKey([scope.projectTitle, scope.subtitleCode, scope.line].map(value => String(value ?? '').trim().toLocaleLowerCase('ru-RU')))
}

export function planDispatcherWeldBatches(rows: Array<ScopeIdentity & { id: number }>) {
  const byScope = new Map<string, Scope>()
  const contexts = new Map<string, Scope[]>()
  for (const row of rows) {
    const key = getDispatcherScopeKey(row)
    let scope = byScope.get(key)
    if (!scope) {
      // Final-status same-name repair lookup ignores all whitespace, unlike
      // dispatcher scope grouping. Preserve that existing cross-scope context.
      const contextKey = encodeIdentityKey([row.projectTitle, row.subtitleCode, row.line].map(normalizeJointChainPart))
      scope = { key, contextKey, ids: [] }
      byScope.set(key, scope)
      const siblings = contexts.get(contextKey) ?? []
      siblings.push(scope); contexts.set(contextKey, siblings)
    }
    scope.ids.push(row.id)
  }
  const scopes = [...byScope.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const batches: Scope[][] = []
  let batch: Scope[] = [], count = 0
  for (const scope of scopes) {
    if (batch.length && count + scope.ids.length > DISPATCHER_WELD_WORKING_SET_SIZE) {
      batches.push(batch); batch = []; count = 0
    }
    batch.push(scope); count += scope.ids.length
  }
  if (batch.length) batches.push(batch)
  return { batches, contexts }
}

/** Whole-line batches in the original task order. Only narrow identities and
 * IDs span the journal; facts, relations and task calculation live in a batch.
 * The caller's transaction/revision guard remains responsible for publication.
 */
export async function visitDispatcherWeldRows(
  db: Pick<SystemDocumentSequenceTransaction, 'select' | 'execute'>,
  visit: (rows: Row[], scopeKeys: ReadonlySet<string>) => Promise<void>,
  onPhase?: (stage: string) => void,
) {
  onPhase?.('plan-weld-batches')
  const loadPlan = async () => planDispatcherWeldBatches(await db.select({ id: weldJoints.id,
    projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode, line: weldJoints.line,
  }).from(weldJoints).orderBy(desc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint)))
  const { batches, contexts } = await loadPlan()
  const visitBatch = async (batch: Scope[]) => {
    onPhase?.('read-weld-batch')
    const contextScopes = new Set(batch.flatMap(scope => contexts.get(scope.contextKey) ?? []))
    const ids = [...contextScopes].flatMap(scope => scope.ids)
    const rows: Row[] = []
    // Even an unusually large line is hydrated in bounded chunks, without
    // splitting its business calculation or dropping historical neighbours.
    for (let offset = 0; offset < ids.length; offset += DISPATCHER_WELD_READ_BATCH_SIZE) {
      const source = await readDispatcherWeldBatch(db, ids.slice(offset, offset + DISPATCHER_WELD_READ_BATCH_SIZE))
      // The flat driver reader already returns fresh, consistently shaped rows.
      for (const row of source) rows.push(row)
    }
    const byId = new Map(rows.map(row => [row.id, row]))
    await visit(ids.flatMap(id => { const row = byId.get(id); return row ? [row] : [] }), new Set(batch.map(scope => scope.key)))
  }
  for (const batch of batches) await visitBatch(batch)
}
