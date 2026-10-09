import { and, asc, eq, gt, ilike, inArray, sql } from 'drizzle-orm'
import { appSettings, technologyCardNames, technologyCards, weldJoints, type TechnologyCard } from '@/db/schema'
import { normalizeDataListSettings } from '@/lib/data-list-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { createTechnologyCardMatcher } from '@/lib/technology-card-matching'
import type { TechnologyCardIssue, TechnologyCardRecord, TechnologyCardWeld } from '@/lib/technology-card-types'
import { validateTechnologyCard } from '@/lib/technology-card-validation'
import { normalizeTechnologyCardName } from '@/lib/technology-card-name'
import type { SystemDocumentSequenceTransaction as Transaction } from '@/server/system-document-sequences'
import { lockTechnologyCardRegistry } from '@/server/technology-card-registry-lock'
import { lockWeldValidationSettings } from '@/server/weld-validation-settings-lock'

// Internal persistence; technology-cards.ts checks RPC security scopes.
// Every function here requires the caller's transaction.
export type TechnologyCardPageRequest = {
  afterId?: number
  limit?: number
  search?: string
  archive?: 'active' | 'archived' | 'all'
}

export function normalizeTechnologyCardPageRequest(input: TechnologyCardPageRequest = {}) {
  return {
    afterId: Number.isSafeInteger(input.afterId) && Number(input.afterId) > 0 ? Number(input.afterId) : 0,
    limit: Number.isSafeInteger(input.limit) ? Math.max(1, Math.min(100, Number(input.limit))) : 50,
    search: typeof input.search === 'string' ? input.search.trim() : '',
    archive: input.archive === 'archived' || input.archive === 'all' ? input.archive : 'active',
  }
}

export function toTechnologyCardRecord(card: TechnologyCard): TechnologyCardRecord {
  return {
    id: card.id, name: card.name, weldingMethods: card.weldingMethods, connectionType: card.connectionType,
    materialGroups: card.materialGroups, diameterFrom: card.diameterFrom, diameterTo: card.diameterTo,
    thicknessFrom: card.thicknessFrom, thicknessTo: card.thicknessTo, psto: card.psto,
    archived: card.archived, revision: card.revision,
  }
}

