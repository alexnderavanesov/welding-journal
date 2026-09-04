import { sql, type SQL } from 'drizzle-orm'

type WelderStampRegistryLockExecutor = {
  execute: (query: SQL) => PromiseLike<unknown>
}

const WELDER_STAMP_REGISTRY_LOCK_KEY = 'welder_stamp_registry'

export async function lockWelderStampRegistry(
  executor: WelderStampRegistryLockExecutor,
  mode: 'shared' | 'exclusive' = 'shared',
) {
  await executor.execute(mode === 'exclusive'
    ? sql`select pg_advisory_xact_lock(hashtext(${WELDER_STAMP_REGISTRY_LOCK_KEY}))`
    : sql`select pg_advisory_xact_lock_shared(hashtext(${WELDER_STAMP_REGISTRY_LOCK_KEY}))`)
}
