import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { loadServerEnv } from '../src/server-env.ts'

loadServerEnv()

const useRemoteDatabase = process.argv.includes('--remote')
if (useRemoteDatabase) {
  const remoteUrl = process.env.DATABASE_URL_REMOTE_FOR_MIGRATIONS
  if (!remoteUrl) throw new Error('DATABASE_URL_REMOTE_FOR_MIGRATIONS is not configured')
  process.env.DATABASE_URL = remoteUrl
}

const [{ db }, { appSettings, preHeatTreatmentControls, weldJoints }] = await Promise.all([
  import('../src/db/index.ts'),
  import('../src/db/schema.ts'),
])

const BACKFILL_MARKER_KEY = 'maintenance:lnk-defect-descriptions:v1'
const goodResults = ['годен', 'годен (отменен)']

const result = await db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${BACKFILL_MARKER_KEY}))`)
  const [marker] = await tx
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, BACKFILL_MARKER_KEY))
    .limit(1)
  if (marker?.value === 'complete') return { skipped: true, primaryRows: 0, preControlRows: 0 }

  const vikNeedsBackfill = needsPrimaryBackfill(
    weldJoints.vikResult,
    weldJoints.vikDefectDescription,
  )
  const uzkNeedsBackfill = needsPrimaryBackfill(
    weldJoints.uzkResult,
    weldJoints.uzkDefectDescription,
  )
  const pvkNeedsBackfill = needsPrimaryBackfill(
    weldJoints.pvkResult,
    weldJoints.pvkDefectDescription,
  )
  const updatedPrimaryRows = await tx
    .update(weldJoints)
    .set({
      vikDefectDescription: sql`case when ${vikNeedsBackfill} then 'ДНО' else ${weldJoints.vikDefectDescription} end`,
      uzkDefectDescription: sql`case when ${uzkNeedsBackfill} then 'ДНО' else ${weldJoints.uzkDefectDescription} end`,
      pvkDefectDescription: sql`case when ${pvkNeedsBackfill} then 'ДНО' else ${weldJoints.pvkDefectDescription} end`,
    })
    .where(or(vikNeedsBackfill, uzkNeedsBackfill, pvkNeedsBackfill))
    .returning({ id: weldJoints.id })

  const updatedPreControls = await tx
    .update(preHeatTreatmentControls)
    .set({ defectDescription: 'ДНО' })
    .where(and(
      inArray(preHeatTreatmentControls.method, ['ВИК', 'УЗК', 'ПВК']),
      eq(sql<string>`lower(btrim(coalesce(${preHeatTreatmentControls.result}, '')))`, 'годен'),
      eq(sql<string>`btrim(coalesce(${preHeatTreatmentControls.defectDescription}, ''))`, ''),
    ))
    .returning({ id: preHeatTreatmentControls.id })

  await tx
    .insert(appSettings)
    .values({ key: BACKFILL_MARKER_KEY, value: 'complete' })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: 'complete', updatedAt: new Date() },
    })

  return {
    skipped: false,
    primaryRows: updatedPrimaryRows.length,
    preControlRows: updatedPreControls.length,
  }
})

console.log(JSON.stringify({
  database: useRemoteDatabase ? 'remote' : 'local',
  ...result,
}, null, 2))

function needsPrimaryBackfill(resultColumn: AnyPgColumn, defectColumn: AnyPgColumn) {
  return and(
    inArray(sql<string>`lower(btrim(coalesce(${resultColumn}, '')))`, goodResults),
    eq(sql<string>`btrim(coalesce(${defectColumn}, ''))`, ''),
  )!
}
