import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { requireDb } from '@/db'
import { authUsers } from '@/db/schema'
import type { AccessIdentity, Permission } from '@/lib/access-permissions'
import { assertPermission } from '@/lib/access-permissions'
import { getAuth } from './auth'

import { accessContext } from './access-store'
export { accessContext } from './access-store'
export function toAccessIdentity(user: typeof authUsers.$inferSelect): AccessIdentity {
  return { id: user.id, name: user.name, email: user.email, title: user.title, role: user.role,
    permissions: user.permissions, revision: user.revision }
}
export async function readAccessIdentity(): Promise<AccessIdentity | null> {
  const cached = accessContext.getStore()
  if (cached) return cached.identity
  const session = await getAuth().api.getSession({ headers: getRequestHeaders(), query: { disableCookieCache: true } })
  if (!session) return null
  const [user] = await requireDb().select().from(authUsers).where(eq(authUsers.id, session.user.id))
  if (!user || user.status !== 'active' || !user.emailVerified) return null
  return toAccessIdentity(user)
}
export async function requireIdentity() {
  const identity = await readAccessIdentity()
  if (!identity) throw new Error('AUTH_REQUIRED: Войдите в систему. Сеанс завершён или доступ отозван.')
  return identity
}
export async function requirePermission(permission: Permission) {
  const identity = await requireIdentity()
  assertPermission(identity, permission)
  return identity
}
export function runWithAccess<T>(identity: AccessIdentity, operation: string, permissions: Permission[], run: () => T): T {
  for (const permission of permissions) assertPermission(identity, permission)
  return accessContext.run({ identity, operation, operationId: randomUUID(), permissions,
    area: permissions[0]?.split('.')[0] ?? 'access' }, run)
}
