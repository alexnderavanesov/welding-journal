import { expect, test } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import * as schema from '../../src/db/schema'
import type { WeldRow } from '../../src/lib/dispatcher-types'
import { applyPstoCycleCorrection } from '../../src/lib/psto-cycle-corrections'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '../../src/lib/save-check-settings'
import { assertCurrentInteractiveWeldRowVersions } from '../../src/lib/weld-row-version'
import { WorkflowConflictError } from '../../src/lib/workflow-conflict'
import { assertSafeE2eDatabaseUrl, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

type StoredProbe = {
  version: string
  updated_at: string
  parent_content: string
  repeat_content: string
  final_status: string | null
}

async function snapshot(client: Client, id: number) {
  // Hash PostgreSQL's persisted JSON text, not a redacted/hydrated DTO or JS
  // Date/number conversion. Exclude ONLY the calculated final_status field.
  const { rows: [row] } = await client.query<StoredProbe>(`select
    w.xmin::text as version, w.updated_at::text as updated_at, w.final_status,
    (to_jsonb(w) - 'final_status')::text as parent_content,
    coalesce((select jsonb_agg(to_jsonb(c) order by c.sequence,c.id)
      from psto_repeat_cycles c where c.weld_joint_id=w.id), '[]'::jsonb)::text as repeat_content
    from weld_joints w where w.id=$1`, [id])
  if (!row) throw new Error('Probe fixture disappeared')
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  return {
    ...row,
    parentFingerprint: hash(row.parent_content),
    parentAndRepeatsFingerprint: hash(JSON.stringify([row.parent_content, row.repeat_content])),
  }
}

function expectOldVersionRejected(id: number, before: StoredProbe, after: StoredProbe) {
  expect(after.version).not.toBe(before.version)
  let conflict: unknown
  try {
    assertCurrentInteractiveWeldRowVersions({
      targetIds: [id], expectedVersions: [{ id, version: before.version }],
      currentVersions: [{ id, version: after.version, line: 'TOKEN', joint: 'S1' }],
    })
  } catch (error) { conflict = error }
  expect(conflict).toBeInstanceOf(WorkflowConflictError)
  expect((conflict as WorkflowConflictError).code).toBe('ROW_VERSION_STALE')
}

// Diagnostic candidate comparison, NOT an acceptance test for early editing.
// A deliberately identical clock value exercises a possible token collision;
// it is not a measurement of its frequency in ordinary application use.
test('parent-only fingerprints distinguish status publication but miss a controlled repeat-cycle change', async ({}, info) => {
  test.skip(process.env.DISPATCHER_EDIT_TOKEN_PROBE !== '1', 'Explicit isolated token-design probe')
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  const { persistCalculatedFinalStatuses } = await import('../../src/server/final-status-persistence')
  const { persistPstoCycleCorrection } = await import('../../src/server/psto-cycle-state')
  const projectTitle = `Dispatcher edit token probe ${randomUUID()}`
  const initialNow = new Date('2026-11-14T06:30:00.123Z')
  const ordinaryNow = new Date('2026-11-14T06:30:01.123Z')
  const repeatNow = new Date('2026-11-14T06:30:02.123Z')
  try {
    const id = await withLineProgramFixture(async client => {
      const db = drizzle(client, { schema })
      const [row] = await db.insert(schema.weldJoints).values({
        projectTitle, subtitleCode: 'VERSION', line: 'TOKEN', joint: 'S1',
        weldDate: '2026-08-01', pstoRequired: 'да', preHeatTreatmentRequired: false,
        pstoRequest: 'Primary PSTO', pstoRequestDate: '2026-08-02',
        pstoDate: '2026-08-03', pstoResult: 'проведено', heatTreatmentDiagram: 'Primary diagram',
        tvmtRequest: 'Primary TVMT', tvmtRequestDate: '2026-08-04',
        tvmtResult: 'не годен', tvmtConclusion: 'Primary conclusion', tvmtConclusionDate: '2026-08-05',
        finalStatus: 'ожидает НК', createdAt: initialNow, updatedAt: initialNow,
        pstoCreatedAt: initialNow, pstoUpdatedAt: initialNow,
      }).returning({ id: schema.weldJoints.id })
      await db.insert(schema.pstoRepeatCycles).values({
        weldJointId: row.id, sequence: 2, pstoRequest: 'Repeat original',
        pstoRequestDate: '2026-08-06', createdAt: initialNow, updatedAt: initialNow,
      })
      return row.id
    })
    await withE2eDatabase(async client => {
      const db = drizzle(client, { schema })
      const beforeStatus = await snapshot(client, id)
      // Separate committed transactions are essential: xmin does not change
      // for successive writes inside one transaction.
      await db.transaction(tx => persistCalculatedFinalStatuses(tx,
        [{ id, finalStatus: beforeStatus.final_status }], [{ id, finalStatus: 'годен' }]))
      const afterStatus = await snapshot(client, id)
      expect(afterStatus.final_status).toBe('годен')
      expect(afterStatus.parent_content).toBe(beforeStatus.parent_content)
      expect(afterStatus.parentFingerprint).toBe(beforeStatus.parentFingerprint)
      expect(afterStatus.updated_at).toBe(beforeStatus.updated_at)
      expectOldVersionRejected(id, beforeStatus, afterStatus)

      await db.transaction(tx => tx.update(schema.weldJoints).set({
        isometry: 'ISO-CHANGED', weldingUpdatedAt: ordinaryNow, updatedAt: ordinaryNow,
      }).where(eq(schema.weldJoints.id, id)))
      const afterOrdinary = await snapshot(client, id)
      expect(afterOrdinary.parentFingerprint).not.toBe(afterStatus.parentFingerprint)
      expect(afterOrdinary.updated_at).not.toBe(afterStatus.updated_at)
      expectOldVersionRejected(id, afterStatus, afterOrdinary)

      const correctRepeat = (name: string) => db.transaction(async tx => {
        const [stored] = await tx.select().from(schema.weldJoints)
          .where(eq(schema.weldJoints.id, id)).for('update')
        const repeats = await tx.select().from(schema.pstoRepeatCycles)
          .where(eq(schema.pstoRepeatCycles.weldJointId, id)).orderBy(schema.pstoRepeatCycles.sequence)
        const currentRow = { ...stored, pstoRepeatCycles: repeats, preHeatTreatmentMode: 'selected' } as WeldRow
        const correction = applyPstoCycleCorrection(currentRow, {
          sequence: 2, cycleId: repeats[0].id, stage: 'pstoRequest', action: 'update',
          name, date: '2026-08-06',
        }, DEFAULT_SAVE_CHECK_SETTINGS)
        return persistPstoCycleCorrection({ tx, currentRow, correction, sequence: 2, now: repeatNow })
      })
      // Prime both timestamps through the same REAL persistence helper, then
      // change a real child fact with the explicitly supported identical now.
      await correctRepeat('Repeat correction A')
      const beforeRepeat = await snapshot(client, id)
      await correctRepeat('Repeat correction B')
      const afterRepeat = await snapshot(client, id)
      expect(JSON.parse(beforeRepeat.repeat_content)[0].psto_request).toBe('Repeat correction A')
      expect(JSON.parse(afterRepeat.repeat_content)[0].psto_request).toBe('Repeat correction B')
      expect(afterRepeat.parent_content).toBe(beforeRepeat.parent_content)
      expect(afterRepeat.parentFingerprint).toBe(beforeRepeat.parentFingerprint)
      expect(afterRepeat.updated_at).toBe(beforeRepeat.updated_at)
      expect(afterRepeat.repeat_content).not.toBe(beforeRepeat.repeat_content)
      expect(afterRepeat.parentAndRepeatsFingerprint).not.toBe(beforeRepeat.parentAndRepeatsFingerprint)
      expectOldVersionRejected(id, beforeRepeat, afterRepeat)

      await info.attach('dispatcher-edit-token-probe', { contentType: 'application/json', body: JSON.stringify({
        statusOnly: { parentFingerprintUnchanged: true, updatedAtUnchanged: true, oldXminRejected: true },
        ordinaryField: { parentFingerprintChanged: true, updatedAtChanged: true, oldXminRejected: true },
        repeatCycle: { controlledSameTimestamp: true, realPersistenceHelper: true,
          parentFingerprintUnchanged: true, updatedAtUnchanged: true, oldXminRejected: true,
          parentAndRepeatsFingerprintChanged: true },
        limitation: 'Controlled counterexample, not incidence or performance measurement. Including repeat cycles does not prove complete dependency coverage; no early-save contract is enabled.',
      }, null, 2) })
    })
  } finally {
    await cleanupLineProgramProjects([projectTitle])
  }
})
