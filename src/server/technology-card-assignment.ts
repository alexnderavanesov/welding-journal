import { auditSql } from './audit-functions'
import { createHash } from 'node:crypto'
import { and, asc, desc, gt, lte, sql } from 'drizzle-orm'
import { technologyCardNames, technologyCards, weldJoints } from '@/db/schema'
import {
  createTechnologyCardAssignmentClassifier, emptyTechnologyCardAssignmentCounts, isTechnologyCardAssignmentAction,
  TK_ASSIGNMENT_CHUNK_SIZE, TK_ASSIGNMENT_SCAN_SIZE,
  type TechnologyCardAssignmentApplyInput, type TechnologyCardAssignmentChunk, type TechnologyCardAssignmentContext,
  type TechnologyCardAssignmentRow, type TechnologyCardAssignmentScan,
} from '@/lib/technology-card-assignment'
import type { SystemDocumentSequenceTransaction as Transaction } from '@/server/system-document-sequences'
import { lockWeldValidationSettings } from '@/server/weld-validation-settings-lock'
import { lockTechnologyCardRegistry } from '@/server/technology-card-registry-lock'
import { markTechnologyCardsUsed, readTechnologyCardSettings, toTechnologyCardRecord } from '@/server/technology-card-registry'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const columns = {
  id: weldJoints.id, projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode, line: weldJoints.line, joint: weldJoints.joint,
  weldDate: weldJoints.weldDate, technologyCardNumber: weldJoints.technologyCardNumber, weldingMethod: weldJoints.weldingMethod,
  connectionType: weldJoints.connectionType, materialGroup: weldJoints.materialGroup, d1: weldJoints.d1, d2: weldJoints.d2,
  t1: weldJoints.t1, t2: weldJoints.t2, pstoRequired: weldJoints.pstoRequired,
  // Keep PostgreSQL microseconds, not the millisecond-rounded JS Date.
  version: sql<string>`${weldJoints.updatedAt}::text`,
}

async function loadContext(tx: Transaction, expected?: TechnologyCardAssignmentContext) {
  await lockWeldValidationSettings(tx)
  await lockTechnologyCardRegistry(tx)
  const settings = await readTechnologyCardSettings(tx)
  const cards = (await tx.select().from(technologyCards).orderBy(asc(technologyCards.id))).map(toTechnologyCardRecord)
  const names = await tx.select({ name: technologyCardNames.name, cardId: technologyCardNames.technologyCardId }).from(technologyCardNames).orderBy(asc(technologyCardNames.name))
  const hash = fingerprint([1, settings, cards, names])
  if (expected && (expected.version !== 1 || expected.fingerprint !== hash || !Number.isSafeInteger(expected.upperId) || expected.upperId < 0)) {
    throw new Error('Реестр ТК или справочники изменились. Начните новую проверку; текущая порция не сохранена.')
  }
  return { hash, classify: createTechnologyCardAssignmentClassifier({ cards, names }, settings) }
}

export async function scanTechnologyCardAssignments(tx: Transaction, input: { context?: TechnologyCardAssignmentContext; afterId?: number }): Promise<TechnologyCardAssignmentScan> {
  const afterId = input.afterId ?? 0
  if (!Number.isSafeInteger(afterId) || afterId < 0) throw new Error('Некорректная страница проверки ТК.')
  const { hash, classify } = await loadContext(tx, input.context)
  const upperId = input.context?.upperId ?? (await tx.select({ id: weldJoints.id }).from(weldJoints).orderBy(desc(weldJoints.id)).limit(1))[0]?.id ?? 0
  const context: TechnologyCardAssignmentContext = { version: 1, fingerprint: hash, upperId }
  const rows = await tx.select(columns).from(weldJoints).where(and(gt(weldJoints.id, afterId), lte(weldJoints.id, upperId))).orderBy(asc(weldJoints.id)).limit(TK_ASSIGNMENT_SCAN_SIZE + 1)
  const chunks: TechnologyCardAssignmentChunk[] = []
  let cursor = afterId
  for (let i = 0; i < Math.min(rows.length, TK_ASSIGNMENT_SCAN_SIZE); i += TK_ASSIGNMENT_CHUNK_SIZE) {
    const batch = rows.slice(i, Math.min(i + TK_ASSIGNMENT_CHUNK_SIZE, TK_ASSIGNMENT_SCAN_SIZE))
    const counts = emptyTechnologyCardAssignmentCounts()
    for (const row of batch) { const result = classify(row); counts[result.kind]++; if (result.mismatch) counts.mismatch++ }
    const throughId = batch.at(-1)!.id
    chunks.push({ afterId: cursor, throughId, fingerprint: fingerprint(batch), counts, size: batch.length })
    cursor = throughId
  }
  return { context, chunks, nextCursor: rows.length > TK_ASSIGNMENT_SCAN_SIZE ? cursor : null }
}

