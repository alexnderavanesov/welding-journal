import { eq } from 'drizzle-orm'
import { requireDb } from '../src/db'
import { authOwner, authUsers } from '../src/db/schema'
import { runWithAccess, toAccessIdentity } from '../src/server/access-context'
import type { Permission } from '../src/lib/access-permissions'
import { assertSafeE2eDatabaseUrl } from './database'
/** Direct domain integration tests have no HTTP request; give only their action
 * the real seeded owner's context. Fixture setup/cleanup stays outside it. */
export function asE2eOwner<Args extends unknown[], Result>(action: (...args: Args) => Promise<Result>, permission: Permission) {
  return async (...args: Args): Promise<Result> => {
    assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
    const [record] = await requireDb().select({ user: authUsers }).from(authUsers).innerJoin(authOwner, eq(authUsers.id, authOwner.userId))
    if (!record || record.user.status !== 'active') throw new Error('E2E owner must be activated by the fixture runner.')
    return runWithAccess(toAccessIdentity(record.user), action.name, [permission], () => action(...args))
  }
}
