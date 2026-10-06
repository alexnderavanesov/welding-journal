import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { eq, sql } from 'drizzle-orm'
import { loadServerEnv } from '../src/server-env'
import type { WeldRow } from '../src/lib/dispatcher-types'
import { getWeldFormSaveBlockReason } from '../src/lib/weld-form-save-reasons'

// User-requested append-only local example, not a production fixture or migration.
loadServerEnv()
const target = new URL(process.env.DATABASE_URL ?? '')
assert(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432')
const apply = process.argv.includes('--apply-local')
assert(apply ? target.pathname === '/welding_tracker'
  : process.argv.includes('--check') && target.pathname === '/welding_tracker_e2e')
assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'main')
const PROJECT = 'Демо — сохранённая история до ТО'
const SUBTITLE = 'DEMO-HISTORY-TO'
const STAMP = 'DTH1'
const [{ requireDb }, schema, persistence, validation, documents, chains, dirty] = await Promise.all([
  import('../src/db/index'), import('../src/db/schema'), import('../src/server/weld-persistence'),
  import('../src/server/weld-save-validation'), import('../src/server/pre-heat-treatment-system-documents'),
  import('../src/server/line-program-chain-state'), import('../src/server/dispatcher-task-index-dirty'),
])
const db = requireDb()
class RollbackCheck extends Error {}
let summary: unknown
try {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${PROJECT}))`)
    const existing = await tx.select({ id: schema.weldJoints.id, joint: schema.weldJoints.joint })
      .from(schema.weldJoints).where(eq(schema.weldJoints.projectTitle, PROJECT))
    if (existing.length) {
      assert.equal(existing.length, 1, 'Unexpected existing demo; do not overwrite user changes')
      summary = { skipped: true, project: PROJECT, ...existing[0] }
      return
    }
    const oldWelds = await tx.select().from(schema.weldJoints)
    const oldSettings = await tx.select().from(schema.appSettings)
    assert.equal((await tx.select().from(schema.welderStamps).where(eq(schema.welderStamps.naksStamp, STAMP))).length, 0)
    await tx.insert(schema.welderStamps).values({
      naksStamp: STAMP, internalStamp: 'Д-ТО', welderName: 'Демонстрационный сварщик — история до ТО',
      weldType: 'РД', materialGroups: 'М01', diameterFrom: '20', diameterTo: '1200', thicknessFrom: '2', thicknessTo: '50',
      validFrom: '2026-01-01', validTo: '2027-12-31',
      naksPermits: JSON.stringify([{ id: 'demo-history-naks', weldType: 'РД', materialGroups: 'М01',
        diameterFrom: '20', diameterTo: '1200', thicknessFrom: '2', thicknessTo: '50', validFrom: '2026-01-01', validTo: '2027-12-31' }]),
      dlsPermits: JSON.stringify([{ id: 'demo-history-dls', number: 'DEMO-ДЛС-ТО', weldType: 'РД', materialGroups: 'М01',
        diameterFrom: '20', diameterTo: '1200', thicknessFrom: '2', thicknessTo: '50', validFrom: '2026-01-01', validTo: '2027-12-31' }]),
    })
    const [program] = await tx.insert(schema.linePrograms).values({ projectTitle: PROJECT, subtitleCode: SUBTITLE,
      line: 'Л2', category: 'II', groupName: 'Б(а)', weldControlPercent: 0, pvkControlPercent: 0 }).returning()
    const row: WeldRow = {
      id: 0, projectTitle: PROJECT, subtitleCode: SUBTITLE, line: 'Л2', joint: 'F901', lineProgramId: program.id,
      weldDate: '2026-09-01', category: 'II', groupName: 'Б(а)', weldControlPercent: 0, pvkControlPercent: 0,
      isometry: 'DEMO-ISO-TO', sheet: 1, revisionNumber: 0, officiality: 'действующий', revisionActuality: 'актуальная',
      connectionType: 'С17', materialGroup: 'М01', material1: '20', material2: '20', element1: 'Труба', element2: 'Труба',
      d1: 108, d2: 108, t1: 4, t2: 4, weldingMethod: 'РД', weldingElectrodes: 'УОНИ-13/55',
      stamp1K: STAMP, stamp1Z: STAMP, stamp1O: STAMP, stamp1KFact: STAMP, stamp1ZFact: STAMP, stamp1OFact: STAMP,
      hasVik: 'да', vikControlBasis: 'Проект',
      weldingJournalNote: 'Демонстрационный пример по просьбе пользователя: стык на Л2 без ПСТО, сохранён годный ВИК «До ТО» с прежней линии. Основной ВИК ещё не выполнен. Историю можно посмотреть в «Картине стыка».',
    }
    const context = await validation.loadServerWeldValidationContext(tx, [row])
    assert.equal(getWeldFormSaveBlockReason(row, {}, context.saveCheckSettings), null)
    const [saved] = await tx.insert(schema.weldJoints).values(persistence.toDbInsert(row, true)).returning()
    const controls = await tx.insert(schema.preHeatTreatmentControls).values({ weldJointId: saved.id, method: 'ВИК',
      requestName: 'ДЕМО — заявка ВИК до ТО F901', requestDate: '2026-09-02', result: 'годен',
      conclusionName: 'ДЕМО — заключение ВИК до ТО F901', conclusionDate: '2026-09-03', defectDescription: 'ДНО',
    }).returning()
    const hydrated = { ...saved, preHeatTreatmentControls: controls } as unknown as WeldRow
    assert.equal(validation.getSystemDocumentIntegrityReason(hydrated, undefined), '')
    await chains.syncProgramChainStates(tx, [hydrated], new Map())
    await documents.syncPreHeatTreatmentDocumentsInTransaction(tx, [hydrated], controls)
    const oldIds = new Set(oldWelds.map(item => item.id))
    assert.deepEqual((await tx.select().from(schema.weldJoints)).filter(item => oldIds.has(item.id)), oldWelds)
    assert.deepEqual(await tx.select().from(schema.appSettings), oldSettings)
    await dirty.markDispatcherTaskIndexDirty(tx, { scopes: dirty.getDispatcherDirtyScopes([hydrated], new Map()) })
    summary = { project: PROJECT, subtitle: SUBTITLE, line: 'Л2', joint: 'F901', id: saved.id, created: 1,
      preserved: oldWelds.length, preResult: controls[0].result, primaryResult: saved.vikResult }
    if (!apply) throw new RollbackCheck()
  })
} catch (error) {
  if (!(error instanceof RollbackCheck)) throw error
} finally {
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end()
}
console.log(JSON.stringify({ applied: apply, summary }))
