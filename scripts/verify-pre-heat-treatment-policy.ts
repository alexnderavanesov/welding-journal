import assert from 'node:assert/strict'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { hasHistoricalPreHeatTreatmentExemption, hasOwnPstoStart } from '../src/lib/pre-heat-treatment-policy'
import { canCreatePreHeatTreatmentRequest } from '../src/lib/pre-heat-treatment-control-updates'
import { canCreatePstoWorkflowRequest, canAddPstoWorkflowResult } from '../src/lib/psto-status'
import type { WeldRow } from '../src/lib/dispatcher-types'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '../src/lib/control-process-settings'
import { isPrimaryLnkStageReady } from '../src/lib/lnk-control-stage'
import { canCreateLnkRequest } from '../src/lib/report-control-state'

// Only the disposable E2E database. No .env fallback, remote access or migrations.
const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, schema, policy, relations, lnk, psto, persistence, read] = await Promise.all([
  import('../src/db/index'), import('../src/db/schema'), import('../src/server/pre-heat-treatment-policy'),
  import('../src/server/heat-treatment-control-relations'), import('../src/server/lnk-workflow-context'),
  import('../src/server/psto-workflow-context'), import('../src/server/psto-cycle-state'),
  import('../src/server/weld-read'),
])
const { appSettings, weldJoints, preHeatTreatmentControls } = schema
const db = requireDb()
const rolledBack = new Error('intentional fixture rollback')
let comparisons = 0
await db.transaction(async (tx) => {
  const base = { projectTitle: 'E2E pre-TO policy matrix', subtitleCode: 'P', line: 'L',
    weldDate: '2026-07-10', pstoRequired: 'да', hasVik: 'да', preHeatTreatmentLnkExempt: true, pstoResult: 'ожидает заявку' }
  const history = { pstoRequest: 'P-1', pstoRequestDate: '2026-07-10', pstoDate: '2026-07-12',
    pstoResult: 'проведено', tvmtRequest: 'T-1', tvmtResult: 'годен', tvmtConclusionDate: '2026-07-12' }
  const rows = await tx.insert(weldJoints).values([
    { ...base, joint: 'F43' },
    { ...base, joint: 'F1', line: 'L2' },
    { ...base, joint: 'SB057' },
    { ...base, joint: 'F52-history-626', ...history },
    { ...base, joint: 'HISTORY-BAD', ...history },
    { ...base, joint: 'REQUEST-ONLY', pstoRequest: 'P-2', pstoRequestDate: '2026-07-10' },
    { ...base, joint: 'NORMAL', preHeatTreatmentLnkExempt: false },
    { ...base, joint: 'WAITING-ONLY', pstoRequired: null, tvmtResult: 'ожидает', pstoNote: 'заметка' },
    { ...base, joint: 'CANCELLED', pstoRequired: 'отменен', tvmtResult: 'ожидает' },
  ]).returning()
  const ids = rows.map((row) => row.id)
  await tx.insert(preHeatTreatmentControls).values([
    { weldJointId: rows[2].id, method: 'ВИК', requestName: 'НК-SB057', requestDate: '2026-07-10', result: 'годен', conclusionDate: '2026-07-11', conclusionName: 'К-SB057' },
    { weldJointId: rows[4].id, method: 'ВИК', requestName: 'НК-BAD', requestDate: '2026-07-10', result: 'вырез', conclusionDate: '2026-07-11', conclusionName: 'К-BAD' },
  ])
  for (const enabled of [true, false, true]) {
    const value = JSON.stringify({ ...DEFAULT_CONTROL_PROCESS_SETTINGS, preHeatTreatmentLnkEnabled: enabled })
    await tx.insert(appSettings).values({ key: 'control-processes', value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    const hydrated = await relations.attachHeatTreatmentControlRelations(rows, tx)
    const sqlFacts = await tx.select({ id: weldJoints.id, started: policy.buildOwnPstoStartWhere(),
      exempt: policy.buildHistoricalPreHeatTreatmentExemptionWhere() }).from(weldJoints).where(inArray(weldJoints.id, ids))
    for (const row of hydrated) {
      const facts = sqlFacts.find((item) => item.id === row.id)!
      assert.equal(facts.started, hasOwnPstoStart(row), row.joint!)
      assert.equal(facts.exempt, hasHistoricalPreHeatTreatmentExemption(row), row.joint!)
    }
    const cases = [
      { where: read.buildAvailableLnkRequestWhere(), accept: (row: WeldRow) => canCreateLnkRequest(row) },
      { where: lnk.buildLnkWorkflowRowsWhere({ scope: 'requestCandidates', methodKeys: ['vikRequest'] }), accept: (row: WeldRow) => canCreateLnkRequest(row) },
      { where: lnk.buildLnkWorkflowRowsWhere({ scope: 'preHeatTreatmentRequestCandidates' }), accept: (row: WeldRow) => canCreatePreHeatTreatmentRequest(row, 'ВИК') },
      { where: psto.buildPstoWorkflowRowsWhere({ scope: 'requestCandidates' }), accept: canCreatePstoWorkflowRequest },
      { where: psto.buildPstoWorkflowRowsWhere({ scope: 'resultCandidates' }), accept: canAddPstoWorkflowResult },
      { where: read.buildPrimaryLnkStageReadyWhere('ВИК'), accept: (row: WeldRow) => isPrimaryLnkStageReady(row, 'ВИК') },
    ]
    for (const entry of cases) {
      const found = await tx.select({ id: weldJoints.id }).from(weldJoints).where(and(inArray(weldJoints.id, ids), entry.where))
      assert.deepEqual(found.map((row) => row.id).sort(), hydrated.filter(entry.accept).map((row) => row.id).sort(), `SQL/JS candidates; enabled=${enabled}`)
      comparisons += hydrated.length
    }
  }
  // Starting PSTO after fixing pre-TO must not resurrect the old inherited flag.
  const [fresh] = await relations.attachHeatTreatmentControlRelations([rows[0]], tx)
  assert.equal(fresh.preHeatTreatmentLnkExempt, false)
  await persistence.savePstoCycleRowsInBatches(tx, [{ ...fresh, pstoRequest: 'NEW-P', pstoRequestDate: '2026-07-12' } as WeldRow])
  const [saved] = await tx.select().from(weldJoints).where(eq(weldJoints.id, fresh.id))
  assert.equal(saved.preHeatTreatmentLnkExempt, false)
  // Work started while off records its own protection, without altering neighbours.
  await persistence.savePstoCycleRowsInBatches(tx, [{ ...rows[1], preHeatTreatmentLnkEnabled: false, preHeatTreatmentLnkExempt: false, pstoRequest: 'OFF-P' } as WeldRow])
  const [offSaved] = await tx.select().from(weldJoints).where(eq(weldJoints.id, rows[1].id))
  assert.equal(offSaved.preHeatTreatmentLnkExempt, true)
  const [neighbour] = await tx.select().from(weldJoints).where(eq(weldJoints.id, rows[6].id))
  assert.equal(neighbour.preHeatTreatmentLnkExempt, false)
  const plan = await tx.execute(sql`explain (analyze, format json) select ${policy.buildPreHeatTreatmentEnabledWhere()} from ${weldJoints} where ${inArray(weldJoints.id, ids)}`)
  const nodes = JSON.stringify(plan.rows)
  assert(nodes.includes('InitPlan'), 'Setting must be an uncorrelated init plan, never an N+1 lookup')
  type PlanNode = { 'Relation Name'?: string; 'Actual Loops'?: number; Plans?: PlanNode[] }
  const root = (plan.rows[0]['QUERY PLAN'] as Array<{ Plan: PlanNode }>)[0].Plan
  const walk = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(walk)]
  const settingScans = walk(root).filter((node) => node['Relation Name'] === 'app_settings')
  assert.equal(settingScans.length, 1)
  assert.equal(settingScans[0]['Actual Loops'], 1)
  throw rolledBack
}).catch((error) => { if (error !== rolledBack) throw error })
console.log(JSON.stringify({ comparisons, flagsDoNotRevive: true, ownHistoryOnly: true, settingInitPlan: true, fixtureRolledBack: true }))
