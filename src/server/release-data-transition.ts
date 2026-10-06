import { eq, sql } from 'drizzle-orm'
import { appSettings } from '@/db/schema'
import { DATA_RELEASE_KEY, DATA_RELEASE_VALUE, REQUIRED_SCHEMA_TIME, isCompletedTransition } from '@/lib/release-contract'
import { backfillAcceptedWarningObjects } from './accepted-warning-backfill'
import { LINE_PROGRAM_TRANSITION_KEY, transitionLinePrograms } from './line-program-transition'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** Caller owns ONE transaction for both transitions and the readiness marker. */
export async function prepareReleaseData(tx: SystemDocumentSequenceTransaction) {
  await tx.execute(sql`set local lock_timeout = '15s'`)
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${DATA_RELEASE_KEY}))`)
  // Check legacy completion under the same lock used by transition/restore.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LINE_PROGRAM_TRANSITION_KEY}))`)
  const schema = await tx.execute(sql`select 1 from drizzle.__drizzle_migrations where created_at = ${REQUIRED_SCHEMA_TIME}`)
  if (!schema.rows.length) throw new Error('Сначала примените все миграции текущей версии.')
  const [marker] = await tx.select().from(appSettings).where(eq(appSettings.key, DATA_RELEASE_KEY)).limit(1)
  const [transitionMarker] = await tx.select().from(appSettings).where(eq(appSettings.key, LINE_PROGRAM_TRANSITION_KEY)).limit(1)
  if (transitionMarker && !isCompletedTransition(transitionMarker.value)) {
    throw new Error('Прежний переход восстановлен или имеет неизвестное состояние. Выпуск остановлен; требуется разбор, а не повторная очистка.')
  }
  if (marker?.value === DATA_RELEASE_VALUE) {
    if (!transitionMarker) throw new Error('Нет подтверждения перехода программы линий. Выпуск остановлен.')
    return { skipped: true }
  }
  // No application writes are allowed during release. Locks also prevent a
  // late legacy warning/stamp update racing the owner conversion.
  await tx.execute(sql`lock table dispatcher_accepted_warnings, welder_stamps in share row exclusive mode`)
  const transition = await transitionLinePrograms(tx)
  const preview = await backfillAcceptedWarningObjects(tx)
  if (preview.unresolved.length) throw new Error(
    `Неоднозначные принятые исключения: ${preview.unresolved.length}. Оба перехода отменены; рабочие разделы остаются закрыты. Первые ключи: ${JSON.stringify(preview.unresolved.slice(0, 50))}`,
  )
  const warnings = await backfillAcceptedWarningObjects(tx, true)
  await tx.insert(appSettings).values({ key: DATA_RELEASE_KEY, value: DATA_RELEASE_VALUE })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: DATA_RELEASE_VALUE, updatedAt: new Date() } })
  return { skipped: false, transition, warnings }
}
