import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { generateRandomString } from 'better-auth/crypto'
import { requireDb } from '@/db'
import { authAccounts, authOwner, authRateLimits, authSessions, authUsers, authVerifications } from '@/db/schema'
import { canManageAccount, normalizePermissions, type AccessIdentity, type AccountRole } from '@/lib/access-permissions'
import { createAuth } from './auth'
import { recordAccessEvent, type AuditTransaction } from './audit-record'
import { requireIdentity, toAccessIdentity } from './access-context'
import { sendAccountLink } from './auth-mail'
import { ACCOUNT_ONLINE_WINDOW_MS } from '@/lib/account-activity'

export const ACCESS_WRITE_LOCK = 84192703
export async function lockAccessChanges(tx: AuditTransaction, exclusive = false) {
  await tx.execute(exclusive ? sql`select pg_advisory_xact_lock(${ACCESS_WRITE_LOCK})` : sql`select pg_advisory_xact_lock_shared(${ACCESS_WRITE_LOCK})`)
}
export async function requireCurrentActor(tx: AuditTransaction, actor: AccessIdentity) {
  const [user] = await tx.select().from(authUsers).where(eq(authUsers.id, actor.id))
  if (!user || user.status !== 'active' || !user.emailVerified) throw new Error('AUTH_REQUIRED: Доступ отозван.')
  return toAccessIdentity(user)
}
export function requireAccountName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) throw new Error('Укажите ФИО длиной до 200 символов.')
  return value.trim()
}
export function requireAccountEmail(value: unknown) {
  const email = String(value ?? '').trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Укажите корректный адрес почты.')
  return email
}
export function requireAccountPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 6 || value.length > 128) throw new Error('Пароль должен содержать от 6 до 128 символов.')
  return value
}
function title(value: unknown) { return String(value ?? '').trim().slice(0, 200) }
function assertOnlyKeys(value: object, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Переданы недопустимые поля аккаунта.')
}
async function managedTarget(tx: AuditTransaction, actor: AccessIdentity, id: string, revision: number) {
  const [target] = await tx.select().from(authUsers).where(eq(authUsers.id, id)).for('update')
  if (!target || !canManageAccount(actor, target)) throw new Error('Нельзя управлять этим аккаунтом.')
  const [owner] = await tx.select().from(authOwner).where(eq(authOwner.userId, id))
  if (owner) throw new Error('Аккаунт владельца защищён.')
  if (target.revision !== revision) throw new Error('Аккаунт уже изменён. Обновите список и повторите действие.')
  return target
}
function requireAdministrator(actor: AccessIdentity) {
  if (actor.role !== 'owner' && actor.role !== 'admin') throw new Error('Требуются права администратора.')
}
export async function accountRateLimit(key: string, max = 10) {
  // One atomic statement; shared by all server processes, never one query per row.
  const now = Date.now(), windowMs = 60000
  const [entry] = await requireDb().insert(authRateLimits).values({ id: randomUUID(), key, count: 1, lastRequest: now })
    .onConflictDoUpdate({ target: authRateLimits.key, set: {
      count: sql`case when ${authRateLimits.lastRequest} < ${now - windowMs} then 1 else ${authRateLimits.count} + 1 end`,
      lastRequest: sql`case when ${authRateLimits.lastRequest} < ${now - windowMs} then ${now} else ${authRateLimits.lastRequest} end`,
    } }).returning({ count: authRateLimits.count })
  if (entry.count > max) throw new Error('Слишком много попыток. Повторите через минуту.')
}
async function issueLink(tx: AuditTransaction, user: typeof authUsers.$inferSelect, kind: 'invite' | 'recovery') {
  const token = generateRandomString(48)
  const generation = user.tokenGeneration + 1
  const expiresAt = new Date(Date.now() + (kind === 'invite' ? 48 : 1) * 3600000)
  await tx.delete(authVerifications).where(sql`split_part(${authVerifications.value}, ':', 2) = ${user.id}`)
  const context = await createAuth(tx as unknown as ReturnType<typeof requireDb>).$context
  await context.internalAdapter.createVerificationValue({ identifier: `account-link:${token}`, value: `${kind}:${user.id}:${generation}`, expiresAt })
  await tx.update(authUsers).set({ tokenGeneration: generation, revision: user.revision + 1, linkExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(authUsers.id, user.id))
  return { token, email: user.email, kind }
}
async function deliver(link: Awaited<ReturnType<typeof issueLink>>) {
  try { await sendAccountLink(link.email, link.token, link.kind); return { sent: true } }
  catch { return { sent: false, message: 'Аккаунт сохранён, но письмо не доставлено. Проверьте почтовое подключение и отправьте новую ссылку.' } }
}
export async function listAccounts() {
  const actor = await requireIdentity(); requireAdministrator(actor)
  return requireDb().select({ id: authUsers.id, name: authUsers.name, email: authUsers.email, title: authUsers.title,
    role: authUsers.role, status: authUsers.status, permissions: authUsers.permissions, revision: authUsers.revision,
    linkExpiresAt: authUsers.linkExpiresAt, lastActiveAt: authUsers.lastActiveAt,
    // Keep the outer ID qualified: Drizzle unqualifies Column objects in single-table selections.
    online: sql<boolean>`${authUsers.status} = 'active' and ${authUsers.emailVerified} and exists (
      select 1 from ${authSessions} where ${authSessions.userId} = ${authUsers}.${sql.identifier(authUsers.id.name)}
      and ${authSessions.expiresAt} > now()
      and ${authSessions.lastActiveAt} > now() - ${ACCOUNT_ONLINE_WINDOW_MS} * interval '1 millisecond'
    )`,
  }).from(authUsers).orderBy(authUsers.name, authUsers.id)
}
export async function inviteAccount(input: { name: string; email: string; title: string; role: 'admin' | 'user'; permissions: unknown }) {
  assertOnlyKeys(input, ['name', 'email', 'title', 'role', 'permissions'])
  const actor = await requireIdentity(); requireAdministrator(actor)
  await accountRateLimit(`invite:${actor.id}`)
  const name = requireAccountName(input.name), email = requireAccountEmail(input.email), permissions = normalizePermissions(input.permissions)
  const link = await requireDb().transaction(async tx => {
    await lockAccessChanges(tx, true)
    const current = await requireCurrentActor(tx, actor); requireAdministrator(current)
    if (input.role !== 'user' && (input.role !== 'admin' || current.role !== 'owner')) throw new Error('Только владелец назначает администраторов.')
    const [exists] = await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, email))
    if (exists) throw new Error('Этот адрес уже используется. Для ожидающего аккаунта отправьте приглашение повторно.')
    const [user] = await tx.insert(authUsers).values({ id: randomUUID(), name, email, title: title(input.title), role: input.role, permissions }).returning()
    await recordAccessEvent(tx, current, 'account.invite', user.id, user.name, { role: { after: user.role }, permissions: { after: permissions } })
    return issueLink(tx, user, 'invite')
  })
  return deliver(link)
}
export async function changeAccount(input: { id: string; revision: number; role: 'admin' | 'user'; permissions: unknown; title?: string }) {
  assertOnlyKeys(input, ['id', 'revision', 'role', 'permissions', 'title'])
  const actor = await requireIdentity(), permissions = normalizePermissions(input.permissions)
  await requireDb().transaction(async tx => {
    await lockAccessChanges(tx, true)
    const current = await requireCurrentActor(tx, actor)
    const target = await managedTarget(tx, current, input.id, input.revision)
    if (input.role !== 'user' && (input.role !== 'admin' || current.role !== 'owner')) throw new Error('Только владелец назначает администраторов.')
    const nextTitle = input.title === undefined ? target.title : title(input.title)
    if (target.role === input.role && target.title === nextTitle && JSON.stringify([...target.permissions].sort()) === JSON.stringify(permissions)) return
    await tx.update(authUsers).set({ role: input.role, permissions, title: nextTitle, revision: target.revision + 1, updatedAt: new Date() }).where(eq(authUsers.id, target.id))
    await recordAccessEvent(tx, current, 'account.permissions', target.id, target.name, {
      role: { before: target.role, after: input.role }, permissions: { before: target.permissions, after: permissions },
      ...(target.title !== nextTitle ? { title: { before: target.title, after: nextTitle } } : {}),
    })
  })
  return { ok: true }
}
export async function sendManagedLink(input: { id: string; revision: number; kind: 'invite' | 'recovery' }) {
  assertOnlyKeys(input, ['id', 'revision', 'kind'])
  const actor = await requireIdentity(); requireAdministrator(actor)
  await accountRateLimit(`link:${actor.id}`)
  const link = await requireDb().transaction(async tx => {
    await lockAccessChanges(tx, true)
    const current = await requireCurrentActor(tx, actor)
    const target = await managedTarget(tx, current, input.id, input.revision)
    if (input.kind !== (target.status === 'pending' ? 'invite' : 'recovery')) throw new Error('Неверный вид ссылки.')
    await recordAccessEvent(tx, current, `account.${input.kind}.requested`, target.id, target.name)
    return issueLink(tx, target, input.kind)
  })
  return deliver(link)
}
export async function deleteAccount(input: { id: string; revision: number; confirmed: boolean }) {
  assertOnlyKeys(input, ['id', 'revision', 'confirmed'])
  if (input.confirmed !== true) throw new Error('Подтвердите удаление аккаунта.')
  const actor = await requireIdentity()
  await requireDb().transaction(async tx => {
    await lockAccessChanges(tx, true)
    const current = await requireCurrentActor(tx, actor)
    const target = await managedTarget(tx, current, input.id, input.revision)
    await recordAccessEvent(tx, current, 'account.delete', target.id, target.name)
    await tx.delete(authVerifications).where(sql`split_part(${authVerifications.value}, ':', 2) = ${target.id}`)
    await tx.delete(authUsers).where(eq(authUsers.id, target.id))
  })
  return { ok: true }
}
export async function completeAccountLink(input: { token: string; kind: 'invite' | 'recovery'; password: string }) {
  assertOnlyKeys(input, ['token', 'kind', 'password'])
  const password = requireAccountPassword(input.password)
  if (!/^[A-Za-z0-9_-]{48}$/.test(input.token) || !['invite', 'recovery'].includes(input.kind)) throw new Error('Ссылка недействительна.')
  const { getRequestIP } = await import('@tanstack/react-start/server')
  let ip = 'operator'
  try { ip = getRequestIP({ xForwardedFor: process.env.AUTH_TRUST_PROXY === 'true' }) ?? 'unknown' } catch { /* Explicit local verification has no HTTP context. */ }
  await accountRateLimit(`complete:${ip}`)
  const { hashPassword } = await import('better-auth/crypto')
  const hash = await hashPassword(password)
  await requireDb().transaction(async tx => {
    await lockAccessChanges(tx, true)
    const context = await createAuth(tx as unknown as ReturnType<typeof requireDb>).$context
    const verification = await context.internalAdapter.consumeVerificationValue(`account-link:${input.token}`)
    if (!verification) throw new Error('Ссылка истекла, отозвана или уже использована.')
    const [kind, id, generation] = verification.value.split(':')
    const [user] = await tx.select().from(authUsers).where(eq(authUsers.id, id)).for('update')
    if (!user || kind !== input.kind || user.tokenGeneration !== Number(generation) ||
      (kind === 'invite') !== (user.status === 'pending')) throw new Error('Ссылка недействительна.')
    await tx.delete(authSessions).where(eq(authSessions.userId, id))
    await tx.insert(authAccounts).values({ id: randomUUID(), accountId: id, providerId: 'credential', userId: id, password: hash })
      .onConflictDoUpdate({ target: [authAccounts.providerId, authAccounts.accountId], set: { password: hash, updatedAt: new Date() } })
    await tx.update(authUsers).set({ emailVerified: true, status: 'active', tokenGeneration: user.tokenGeneration + 1,
      linkExpiresAt: null, revision: user.revision + 1, updatedAt: new Date() }).where(eq(authUsers.id, id))
    await recordAccessEvent(tx, user, kind === 'invite' ? 'account.activated' : 'account.recovered', id, user.name)
  })
  return { ok: true }
}
export async function updateOwnProfile(input: { name: string; title: string; revision: number }) {
  assertOnlyKeys(input, ['name', 'title', 'revision'])
  const actor = await requireIdentity(), name = requireAccountName(input.name)
  await requireDb().transaction(async tx => {
    await lockAccessChanges(tx, true)
    const current = await requireCurrentActor(tx, actor)
    if (current.revision !== input.revision) throw new Error('Профиль уже изменён. Обновите его и повторите.')
    if (current.role === 'user' && current.title !== title(input.title)) throw new Error('Должность меняет администратор.')
    if (current.name === name && current.title === title(input.title)) return
    await tx.update(authUsers).set({ name, title: title(input.title), revision: current.revision + 1, updatedAt: new Date() }).where(eq(authUsers.id, current.id))
    await recordAccessEvent(tx, current, 'account.profile', current.id, name, { name: { before: current.name, after: name }, title: { before: current.title, after: title(input.title) } })
  })
  return { ok: true }
}
export async function changeOwnPassword(input: { currentPassword: string; password: string }) {
  assertOnlyKeys(input, ['currentPassword', 'password'])
  const actor = await requireIdentity(); await accountRateLimit(`password:${actor.id}`, 8)
  const password = requireAccountPassword(input.password)
  const { hashPassword, verifyPassword } = await import('better-auth/crypto')
  await requireDb().transaction(async tx => {
    await lockAccessChanges(tx, true)
    const current = await requireCurrentActor(tx, actor)
    const [account] = await tx.select().from(authAccounts).where(and(eq(authAccounts.userId, current.id), eq(authAccounts.providerId, 'credential')))
    if (!account?.password || !await verifyPassword({ password: String(input.currentPassword), hash: account.password })) throw new Error('Текущий пароль не подходит.')
    await tx.update(authAccounts).set({ password: await hashPassword(password), updatedAt: new Date() }).where(eq(authAccounts.id, account.id))
    await tx.delete(authSessions).where(eq(authSessions.userId, current.id))
    await tx.delete(authVerifications).where(sql`split_part(${authVerifications.value}, ':', 2) = ${current.id}`)
    await recordAccessEvent(tx, current, 'account.password.changed', current.id, current.name)
  })
  return { ok: true }
}
/** Called by an explicit operator command, never by a web request or page load. */
export async function bootstrapOwner(input: { name: string; email: string; title: string }) {
  const name = requireAccountName(input.name), email = requireAccountEmail(input.email)
  const link = await requireDb().transaction(async tx => {
    await lockAccessChanges(tx, true)
    const [owner] = await tx.select().from(authOwner).limit(1)
    if (owner) {
      const [user] = await tx.select().from(authUsers).where(eq(authUsers.id, owner.userId))
      if (!user || user.email !== email) throw new Error('Владелец уже назначен другому аккаунту.')
      if (user.status === 'active') return null
      return issueLink(tx, user, 'invite')
    }
    const [user] = await tx.insert(authUsers).values({ id: randomUUID(), name, email, title: title(input.title), role: 'owner' }).returning()
    await tx.insert(authOwner).values({ singleton: 1, userId: user.id })
    await recordAccessEvent(tx, null, 'account.owner.prepared', user.id, user.name)
    return issueLink(tx, user, 'invite')
  })
  return link ? deliver(link) : { sent: false, message: 'Владелец уже активирован; аккаунт и пароль сохранены.' }
}

/** Operator-only recovery; deliberately absent from all public route/RPC exports. */
export async function recoverOwner() {
  const link = await requireDb().transaction(async tx => {
    await lockAccessChanges(tx, true)
    const [owner] = await tx.select().from(authOwner).limit(1)
    if (!owner) throw new Error('Владелец ещё не подготовлен.')
    const [user] = await tx.select().from(authUsers).where(eq(authUsers.id, owner.userId)).for('update')
    if (!user || user.status !== 'active') throw new Error('Завершите активацию приглашения владельца.')
    await recordAccessEvent(tx, null, 'account.owner.recovery', user.id, user.name)
    return issueLink(tx, user, 'recovery')
  })
  return deliver(link)
}