export async function readTechnologyCardPage(tx: Transaction, request: TechnologyCardPageRequest = {}) {
  const input = normalizeTechnologyCardPageRequest(request)
  const search = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`
  const rows = await tx.select().from(technologyCards).where(and(
    gt(technologyCards.id, input.afterId),
    input.archive === 'all' ? undefined : eq(technologyCards.archived, input.archive === 'archived'),
    input.search ? ilike(technologyCards.name, search) : undefined,
  )).orderBy(asc(technologyCards.id)).limit(input.limit + 1)
  const items = rows.slice(0, input.limit).map(toTechnologyCardRecord)
  return { items, nextCursor: rows.length > input.limit ? items.at(-1)!.id : null }
}

export class TechnologyCardValidationError extends Error {
  constructor(readonly issues: TechnologyCardIssue[]) {
    super(issues.map(issue => issue.message).join('\n'))
    this.name = 'TechnologyCardValidationError'
  }
}

export function assertTechnologyCardRevision(actual: number, expected: unknown) {
  if (!Number.isSafeInteger(expected) || Number(expected) <= 0 || expected !== actual) {
    throw new Error('Технологическая карта уже изменена. Обновите реестр и повторите действие с актуальными данными.')
  }
}

export async function readTechnologyCardSettings(tx: Transaction) {
  const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.dataList)).limit(1)
  return normalizeDataListSettings(row ? JSON.parse(row.value) : undefined)
}

async function prepareRegistryMutation(tx: Transaction) {
  await lockWeldValidationSettings(tx)
  await lockTechnologyCardRegistry(tx, 'exclusive')
}

async function validateParameters(tx: Transaction, input: unknown) {
  const result = validateTechnologyCard(input, await readTechnologyCardSettings(tx))
  if (!result.card) throw new TechnologyCardValidationError(result.issues)
  return result.card
}

async function assertNameAvailable(tx: Transaction, name: string, excludingId?: number) {
  const [existing] = await tx.select({ id: technologyCardNames.technologyCardId }).from(technologyCardNames).where(eq(technologyCardNames.name, name)).limit(1)
  if (existing && existing.id !== excludingId) throw new Error(`Название «${name}» уже существует в реестре ТК, архиве или истории названий другой карты.`)
}

async function hasStoredWeldReference(tx: Transaction, name: string) {
  const [row] = await tx.select({ id: weldJoints.id }).from(weldJoints)
    .where(eq(sql<string>`btrim(${weldJoints.technologyCardNumber})`, name)).limit(1)
  return Boolean(row)
}

async function hasHistoricalCardReference(tx: Transaction, card: TechnologyCard) {
  if (card.firstUsedAt) return true
  const [row] = await tx.select({ id: weldJoints.id }).from(technologyCardNames)
    .innerJoin(weldJoints, eq(sql<string>`btrim(${weldJoints.technologyCardNumber})`, technologyCardNames.name))
    .where(eq(technologyCardNames.technologyCardId, card.id)).limit(1)
  return Boolean(row)
}

export async function createTechnologyCardInTransaction(tx: Transaction, input: unknown) {
  await prepareRegistryMutation(tx)
  const parameters = await validateParameters(tx, input)
  await assertNameAvailable(tx, parameters.name)
  const used = await hasStoredWeldReference(tx, parameters.name)
  const [saved] = await tx.insert(technologyCards).values({ ...parameters, firstUsedAt: used ? new Date() : null }).returning()
  await tx.insert(technologyCardNames).values({ name: saved.name, technologyCardId: saved.id })
  return toTechnologyCardRecord(saved)
}

async function readCurrentCard(tx: Transaction, input: { id: number; expectedRevision: number }) {
  if (!Number.isSafeInteger(input.id) || input.id <= 0) throw new Error('Не указана технологическая карта.')
  const [current] = await tx.select().from(technologyCards).where(eq(technologyCards.id, input.id)).for('update')
  if (!current) throw new Error('Технологическая карта больше не существует. Обновите реестр.')
  assertTechnologyCardRevision(current.revision, input.expectedRevision)
  return current
}

export async function updateTechnologyCardInTransaction(tx: Transaction, input: { id: number; expectedRevision: number; card: unknown }) {
  await prepareRegistryMutation(tx)
  const current = await readCurrentCard(tx, input)
  const parameters = await validateParameters(tx, input.card)
  await assertNameAvailable(tx, parameters.name, current.id)
  const used = current.firstUsedAt || (await hasHistoricalCardReference(tx, current) ||
    (parameters.name !== current.name && await hasStoredWeldReference(tx, parameters.name)) ? new Date() : null)
  // Retain every prior designation; no UPDATE of weld_joints is permitted here.
  if (parameters.name !== current.name) await tx.insert(technologyCardNames)
    .values({ name: parameters.name, technologyCardId: current.id }).onConflictDoNothing()
  const [saved] = await tx.update(technologyCards).set({ ...parameters, firstUsedAt: used,
    revision: current.revision + 1, updatedAt: new Date() }).where(eq(technologyCards.id, current.id)).returning()
  return toTechnologyCardRecord(saved)
}

/** Resolve text in one batch, including past names. Unknown text is left alone.
 * Assignment callers hold the shared registry lock through their final write. */
export async function resolveTechnologyCardNames(tx: Transaction, values: readonly string[]) {
  const names = [...new Set(values.map(normalizeTechnologyCardName).filter(Boolean))]
  if (!names.length) return new Map<string, TechnologyCardRecord>()
  const rows = await tx.select({ name: technologyCardNames.name, card: technologyCards })
    .from(technologyCardNames).innerJoin(technologyCards, eq(technologyCards.id, technologyCardNames.technologyCardId))
    .where(sql`${technologyCardNames.name} = any(${sql.param(names)}::text[])`)
  return new Map(rows.map(row => [row.name, toTechnologyCardRecord(row.card)]))
}

export async function readTechnologyCardNameHistory(tx: Transaction, id: number) {
  return tx.select({ name: technologyCardNames.name, createdAt: technologyCardNames.createdAt })
    .from(technologyCardNames).where(eq(technologyCardNames.technologyCardId, id))
    .orderBy(asc(technologyCardNames.createdAt), asc(technologyCardNames.name))
}

export async function setTechnologyCardArchivedInTransaction(tx: Transaction, input: { id: number; expectedRevision: number; archived: boolean }) {
  if (typeof input.archived !== 'boolean') throw new Error('Не указано действие с архивом ТК.')
  await prepareRegistryMutation(tx)
  const current = await readCurrentCard(tx, input)
  if (current.archived === input.archived) return toTechnologyCardRecord(current)
  const used = current.firstUsedAt || (await hasHistoricalCardReference(tx, current) ? new Date() : null)
  const [saved] = await tx.update(technologyCards).set({ archived: input.archived, firstUsedAt: used, revision: current.revision + 1, updatedAt: new Date() })
    .where(eq(technologyCards.id, current.id)).returning()
  return toTechnologyCardRecord(saved)
}

export async function deleteTechnologyCardInTransaction(tx: Transaction, input: { id: number; expectedRevision: number; confirmed: boolean }) {
  if (input.confirmed !== true) throw new Error('Подтвердите удаление технологической карты.')
  await prepareRegistryMutation(tx)
  const current = await readCurrentCard(tx, input)
  if (await hasHistoricalCardReference(tx, current)) {
    throw new Error(`Технологическая карта «${current.name}» уже использована в стыках. Для сохранения истории отправьте её в архив.`)
  }
  await tx.delete(technologyCards).where(eq(technologyCards.id, current.id))
  return { id: current.id }
}

/** One registry read for an entire save/import batch, under the same transaction
 * lock that registry mutations acquire exclusively. No journal reads. */
export async function loadTechnologyCardMatcher(tx: Transaction) {
  await lockWeldValidationSettings(tx)
  await lockTechnologyCardRegistry(tx)
  const settings = await readTechnologyCardSettings(tx)
  const cards = await tx.select().from(technologyCards).where(eq(technologyCards.archived, false))
  return createTechnologyCardMatcher(cards, settings)
}

/** Call with old AND final rows while saving facts, including explicit clears.
 * The sticky usage marker preserves history even after the last reference goes. */
export async function markTechnologyCardsUsed(tx: Transaction, rows: readonly TechnologyCardWeld[]) {
  const names = [...new Set(rows.map(row => normalizeTechnologyCardName(row.technologyCardNumber)).filter(Boolean))]
  if (!names.length) return
  await lockTechnologyCardRegistry(tx)
  await tx.update(technologyCards).set({ firstUsedAt: sql`coalesce(${technologyCards.firstUsedAt}, now())` })
    .where(and(sql`${technologyCards.firstUsedAt} is null`, inArray(technologyCards.id,
      tx.select({ id: technologyCardNames.technologyCardId }).from(technologyCardNames)
        .where(sql`${technologyCardNames.name} = any(${sql.param(names)}::text[])`))))
}