function assertChunk(context: TechnologyCardAssignmentContext, chunk: TechnologyCardAssignmentChunk) {
  if (!context || !chunk || !Number.isSafeInteger(chunk.afterId) || chunk.afterId < 0 || !Number.isSafeInteger(chunk.throughId) ||
    chunk.throughId <= chunk.afterId || chunk.throughId > context.upperId || typeof chunk.fingerprint !== 'string') throw new Error('Некорректная порция проверки ТК.')
}
async function readChunk(tx: Transaction, context: TechnologyCardAssignmentContext, chunk: TechnologyCardAssignmentChunk, lock: boolean) {
  assertChunk(context, chunk)
  const query = tx.select(columns).from(weldJoints).where(and(gt(weldJoints.id, chunk.afterId), lte(weldJoints.id, chunk.throughId))).orderBy(asc(weldJoints.id)).limit(TK_ASSIGNMENT_CHUNK_SIZE + 1)
  const rows = await (lock ? query.for('update') : query)
  if (rows.length > TK_ASSIGNMENT_CHUNK_SIZE || fingerprint(rows) !== chunk.fingerprint) {
    throw new Error('Стыки в этой порции изменились после проверки (либо порция уже сохранена). Ничего в ней не изменено. Запустите новую проверку оставшихся стыков.')
  }
  return rows
}

export async function readTechnologyCardAssignmentDetails(tx: Transaction, input: { context: TechnologyCardAssignmentContext; chunk: TechnologyCardAssignmentChunk }) {
  const { classify } = await loadContext(tx, input.context)
  return (await readChunk(tx, input.context, input.chunk, false)).map(classify)
}

/** A short, locked transaction changes only the TK and its welding timestamps.
 * No document memberships, materials, control results or general save normalization.
 * Chunk hashes make preview verification stateless and bounded; a stale chunk is
 * rejected as a whole, so even edits committed with an older timestamp are safe. */
export async function applyTechnologyCardAssignments(tx: Transaction, input: TechnologyCardAssignmentApplyInput) {
  if (!Array.isArray(input.actions) || !input.actions.length || input.actions.length > 3 || input.actions.some(action => !isTechnologyCardAssignmentAction(action)) ||
    !Array.isArray(input.excludedIds) || input.excludedIds.length > TK_ASSIGNMENT_CHUNK_SIZE || input.excludedIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Проверьте выбранные действия и стыки.')
  const { classify } = await loadContext(tx, input.context)
  const rows = await readChunk(tx, input.context, input.chunk, true)
  const excluded = new Set(input.excludedIds)
  const changes: Array<{ id: number; name: string }> = []
  const changedRows: TechnologyCardAssignmentRow[] = []
  const counts = { assign: 0, reassign: 0, rename: 0 }
  for (const row of rows) {
    const proposal = classify(row)
    if (excluded.has(row.id) || !isTechnologyCardAssignmentAction(proposal.kind) || !input.actions.includes(proposal.kind)) continue
    changes.push({ id: row.id, name: proposal.newName }); changedRows.push(row); counts[proposal.kind]++
  }
  if (changes.length) {
    await auditSql(tx, [{ table: weldJoints, where: sql`${weldJoints.id} = any(${sql.param(changes.map(change => change.id))}::integer[])` }], () => tx.execute(sql`update ${weldJoints} as w set technology_card_number = p.name,
      welding_updated_at = greatest(clock_timestamp(), w.updated_at + interval '1 millisecond'),
      updated_at = greatest(clock_timestamp(), w.updated_at + interval '1 millisecond')
      from jsonb_to_recordset(${JSON.stringify(changes)}::jsonb) as p(id integer, name text) where w.id = p.id`))
    await markTechnologyCardsUsed(tx, [...changedRows, ...changes.map(change => ({ technologyCardNumber: change.name }))])
    await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(changedRows, new Map()) })
  }
  return counts
}
