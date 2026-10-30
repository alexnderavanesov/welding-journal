import { and, eq, gt } from 'drizzle-orm'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { requireDb } from '@/db'
import { authSessions, authUsers } from '@/db/schema'
import { ACCOUNT_ACTIVITY_REFRESH_MS } from '@/lib/account-activity'
import { getAuth } from './auth'
import { toAccessIdentity } from './access-context'

/** Own session only: neither user/session IDs nor timestamps come from the client. */
export async function refreshAccountActivity() {
  const current = await getAuth().api.getSession({ headers: getRequestHeaders(), query: { disableCookieCache: true } })
  if (!current) return null
  return requireDb().transaction(async tx => {
    // Same lock order as password changes/deletion: user first, then sessions.
    const [user] = await tx.select().from(authUsers).where(eq(authUsers.id, current.user.id)).for('update')
    if (!user || user.status !== 'active' || !user.emailVerified) return null
    const now = new Date()
    const [session] = await tx.select().from(authSessions).where(and(
      eq(authSessions.id, current.session.id), eq(authSessions.userId, user.id), gt(authSessions.expiresAt, now),
    )).for('update')
    if (!session) return null
    const stale = (time: Date | null) => !time || now.getTime() - time.getTime() >= ACCOUNT_ACTIVITY_REFRESH_MS
    if (stale(session.lastActiveAt)) await tx.update(authSessions).set({ lastActiveAt: now }).where(eq(authSessions.id, session.id))
    if (stale(user.lastActiveAt)) await tx.update(authUsers).set({ lastActiveAt: now }).where(eq(authUsers.id, user.id))
    // Presence does not change access revisions, profile timestamps or the audit journal.
    return toAccessIdentity(user)
  })
}
