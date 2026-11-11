import { createHash, randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { linePrograms, lineSchemeBundles, lineSchemeFiles, lineSchemePoints, lineSchemeReceipts, lineSchemeRevisions } from '@/db/schema'
import { assertPermission, hasPermission, type AccessIdentity, type Permission } from '@/lib/access-permissions'
import { SCHEME_LOCK_MS, schemeId, schemeToken, schemeChangeNumber, validateSchemeChanges, type SchemeChanges, type SchemeLease } from '@/lib/line-schemes'
import { lockAccessChanges, requireCurrentActor } from './account-management'
import { requireIdentity } from './access-context'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { readSchemeBundle, readSchemeTopology } from './line-scheme-read'
import { ensureSchemePhysicals } from './line-scheme-identity'
import { getSchemeFileStore } from './line-scheme-storage'
import { cleanupSchemeFilesInStore } from './line-scheme-file-cleanup'
import { buildNumberArrayMatch } from './weld-request-utils'
import { lockWeldLineMemberships } from './weld-line-membership-lock'
import { saveSchemeAnnotations } from './line-scheme-annotations'
import { saveSchemeDimensions } from './line-scheme-dimensions'

type Tx = SystemDocumentSequenceTransaction
type Bundle = typeof lineSchemeBundles.$inferSelect
export type SchemeWriteRequest = { bundleId: number; token: string; version: number; operationId: string }
export function validateSchemeWrite(data: SchemeWriteRequest) { schemeId(data.bundleId); schemeToken(data.token); schemeToken(data.operationId); schemeId(data.version, 'Версия'); return data }
const expires = () => new Date(Date.now() + SCHEME_LOCK_MS)
const lease = (bundle: Bundle, actor: AccessIdentity, token: string): SchemeLease => ({ owned: bundle.lockUserId === actor.id && bundle.lockToken === token && !!bundle.lockExpiresAt && bundle.lockExpiresAt.getTime() > Date.now(), name: bundle.lockExpiresAt && bundle.lockExpiresAt.getTime() > Date.now() ? bundle.lockName : null, expiresAt: bundle.lockExpiresAt?.toISOString() ?? null })
async function actorForWrite(tx: Tx, actor: AccessIdentity, permissions: Permission[]) {
  await lockAccessChanges(tx); const current = await requireCurrentActor(tx, actor)
  for (const permission of permissions) assertPermission(current, permission)
  return current
}
async function lockedBundle(tx: Tx, id: number) {
  const [bundle] = await tx.select().from(lineSchemeBundles).where(eq(lineSchemeBundles.id, id)).for('update')
  if (!bundle) throw new Error('Схема больше не существует.')
  return bundle
}
function requireLease(bundle: Bundle, actor: AccessIdentity, token: string) {
  if (!lease(bundle, actor, token).owned) throw new Error('Право редактирования схемы потеряно. Изменения не сохранены. Обновите доступ к редактированию.')
}

export async function openScheme(data: { lineId: number; token: string; acquire?: boolean }) {
  schemeId(data.lineId); schemeToken(data.token)
  const actor = await requireIdentity(); assertPermission(actor, 'schemes.view')
  return requireDb().transaction(async tx => {
    const current = data.acquire !== false ? await actorForWrite(tx, actor, ['schemes.view']) : actor
    const editable = data.acquire !== false && (hasPermission(current, 'schemes.edit') || hasPermission(current, 'schemes.delete'))
    let [bundle] = await tx.select().from(lineSchemeBundles).where(eq(lineSchemeBundles.lineProgramId, data.lineId))
    if (!bundle) {
      if (!editable || !hasPermission(current, 'schemes.edit')) return { bundle: null, lease: { owned: false, name: null, expiresAt: null } as SchemeLease }
      const [line] = await tx.select().from(linePrograms).where(eq(linePrograms.id, data.lineId)).for('key share')
      if (!line) throw new Error('Линия удалена. Обновите список.')
      await tx.insert(lineSchemeBundles).values({ lineProgramId: line.id, projectTitle: line.projectTitle, subtitleCode: line.subtitleCode, line: line.line }).onConflictDoNothing()
      ;[bundle] = await tx.select().from(lineSchemeBundles).where(eq(lineSchemeBundles.lineProgramId, data.lineId))
    }
    if (editable) {
      bundle = await lockedBundle(tx, bundle.id)
      if (!bundle.lockExpiresAt || bundle.lockExpiresAt.getTime() <= Date.now() || lease(bundle, actor, data.token).owned) {
        ;[bundle] = await tx.update(lineSchemeBundles).set({ lockUserId: current.id, lockName: current.name, lockToken: data.token, lockExpiresAt: expires() }).where(eq(lineSchemeBundles.id, bundle.id)).returning()
      }
    }
    return { bundle: await readSchemeBundle(tx, bundle.id), lease: lease(bundle, actor, data.token) }
  })
}

export async function updateSchemeLease(data: { bundleId: number; token: string; release?: boolean }) {
  schemeId(data.bundleId); schemeToken(data.token)
  const actor = await requireIdentity(); assertPermission(actor, 'schemes.view')
  return requireDb().transaction(async tx => {
    const current = await actorForWrite(tx, actor, ['schemes.view']), bundle = await lockedBundle(tx, data.bundleId)
    if (bundle.lockUserId === actor.id && bundle.lockToken === data.token) {
      if (data.release || !hasPermission(current, 'schemes.edit') && !hasPermission(current, 'schemes.delete')) {
        await tx.update(lineSchemeBundles).set({ lockUserId: null, lockName: null, lockToken: null, lockExpiresAt: null }).where(eq(lineSchemeBundles.id, bundle.id))
        return { owned: false, name: null, expiresAt: null } as SchemeLease
      }
      // An expired lease must be reacquired explicitly, never silently revived.
      if (lease(bundle, current, data.token).owned) {
        const deadline = expires(); await tx.update(lineSchemeBundles).set({ lockExpiresAt: deadline }).where(eq(lineSchemeBundles.id, bundle.id))
        return { owned: true, name: current.name, expiresAt: deadline.toISOString() } as SchemeLease
      }
    }
    return lease(bundle, current, data.token)
  })
}

export async function schemeMutation<T extends Record<string, unknown>>(data: SchemeWriteRequest, permission: Permission, operation: string, payload: unknown,
  run: (tx: Tx, bundle: Bundle, actor: AccessIdentity) => Promise<T>, lockTopology = false) {
  validateSchemeWrite(data)
  const actor = await requireIdentity(), hash = createHash('sha256').update(JSON.stringify({ operation, payload })).digest('hex')
  return requireDb().transaction(async tx => {
    const current = await actorForWrite(tx, actor, ['schemes.view', permission])
    if (lockTopology) {
      // Same order as journal/line deletion: access → line → bundle. The
      // initial placement must not miss a concurrently created continuation.
      const [snapshot] = await tx.select({ line: linePrograms }).from(lineSchemeBundles).innerJoin(linePrograms, eq(linePrograms.id, lineSchemeBundles.lineProgramId)).where(eq(lineSchemeBundles.id, data.bundleId))
      if (snapshot) {
        await lockWeldLineMemberships(tx, [snapshot.line])
        const [latest] = await tx.select().from(linePrograms).where(eq(linePrograms.id, snapshot.line.id))
        if (!latest || latest.projectTitle !== snapshot.line.projectTitle || latest.subtitleCode !== snapshot.line.subtitleCode || latest.line !== snapshot.line.line) throw new Error('Линия изменилась во время сохранения. Повторите операцию.')
      }
    }
    const bundle = await lockedBundle(tx, data.bundleId)
    const [receipt] = await tx.select().from(lineSchemeReceipts).where(eq(lineSchemeReceipts.id, data.operationId))
    if (receipt) {
      if (receipt.bundleId !== bundle.id || receipt.userId !== actor.id || receipt.payloadHash !== hash) throw new Error('Идентификатор операции уже использован для других изменений.')
      return receipt.result as T
    }
    requireLease(bundle, current, data.token)
    if (bundle.version !== data.version) throw new Error('Состав редакций изменился. Обновите схему перед сохранением; несохранённые точки остаются в этом окне.')
    const result = await run(tx, bundle, current)
    await tx.insert(lineSchemeReceipts).values({ id: data.operationId, bundleId: bundle.id, userId: actor.id, payloadHash: hash, result })
    return result
  })
}

export async function saveSchemePoints(data: SchemeWriteRequest & { revisionId: string; revisionVersion: number; changes: SchemeChanges }) {
  schemeToken(data.revisionId); schemeId(data.revisionVersion); validateSchemeChanges(data.changes)
  return schemeMutation(data, 'schemes.edit', 'points', { revisionId: data.revisionId, revisionVersion: data.revisionVersion, changes: data.changes }, async (tx, bundle) => {
    const [line] = await tx.select({ id: linePrograms.id }).from(linePrograms).where(eq(linePrograms.id, bundle.lineProgramId))
    if (!line) throw new Error('Линия удалена. Доступны просмотр и удаление PDF.')
    const [revision] = await tx.select().from(lineSchemeRevisions).where(and(eq(lineSchemeRevisions.id, data.revisionId), eq(lineSchemeRevisions.bundleId, bundle.id))).for('update')
    if (!revision || bundle.activeRevisionId !== revision.id) throw new Error('Изменять точки можно только в основной редакции.')
    if (revision.version !== data.revisionVersion) throw new Error('Разметка уже изменена. Обновите схему; ваши несохранённые изменения сохранены в окне.')
    validateSchemeChanges(data.changes, revision.pageCount)
    const ids = [...data.changes.upsert.map(point => point.id), ...data.changes.remove]
    const existing = ids.length ? await tx.select().from(lineSchemePoints).where(sql`${lineSchemePoints.id} = any(${sql.param(ids)}::text[])`) : []
    if (existing.some(point => point.revisionId !== revision.id)) throw new Error('Точка относится к другой редакции.')
    const byId = new Map(existing.map(point => [point.id, point]))
    const additions = data.changes.upsert.filter(point => !byId.has(point.id))
    const topology = additions.length ? await readSchemeTopology(tx, [bundle.lineProgramId]) : null
    const groups = topology?.groups.get(bundle.lineProgramId) ?? []
    const groupsByRoot = new Map(groups.map(group => [group.rootId, group])), groupsByPhysical = new Map(groups.filter(group => group.physicalId).map(group => [group.physicalId!, group]))
    const additionGroups = new Map<string, (typeof groups)[number]>()
    for (const point of additions) {
      const group = point.physicalId ? groupsByPhysical.get(point.physicalId) : groupsByRoot.get(point.rootId ?? -1)
      if (!group || group.inactive || group.issue || !group.representative) throw new Error('Новый стык больше не доступен для размещения. Обновите состояния.')
      additionGroups.set(point.id, group)
    }
    const identities = await ensureSchemePhysicals(tx, [...additionGroups.values()], bundle.lineProgramId)
    const writes: (typeof lineSchemePoints.$inferInsert)[] = []
    for (const point of data.changes.upsert) {
      const prior = byId.get(point.id)
      let physicalId = prior?.physicalId
      if (prior && point.physicalId !== undefined && point.physicalId !== prior.physicalId) throw new Error('Нельзя перепривязать существующую точку к другому стыку.')
      if (!physicalId) {
        physicalId = identities.get(additionGroups.get(point.id)!.key)!
      }
      writes.push({ id: point.id, revisionId: revision.id, physicalId, page: point.page, x: point.x, y: point.y })
    }
    const physicalIds = writes.map(point => point.physicalId)
    if (new Set(physicalIds).size !== physicalIds.length) throw new Error('Один физический стык можно нанести только один раз в редакции.')
    const occupied = physicalIds.length ? await tx.select().from(lineSchemePoints).where(and(eq(lineSchemePoints.revisionId, revision.id), buildNumberArrayMatch(lineSchemePoints.physicalId, physicalIds))) : []
    const removed = new Set(data.changes.remove)
    if (occupied.some(point => !removed.has(point.id) && !byId.has(point.id))) throw new Error('Этот физический стык уже размещён в данной редакции, возможно на другом листе.')
    if (data.changes.remove.length) await tx.delete(lineSchemePoints).where(and(eq(lineSchemePoints.revisionId, revision.id), sql`${lineSchemePoints.id} = any(${sql.param(data.changes.remove)}::text[])`))
    for (let offset = 0; offset < writes.length; offset += 1000) {
      const batch = writes.slice(offset, offset + 1000)
      const saved = await tx.insert(lineSchemePoints).values(batch).onConflictDoUpdate({ target: lineSchemePoints.id,
        set: { page: sql`excluded.page`, x: sql`excluded.x`, y: sql`excluded.y` },
        setWhere: and(eq(lineSchemePoints.revisionId, revision.id), sql`${lineSchemePoints.physicalId} = excluded.physical_id`),
      }).returning({ id: lineSchemePoints.id })
      if (saved.length !== batch.length) throw new Error('Идентификатор точки уже занят другой разметкой. Изменения не сохранены.')
    }
    const movedAnnotations = await saveSchemeAnnotations(tx, revision.id, data.changes.annotations)
    await saveSchemeDimensions(tx, revision.id, data.changes.dimensions, data.changes.upsert.filter(point => byId.has(point.id) && byId.get(point.id)!.page !== point.page).map(point => point.id), movedAnnotations)
    const [next] = await tx.update(lineSchemeRevisions).set({ version: revision.version + 1 }).where(eq(lineSchemeRevisions.id, revision.id)).returning({ version: lineSchemeRevisions.version })
    return { revisionVersion: next.version, points: writes.map(point => ({ id: point.id, physicalId: point.physicalId })), operationId: data.operationId }
  }, data.changes.upsert.some(point => point.rootId !== undefined || point.physicalId !== undefined))
}

export async function updateSchemeRevisionNumber(data: SchemeWriteRequest & { revisionId: string; changeNumber: string | null }) {
  schemeToken(data.revisionId)
  const changeNumber = schemeChangeNumber(data.changeNumber)
  return schemeMutation(data, 'schemes.edit', 'revision-number', { revisionId: data.revisionId, changeNumber }, async (tx, bundle) => {
    const [line] = await tx.select({ id: linePrograms.id }).from(linePrograms).where(eq(linePrograms.id, bundle.lineProgramId))
    if (!line) throw new Error('Линия удалена. Доступны просмотр и удаление PDF.')
    const [revision] = await tx.update(lineSchemeRevisions).set({ changeNumber }).where(and(eq(lineSchemeRevisions.id, data.revisionId), eq(lineSchemeRevisions.bundleId, bundle.id))).returning({ id: lineSchemeRevisions.id })
    if (!revision) throw new Error('Редакция больше не существует.')
    await tx.update(lineSchemeBundles).set({ version: bundle.version + 1 }).where(eq(lineSchemeBundles.id, bundle.id))
    return { version: bundle.version + 1 }
  })
}

export async function changeSchemeRevision(data: SchemeWriteRequest & { revisionId: string; action: 'activate' | 'delete' }) {
  schemeToken(data.revisionId)
  if (!['activate', 'delete'].includes(data.action)) throw new Error('Недопустимое действие с редакцией.')
  const result = await schemeMutation(data, data.action === 'delete' ? 'schemes.delete' : 'schemes.edit', data.action, { revisionId: data.revisionId }, async (tx, bundle) => {
    const [revision] = await tx.select().from(lineSchemeRevisions).where(and(eq(lineSchemeRevisions.id, data.revisionId), eq(lineSchemeRevisions.bundleId, bundle.id)))
    if (!revision) throw new Error('Редакция уже удалена.')
    if (data.action === 'activate') {
      const [line] = await tx.select({ id: linePrograms.id }).from(linePrograms).where(eq(linePrograms.id, bundle.lineProgramId))
      if (!line) throw new Error('Линия удалена. Доступны просмотр и удаление PDF.')
    }
    if (data.action === 'delete') {
      await tx.delete(lineSchemeRevisions).where(eq(lineSchemeRevisions.id, revision.id))
      await tx.update(lineSchemeFiles).set({ state: 'deleting', expiresAt: null }).where(eq(lineSchemeFiles.key, revision.fileKey))
    }
    await tx.update(lineSchemeBundles).set({ version: bundle.version + 1, activeRevisionId: data.action === 'activate' ? revision.id : bundle.activeRevisionId === revision.id ? null : bundle.activeRevisionId }).where(eq(lineSchemeBundles.id, bundle.id))
    return { version: bundle.version + 1 }
  })
  await cleanupSchemeFiles().catch(error => console.error('Scheme file cleanup remains pending:', error))
  return result
}

export async function cleanupSchemeFiles() {
  // Each mutation can pick up its newly orphaned key. Database leases prevent
  // simultaneous callers/processes from sending duplicate storage deletes.
  await cleanupSchemeFilesInStore(requireDb(), await getSchemeFileStore())
}

export async function prepareSchemeUpload(data: SchemeWriteRequest & { replace: 'archive' | 'delete' }) {
  validateSchemeWrite(data)
  const actor = await requireIdentity()
  return requireDb().transaction(async tx => {
    const permissions: Permission[] = ['schemes.view', 'schemes.edit']
    if (data.replace === 'delete') permissions.push('schemes.delete')
    const current = await actorForWrite(tx, actor, permissions), bundle = await lockedBundle(tx, data.bundleId)
    requireLease(bundle, current, data.token)
    const [receipt] = await tx.select().from(lineSchemeReceipts).where(eq(lineSchemeReceipts.id, data.operationId))
    if (!receipt && bundle.version !== data.version) throw new Error('Состав редакций изменился. Обновите схему перед загрузкой.')
    const key = `${randomUUID()}.pdf`
    await tx.insert(lineSchemeFiles).values({ key, state: 'staging', expiresAt: new Date(Date.now() + 15 * 60_000) })
    return key
  })
}

export async function publishSchemeFile(data: SchemeWriteRequest & { fileKey: string; fileName: string; changeNumber?: string | null; size: number; digest: string; pageCount: number; replace: 'archive' | 'delete' }) {
  const changeNumber = schemeChangeNumber(data.changeNumber)
  return schemeMutation(data, 'schemes.edit', 'upload', { fileName: data.fileName, size: data.size, digest: data.digest, replace: data.replace, ...(changeNumber ? { changeNumber } : {}) }, async (tx, bundle, actor) => {
    if (data.replace === 'delete') assertPermission(actor, 'schemes.delete')
    const [line] = await tx.select({ id: linePrograms.id }).from(linePrograms).where(eq(linePrograms.id, bundle.lineProgramId))
    if (!line) throw new Error('Линия удалена. Загрузка нового чертежа недоступна.')
    const [file] = await tx.select().from(lineSchemeFiles).where(eq(lineSchemeFiles.key, data.fileKey)).for('update')
    if (!file || file.state !== 'staging' || !file.expiresAt || file.expiresAt.getTime() <= Date.now()) throw new Error('Временная загрузка истекла. Загрузите файл заново.')
    const id = randomUUID()
    await tx.insert(lineSchemeRevisions).values({ id, bundleId: bundle.id, fileKey: data.fileKey, fileName: data.fileName, changeNumber, size: data.size, pageCount: data.pageCount, authorId: actor.id, authorName: actor.name })
    await tx.update(lineSchemeFiles).set({ state: 'ready', expiresAt: null }).where(eq(lineSchemeFiles.key, data.fileKey))
    if (data.replace === 'delete' && bundle.activeRevisionId) {
      const [old] = await tx.select().from(lineSchemeRevisions).where(eq(lineSchemeRevisions.id, bundle.activeRevisionId))
      if (old) { await tx.delete(lineSchemeRevisions).where(eq(lineSchemeRevisions.id, old.id)); await tx.update(lineSchemeFiles).set({ state: 'deleting' }).where(eq(lineSchemeFiles.key, old.fileKey)) }
    }
    await tx.update(lineSchemeBundles).set({ activeRevisionId: id, version: bundle.version + 1 }).where(eq(lineSchemeBundles.id, bundle.id))
    return { revisionId: id, version: bundle.version + 1 }
  })
}
