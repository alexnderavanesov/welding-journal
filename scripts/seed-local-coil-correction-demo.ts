import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { eq, sql } from 'drizzle-orm'
import { loadServerEnv } from '../src/server-env'
import type { WeldRow } from '../src/lib/dispatcher-types'
import { getWeldFormSaveBlockReason } from '../src/lib/weld-form-save-reasons'

// Explicitly requested local example. Append-only; never reset an existing demo.
loadServerEnv()
const target = new URL(process.env.DATABASE_URL ?? '')
assert(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432')
const apply = process.argv.includes('--apply-local'), seedTest = process.argv.includes('--seed-test')
assert(apply ? target.pathname === '/welding_tracker'
  : (seedTest || process.argv.includes('--check')) && target.pathname === '/welding_tracker_e2e')
assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'main')
const PROJECT = 'Демо — исправление ошибочной катушки', SUBTITLE = 'DEMO-COIL-CORRECTION', STAMP = 'DCK1'
const [{ requireDb }, schema, persistence, validation, documents, chains, dirty, restoration] = await Promise.all([
  import('../src/db'), import('../src/db/schema'), import('../src/server/weld-persistence'), import('../src/server/weld-save-validation'),
  import('../src/server/system-document-index'), import('../src/server/line-program-chain-state'),
  import('../src/server/dispatcher-task-index-dirty'), import('../src/server/coil-restoration'),
])
const db = requireDb()
class RollbackCheck extends Error {}
let summary: unknown
try {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${PROJECT}))`)
    const existing = await tx.select({ id: schema.weldJoints.id, joint: schema.weldJoints.joint }).from(schema.weldJoints).where(eq(schema.weldJoints.projectTitle, PROJECT))
    const existingLines = await tx.select({ id: schema.linePrograms.id }).from(schema.linePrograms).where(eq(schema.linePrograms.projectTitle, PROJECT))
    if (existing.length || existingLines.length) { summary = { skipped: true, project: PROJECT, rows: existing }; return }
    const oldWelds = await tx.select().from(schema.weldJoints), oldSettings = await tx.select().from(schema.appSettings)
    assert.equal((await tx.select().from(schema.welderStamps).where(eq(schema.welderStamps.naksStamp, STAMP))).length, 0)
    await tx.insert(schema.welderStamps).values({ naksStamp: STAMP, internalStamp: 'Д-КТ', welderName: 'Демонстрационный сварщик — отмена катушки',
      weldType: 'РД', materialGroups: 'М01', diameterFrom: '20', diameterTo: '1200', thicknessFrom: '2', thicknessTo: '50', validFrom: '2026-01-01', validTo: '2027-12-31',
      naksPermits: JSON.stringify([{ id: 'demo-coil-naks', weldType: 'РД', materialGroups: 'М01', diameterFrom: '20', diameterTo: '1200', thicknessFrom: '2', thicknessTo: '50', validFrom: '2026-01-01', validTo: '2027-12-31' }]),
      dlsPermits: JSON.stringify([{ id: 'demo-coil-dls', number: 'DEMO-ДЛС-КТ', weldType: 'РД', materialGroups: 'М01', diameterFrom: '20', diameterTo: '1200', thicknessFrom: '2', thicknessTo: '50', validFrom: '2026-01-01', validTo: '2027-12-31' }]),
    })
    const [program] = await tx.insert(schema.linePrograms).values({ projectTitle: PROJECT, subtitleCode: SUBTITLE, line: 'Л-КАТ', category: 'II', groupName: 'Б(а)', weldControlPercent: 0, pvkControlPercent: 0 }).returning()
    const saved: WeldRow[] = []
    for (const [index, joint] of ['F902', 'F902R1', 'F902R2', 'F902R2W1', 'F902Y1', 'F902Y2'].entries()) {
      const side = index >= 4, day = side ? 9 : index * 2 + 1
      const date = (value: number) => `2026-09-${String(value).padStart(2, '0')}`
      const row: WeldRow = { id: 0, projectTitle: PROJECT, subtitleCode: SUBTITLE, line: program.line, lineProgramId: program.id, joint,
        category: 'II', groupName: 'Б(а)', weldControlPercent: 0, pvkControlPercent: 0,
        isometry: 'DEMO-ISO-COIL', sheet: 1, revisionNumber: 0, officiality: 'действующий', revisionActuality: 'актуальная',
        connectionType: 'С17', materialGroup: 'М01', material1: '20', material2: '20', element1: 'Труба', element2: 'Труба',
        d1: 108, d2: 108, t1: 4, t2: 4, weldingMethod: 'РД', weldingElectrodes: 'УОНИ-13/55', weldDate: date(day),
        stamp1K: STAMP, stamp1Z: STAMP, stamp1O: STAMP, stamp1KFact: STAMP, stamp1ZFact: STAMP, stamp1OFact: STAMP,
        hasVik: 'да', vikControlBasis: 'Проект', vikRequest: `ДЕМО-ВИК-заявка-${joint}`, vikRequestDate: date(day),
        ...(!side ? { vikResult: index >= 2 ? 'вырез' : 'ремонт', vikConclusion: `ДЕМО-ВИК-заключение-${joint}`, vikConclusionDate: date(day + 1), vikDefectDescription: 'Демонстрационный дефект' } : {}),
        weldingJournalNote: 'Учебный пример: катушка внесена ошибочно, физической врезки не было. Откройте «Картину стыка F902» → «Исправить ошибочную катушку». У сторон есть заявки ВИК; затем удалите стороны и исправьте ошибочный ВИК F902R2W1 на годен по условию примера. Последний шаг — отдельное подтверждение восстановления.',
      }
      const context = await validation.loadServerWeldValidationContext(tx, [row])
      assert.equal(getWeldFormSaveBlockReason(row, {}, context.saveCheckSettings, { allowSystemJointName: true }), null)
      assert.equal(validation.getSystemDocumentIntegrityReason(row, undefined), '')
      const [record] = await tx.insert(schema.weldJoints).values(persistence.toDbInsert(row, true)).returning()
      saved.push(record as WeldRow)
      await chains.syncProgramChainStates(tx, [record], new Map())
    }
    await documents.syncSystemDocumentsForWeldChangesInTransaction(tx, saved, new Map())
    const preview = await restoration.previewCoilRestorationInTransaction(tx, saved[0].id)
    assert.equal(preview.checklist.replacedByCoil, true)
    assert.equal(preview.checklist.historyRows.length, 2)
    assert.equal(preview.before.joints, 2)
    assert.match(preview.reason ?? '', /Сохранились стороны/)
    const oldIds = new Set(oldWelds.map(row => row.id))
    assert.deepEqual((await tx.select().from(schema.weldJoints)).filter(row => oldIds.has(row.id)), oldWelds)
    assert.deepEqual(await tx.select().from(schema.appSettings), oldSettings)
    await dirty.markDispatcherTaskIndexDirty(tx, { scopes: dirty.getDispatcherDirtyScopes(saved, new Map()) })
    summary = { project: PROJECT, subtitle: SUBTITLE, line: program.line, rootId: saved[0].id, created: saved.length,
      rows: saved.map(row => ({ id: row.id, joint: row.joint })), preserved: oldWelds.length, physicalJoints: preview.before.joints }
    if (!apply && !seedTest) throw new RollbackCheck()
  })
} catch (error) { if (!(error instanceof RollbackCheck)) throw error }
finally { await (db as unknown as { $client: { end(): Promise<void> } }).$client.end() }
console.log(JSON.stringify({ applied: apply || seedTest, summary }))
