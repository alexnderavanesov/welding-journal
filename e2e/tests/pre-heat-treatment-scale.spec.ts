import pg from 'pg'
import { test, expect } from '@playwright/test'
import { and, eq, sql } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints, appSettings } from '../../src/db/schema'
import { buildLnkWorkflowRowsWhere, listLnkWorkflowRows } from '../../src/server/lnk-workflow-context'
import { prepareControlProcessSettingsChangeInTransaction } from '../../src/server/control-process-settings'
import { initializePreHeatTreatmentMode } from '../../src/server/pre-heat-treatment-mode-transition'
import { PRE_HEAT_SELECTED_TRANSITION_KEY } from '../../src/lib/release-contract'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'

const project = 'E2E PRE MODE SCALE'
test('200000 rows: candidate pagination stays bounded; retired mode writes preserve explicit choices', async () => {
  test.setTimeout(120_000)
  const db = requireDb()
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.key, 'control-processes'))
  try {
    await withE2eDatabase(async client => {
      await client.query("update app_settings set value=$1 where key='control-processes'", [JSON.stringify({ preHeatTreatmentMode: 'selected', pvkGoodOnly: false })])
      await client.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,has_vik,psto_required,pre_heat_treatment_required)
        select $1,'S','L' || (n/1000)::text,'F' || n::text,'2026-11-01','да','да',n%5<>0 from generate_series(1,200000) n`, [project])
    })
    const started = performance.now()
    const where = and(eq(weldJoints.projectTitle, project), buildLnkWorkflowRowsWhere({ scope: 'preHeatTreatmentRequestCandidates' }))
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(weldJoints).where(where)
    expect(count).toBe(160000)
    const queryCounts: number[] = []
    for (const [offset, limit] of [[0, 25], [1000, 100], [159975, 25]]) {
      const originalQuery = pg.Client.prototype.query
      let queries = 0
      pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) {
        queries++; return (originalQuery as (...args: unknown[]) => unknown).apply(this, args)
      } as typeof originalQuery
      try {
        const rows = await asE2eOwner(listLnkWorkflowRows, 'lnk.view')({ scope: 'preHeatTreatmentRequestCandidates', search: project, offset, limit })
        expect(rows).toHaveLength(limit)
        expect(rows.every(row => row.preHeatTreatmentRequired === true && row.projectTitle === project)).toBe(true)
        queryCounts.push(queries)
      } finally { pg.Client.prototype.query = originalQuery }
    }
    expect(new Set(queryCounts).size).toBe(1)
    const candidatesMs = performance.now() - started
    const transitionStarted = performance.now()
    await db.transaction(async tx => {
      await prepareControlProcessSettingsChangeInTransaction({ tx, currentValue: { preHeatTreatmentMode: 'allPsto' }, nextValue: { preHeatTreatmentMode: 'selected' } })
    })
    const [{ off }] = await db.select({ off: sql<number>`count(*) filter(where pre_heat_treatment_required is false)::int` }).from(weldJoints).where(eq(weldJoints.projectTitle, project))
    expect(off).toBe(40000)
    console.log(JSON.stringify({ preHeatTreatmentScale: 200000, candidatesMs: Math.round(candidatesMs), modeTransitionMs: Math.round(performance.now() - transitionStarted), queryCounts, pageSizes: [25, 100, 25] }))
  } finally {
    await db.delete(weldJoints).where(eq(weldJoints.projectTitle, project))
    if (settings) await db.update(appSettings).set({ value: settings.value }).where(eq(appSettings.key, settings.key))
  }
})

test('release conversion distinguishes legacy default, explicit off and a new database', async () => {
  const db = requireDb(), rollback = new Error('fixture rollback')
  for (const input of [undefined, { preHeatTreatmentLnkEnabled: false }, { preHeatTreatmentLnkEnabled: true }]) {
    await expect(db.transaction(async tx => {
      await tx.delete(appSettings).where(eq(appSettings.key, PRE_HEAT_SELECTED_TRANSITION_KEY))
      await tx.delete(appSettings).where(eq(appSettings.key, 'control-processes'))
      if (input) await tx.insert(appSettings).values({ key: 'control-processes', value: JSON.stringify(input) })
      await tx.insert(weldJoints).values({ projectTitle: project, joint: 'F1', preHeatTreatmentRequired: null })
      expect(await initializePreHeatTreatmentMode(tx)).toMatchObject({ skipped: false, mode: 'selected', previousFullMode: input?.preHeatTreatmentLnkEnabled !== false })
      expect(await initializePreHeatTreatmentMode(tx)).toEqual({ skipped: true })
      throw rollback
    })).rejects.toBe(rollback)
  }
  // Only the isolated E2E database is used; rollback preserves its base fixture.
  await expect(db.transaction(async tx => {
    await tx.delete(appSettings).where(eq(appSettings.key, PRE_HEAT_SELECTED_TRANSITION_KEY))
    await tx.delete(appSettings).where(eq(appSettings.key, 'control-processes'))
    await tx.update(weldJoints).set({ preHeatTreatmentRequired: false })
    expect(await initializePreHeatTreatmentMode(tx)).toMatchObject({ skipped: false, mode: 'selected', previousFullMode: false })
    throw rollback
  })).rejects.toBe(rollback)
})
