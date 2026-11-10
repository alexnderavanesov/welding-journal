import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, basename, join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { eq, inArray, sql } from 'drizzle-orm'
import { assertSafeE2eDatabaseUrl } from '../e2e/database'

assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
const storage = process.env.LINE_SCHEME_STORAGE_PATH
assert(storage && basename(storage) === 'line-schemes', 'Runner-owned disposable PDF directory is required')
const directory = await realpath(dirname(storage))
assert(directory.startsWith(join(await realpath(tmpdir()), 'welding-e2e-templates-')), 'PDF storage must be inside the E2E temporary directory')

const { requireDb, closeDatabase } = await import('../src/db')
const { cleanupLineSchemeProjects } = await import('../e2e/line-scheme-fixtures')
const schema = await import('../src/db/schema')
const { authUsers, linePrograms, weldJoints, weldJointProgramStates, generatedDocumentWeldJoints, dispatcherRowTasks, coilRestorationEvents, lineSchemeBundles, lineSchemeMembers,
  lineSchemePhysicals, lineSchemePoints, lineSchemeRevisions } = schema
const { runWithAccess, toAccessIdentity, accessContext, requirePermission } = await import('../src/server/access-context')
const { createWeldJoint, createWeldJoints, updateWeldJoint, deleteWeldJoint, deleteWeldJoints } = await import('../src/server/weld-mutations')
const { replaceWeldJoints } = await import('../src/server/weld-import')
const { saveLineProgramInTransaction, loadLineProgramRows, loadProgramSystemIndexSettings } = await import('../src/server/line-program')
const { calculateLineProgram } = await import('../src/lib/line-program-calculation')
const { previewLnkOfficialityChange, applyLnkOfficialityChange } = await import('../src/server/lnk-officiality-workflow')
const { previewCoilRestorationInTransaction, restoreCoilInTransaction } = await import('../src/server/coil-restoration')
const { assertSecurityScope } = await import('../src/server/security-functions')
const { syncSystemDocumentsForWeldChangesInTransaction } = await import('../src/server/system-document-index')
const { markDispatcherTaskIndexDirty } = await import('../src/server/dispatcher-task-index-dirty')
const { getDispatcherTaskIndexSnapshot } = await import('../src/server/dispatcher-task-index')
const { attachDispatcherTaskCodesToPage } = await import('../src/server/weld-read')
const { deleteEmptyLineProgram } = await import('../src/server/line-program-deletion')
const { openScheme, prepareSchemeUpload, publishSchemeFile, saveSchemePoints, changeSchemeRevision } = await import('../src/server/line-scheme-write')
const { readSchemePointPage, readSchemeBundle, readSchemeLines } = await import('../src/server/line-scheme-read')
const { createSchemeFileStore } = await import('../src/server/line-scheme-files')
const { handleSchemeFile } = await import('../src/server/line-scheme-http')
const db = requireDb(), store = createSchemeFileStore(storage)
const [owner] = await db.select().from(authUsers).where(eq(authUsers.role, 'owner'))
assert(owner, 'Prepared E2E owner is required')
const project = `E2E scheme journal ${randomUUID()}`
const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save()
const fixture = <T>(run: () => Promise<T>) => accessContext.exit(run)
const checks: string[] = []
type Line = typeof linePrograms.$inferSelect
type Revision = { revisionId: string; fileKey: string }
type Drawing = { bundleId: number; token: string; revisions: Revision[]; roots: number[] }
type DeleteMode = 'single' | 'bulk' | 'import'

async function seedLine(line: string, names: string[]) {
  return fixture(async () => {
    const [program] = await db.insert(linePrograms).values({ projectTitle: project, subtitleCode: 'SCHEME-JOURNAL', line,
      category: 'II', groupName: 'Б(а)', weldControlPercent: 20, pvkControlPercent: 0, pstoAssignment: 'unassigned' }).returning()
    const rows = names.length ? await db.insert(weldJoints).values(names.map(joint => ({ lineProgramId: program.id,
      projectTitle: project, subtitleCode: program.subtitleCode, line, joint, connectionType: 'С17',
      officiality: 'действующий', revisionActuality: 'актуальная', category: program.category, groupName: program.groupName,
      weldControlPercent: 20, pvkControlPercent: 0, hasVik: 'да', pstoRequired: 'Нет' }))).returning() : []
    if (rows.length) await db.insert(weldJointProgramStates).values(rows.map(row => ({ weldJointId: row.id, kind: 'primary', physicalRootId: row.id })))
    return { program, rows }
  })
}

async function versions(ids: number[]) {
  return db.select({ id: weldJoints.id, version: sql<string>`${weldJoints}.xmin::text` }).from(weldJoints)
    .where(inArray(weldJoints.id, ids)).orderBy(weldJoints.id)
}

async function remove(mode: DeleteMode, targets: Awaited<ReturnType<typeof versions>>) {
  if (mode === 'single') { assert.equal(targets.length, 1); return deleteWeldJoint({ data: targets[0] }) }
  if (mode === 'bulk') return deleteWeldJoints({ data: { targets } })
  return replaceWeldJoints({ data: { records: [], deleteIds: targets.map(row => row.id), expectedVersions: targets } })
}

async function appendRevision(drawing: Drawing) {
  const bundle = await readSchemeBundle(db, drawing.bundleId)
  const request = { bundleId: bundle.id, token: drawing.token, version: bundle.version, operationId: randomUUID(), replace: 'archive' as const }
  const fileKey = await prepareSchemeUpload(request)
  const stored = await store.write(fileKey, new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const published = await publishSchemeFile({ ...request, fileKey, fileName: `${drawing.revisions.length + 1}.pdf`, ...stored, pageCount: await store.validate(fileKey) })
  const revision = { revisionId: published.revisionId, fileKey }
  drawing.revisions.push(revision)
  // These are explicit manual placements in both editions, not automatic copying.
  if (drawing.roots.length) await saveSchemePoints({ bundleId: bundle.id, token: drawing.token, version: published.version,
    revisionId: revision.revisionId, revisionVersion: 1, operationId: randomUUID(), changes: {
      upsert: drawing.roots.map((rootId, index) => ({ id: randomUUID(), rootId, page: 1, x: .2 + index * .15, y: .3 })), remove: [],
    } })
  return revision
}

async function drawingFor(program: Line, roots: number[], archive = false): Promise<Drawing> {
  const token = randomUUID(), opened = await openScheme({ lineId: program.id, token })
  assert(opened.bundle && opened.lease.owned)
  const drawing: Drawing = { bundleId: opened.bundle.id, token, roots, revisions: [] }
  await appendRevision(drawing)
  if (archive) await appendRevision(drawing)
  return drawing
}

async function points(drawing: Drawing) {
  return Promise.all(drawing.revisions.map(revision => readSchemePointPage({ revisionId: revision.revisionId, page: 1 })))
}

async function snapshot(drawing: Drawing, rowIds: number[]) {
  const revisionIds = drawing.revisions.map(row => row.revisionId)
  const storedPoints = await db.select().from(lineSchemePoints).where(inArray(lineSchemePoints.revisionId, revisionIds)).orderBy(lineSchemePoints.id)
  const physicalIds = [...new Set(storedPoints.map(point => point.physicalId))]
  return {
    rows: await db.select().from(weldJoints).where(inArray(weldJoints.id, rowIds)).orderBy(weldJoints.id),
    states: await db.select().from(weldJointProgramStates).where(inArray(weldJointProgramStates.weldJointId, rowIds)).orderBy(weldJointProgramStates.weldJointId),
    points: storedPoints,
    physicals: await db.select().from(lineSchemePhysicals).where(inArray(lineSchemePhysicals.id, physicalIds)).orderBy(lineSchemePhysicals.id),
    members: await db.select().from(lineSchemeMembers).where(inArray(lineSchemeMembers.physicalId, physicalIds)).orderBy(lineSchemeMembers.weldJointId),
    bundle: await db.select().from(lineSchemeBundles).where(eq(lineSchemeBundles.id, drawing.bundleId)),
    revisions: await db.select().from(lineSchemeRevisions).where(inArray(lineSchemeRevisions.id, revisionIds)).orderBy(lineSchemeRevisions.id),
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.message}\n${errorText(error.cause)}` : String(error ?? '')
}

async function withLateDeleteFailure(physicalId: number, run: () => Promise<void>) {
  // A disposable trigger fails the tombstone write after the actual journal
  // DELETE and structural synchronization have started. No production code or
  // business guard is bypassed; PostgreSQL must roll the entire command back.
  const name = `e2e_scheme_rollback_${randomUUID().replaceAll('-', '')}`
  await fixture(async () => {
    await db.execute(sql`create function ${sql.identifier(name)}() returns trigger language plpgsql as $$
      begin raise exception 'E2E late scheme deletion rollback'; end; $$`)
    await db.execute(sql`create trigger ${sql.identifier(name)} after update on ${lineSchemePhysicals}
      for each row when (new.id = ${sql.raw(String(physicalId))}) execute function ${sql.identifier(name)}()`)
  })
  try { await run() }
  finally {
    await fixture(async () => {
      await db.execute(sql`drop trigger ${sql.identifier(name)} on ${lineSchemePhysicals}`)
      await db.execute(sql`drop function ${sql.identifier(name)}()`)
    })
  }
}

async function deleteLine(programId: number) {
  await requirePermission('lines.delete')
  const [program] = await db.select().from(linePrograms).where(eq(linePrograms.id, programId))
  assert(program)
  return db.transaction(tx => deleteEmptyLineProgram(tx, { id: program.id, version: program.updatedAt.toISOString() }))
}

async function assertFilesSurviveDeletedLine(drawing: Drawing, lineName: string) {
  const bundle = await readSchemeBundle(db, drawing.bundleId)
  assert(bundle.deleted); assert.equal(bundle.line, lineName)
  assert.equal(bundle.activeRevisionId, drawing.revisions.at(-1)!.revisionId)
  assert.equal(bundle.revisions.length, drawing.revisions.length)
  const listed = (await readSchemeLines({ search: project })).rows.find(row => row.bundleId === drawing.bundleId)
  assert(listed?.deleted); assert.equal(listed.total, 0); assert.equal(listed.revisionCount, drawing.revisions.length)
  for (const revision of drawing.revisions) {
    assert.equal(await store.size(revision.fileKey), bytes.length)
    const response = await handleSchemeFile(new Request(`http://127.0.0.1/api/line-schemes/file?revision=${revision.revisionId}`))
    assert.equal(response.status, 200)
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes)
    for (const point of (await readSchemePointPage({ revisionId: revision.revisionId, page: 1 })).points) {
      assert.equal(point.joint.color, 'inactive'); assert.equal(point.joint.rowId, null)
    }
  }
}

async function syncFixtureDocuments(ids: number[]) {
  await fixture(() => db.transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(inArray(weldJoints.id, ids))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
    await markDispatcherTaskIndexDirty(tx)
  }))
}

async function quota(program: Line) {
  const rows = await loadLineProgramRows(db, program), settings = await loadProgramSystemIndexSettings(db)
  return calculateLineProgram(rows, program.weldControlPercent!, program.pvkControlPercent!, settings).map(group => ({
    stamp: group.stamp, rowIds: group.rowIds, rejected: group.rejectedRowIds,
    common: { required: group.common.required, missing: group.common.missing, covered: group.common.coveredRowIds, completed: group.common.completedRowIds },
    pvk: { required: group.pvk.required, missing: group.pvk.missing, covered: group.pvk.coveredRowIds },
  }))
}

const documentLinks = (ids: number[]) => db.select({ documentId: generatedDocumentWeldJoints.documentId, weldJointId: generatedDocumentWeldJoints.weldJointId })
  .from(generatedDocumentWeldJoints).where(inArray(generatedDocumentWeldJoints.weldJointId, ids))
  .orderBy(generatedDocumentWeldJoints.documentId, generatedDocumentWeldJoints.weldJointId)
const controlFacts = (ids: number[]) => db.select({ id: weldJoints.id, weldDate: weldJoints.weldDate,
  vikResult: weldJoints.vikResult, vikConclusion: weldJoints.vikConclusion, uzkResult: weldJoints.uzkResult, uzkConclusion: weldJoints.uzkConclusion })
  .from(weldJoints).where(inArray(weldJoints.id, ids)).orderBy(weldJoints.id)

async function assertSameDrawing(drawing: Drawing, before: Awaited<ReturnType<typeof points>>, rowId: number, label: string, color: string) {
  const current = await points(drawing)
  for (const [index, page] of current.entries()) {
    assert.equal(page.points.length, 1)
    assert.equal(page.points[0].id, before[index].points[0].id)
    assert.equal(page.points[0].physicalId, before[index].points[0].physicalId)
    assert.equal(page.points[0].joint.rowId, rowId)
    assert.equal(page.points[0].joint.label, label)
    assert.equal(page.points[0].joint.color, color)
  }
}

async function assertSp09(rowId: number, expected: boolean) {
  const snapshot = await getDispatcherTaskIndexSnapshot({ ensureFresh: true })
  assert(snapshot.isFresh)
  const stored = await db.select({ code: dispatcherRowTasks.code }).from(dispatcherRowTasks).where(eq(dispatcherRowTasks.weldJointId, rowId))
  const [visible] = await attachDispatcherTaskCodesToPage([{ id: rowId }]) as { id: number; dispatcherTasks?: string }[]
  assert.equal(stored.some(task => task.code === 'СП-09'), expected)
  assert.equal(String(visible.dispatcherTasks ?? '').includes('СП-09'), expected)
  return snapshot
}

try {
  await runWithAccess(toAccessIdentity(owner), 'line-scheme-journal-integration', [], async () => {
    for (const mode of ['single', 'bulk', 'import'] as const) {
      const { program, rows } = await seedLine(mode, ['S1', 'S2', 'S3'])
      const drawing = await drawingFor(program, rows.map(row => row.id), true)
      const targets = rows.slice(0, mode === 'single' ? 1 : 2)
      if (mode === 'single') {
        // Exercise the real whole-line rename and a later journal-name correction;
        // the deleted label must come from the latest row, not initial placement.
        const renamed = await db.transaction(tx => saveLineProgramInTransaction(tx, { ...program, version: program.updatedAt.toISOString(), line: 'single-renamed' }))
        assert.equal((await readSchemeBundle(db, drawing.bundleId)).line, renamed.line)
        await updateWeldJoint({ data: { id: targets[0].id, expectedVersion: (await versions([targets[0].id]))[0].version, joint: 'S11' } })
        targets[0].joint = 'S11'; program.line = renamed.line
        checks.push('real-line-and-joint-rename')
      }
      const before = await snapshot(drawing, rows.map(row => row.id))
      const projectedBefore = await points(drawing)
      const targetPhysicalIds = projectedBefore[0].points.filter(point => targets.some(row => row.id === point.joint.rowId)).map(point => point.physicalId)
      assert.equal(targetPhysicalIds.length, targets.length)
      for (const edition of projectedBefore) for (const target of targets) assert.equal(edition.points.find(point => point.joint.rowId === target.id)?.joint.label, target.joint)

      const current = await versions(targets.map(row => row.id))
      await assert.rejects(() => remove(mode, current.map((row, index) => index ? row : { ...row, version: '0' })))
      assert.deepEqual(await snapshot(drawing, rows.map(row => row.id)), before)
      await assert.rejects(() => deleteLine(program.id), /В журнале есть записи/)
      assert.deepEqual(await snapshot(drawing, rows.map(row => row.id)), before)
      checks.push(`${mode}-stale-and-nonempty-line-rollback`)

      await withLateDeleteFailure(targetPhysicalIds[0], async () => {
        await assert.rejects(() => remove(mode, current), error => {
          assert.match(errorText(error), /E2E late scheme deletion rollback/); return true
        })
        assert.deepEqual(await snapshot(drawing, rows.map(row => row.id)), before)
      })
      checks.push(`${mode}-late-atomic-rollback`)
      await remove(mode, current)
      assert.equal((await versions(targets.map(row => row.id))).length, 0)
      const deletedState = await snapshot(drawing, rows.map(row => row.id))
      assert.deepEqual(deletedState.points, before.points)
      assert.deepEqual(deletedState.members, before.members)
      assert.deepEqual(deletedState.revisions, before.revisions)
      for (const edition of await points(drawing)) for (const original of projectedBefore[0].points) {
        const point = edition.points.find(point => point.physicalId === original.physicalId)!
        if (targetPhysicalIds.includes(point.physicalId)) {
          assert.equal(point.joint.color, 'inactive'); assert.equal(point.joint.rowId, null)
          assert.equal(point.joint.label, original.joint.label)
          assert.equal(deletedState.physicals.find(row => row.id === point.physicalId)?.lastLabel, original.joint.label)
        } else assert.equal(point.joint.rowId, original.joint.rowId)
      }
      checks.push(`${mode}-preserved-points-and-last-label`)

      const fresh = await createWeldJoint({ data: { projectTitle: project, subtitleCode: program.subtitleCode, line: program.line,
        joint: targets[0].joint, connectionType: 'С17', officiality: 'действующий' } })
      assert.notEqual(fresh.id, targets[0].id)
      assert.equal((await db.select().from(lineSchemeMembers).where(eq(lineSchemeMembers.weldJointId, fresh.id))).length, 0)
      for (const edition of await points(drawing)) for (const point of edition.points.filter(point => targetPhysicalIds.includes(point.physicalId))) {
        assert.equal(point.joint.color, 'inactive'); assert.equal(point.joint.rowId, null)
      }
      const bundle = await readSchemeBundle(db, drawing.bundleId), main = drawing.revisions.at(-1)!
      const mainPage = await readSchemePointPage({ revisionId: main.revisionId, page: 1 })
      const freshPointId = randomUUID()
      await saveSchemePoints({ bundleId: bundle.id, token: drawing.token, version: bundle.version, revisionId: main.revisionId,
        revisionVersion: mainPage.version, operationId: randomUUID(), changes: {
          upsert: [{ id: freshPointId, rootId: fresh.id, page: 1, x: .8, y: .8 }], remove: [],
        } })
      const freshPoint = (await readSchemePointPage({ revisionId: main.revisionId, page: 1 })).points.find(point => point.id === freshPointId)!
      assert.equal(freshPoint.joint.rowId, fresh.id); assert(!targetPhysicalIds.includes(freshPoint.physicalId))
      checks.push(`${mode}-namesake-keeps-independent-identity`)

      const remaining = await db.select({ id: weldJoints.id }).from(weldJoints).where(eq(weldJoints.lineProgramId, program.id))
      await remove('bulk', await versions(remaining.map(row => row.id)))
      await deleteLine(program.id)
      assert.equal((await db.select().from(linePrograms).where(eq(linePrograms.id, program.id))).length, 0)
      await assertFilesSurviveDeletedLine(drawing, program.line)
      checks.push(`${mode}-deleted-line-retains-both-pdfs`)
      const deletedBundle = await readSchemeBundle(db, drawing.bundleId)
      const deletedPage = await readSchemePointPage({ revisionId: main.revisionId, page: 1 })
      await assert.rejects(() => saveSchemePoints({ bundleId: deletedBundle.id, token: drawing.token, version: deletedBundle.version,
        revisionId: main.revisionId, revisionVersion: deletedPage.version, operationId: randomUUID(), changes: {
          upsert: [], remove: [freshPointId],
        } }), /Линия удалена/)
      await assert.rejects(() => changeSchemeRevision({ bundleId: deletedBundle.id, token: drawing.token, version: deletedBundle.version,
        revisionId: drawing.revisions[0].revisionId, action: 'activate', operationId: randomUUID() }), /Линия удалена/)
      assert.equal((await readSchemePointPage({ revisionId: main.revisionId, page: 1 })).points.length, deletedPage.points.length)
      // A later line with exactly the same three display names is a different
      // registry identity and must not inherit the deleted line's PDF bundle.
      const later = await createWeldJoint({ data: { projectTitle: project, subtitleCode: program.subtitleCode, line: program.line,
        joint: 'S1', connectionType: 'С17', officiality: 'действующий' } })
      assert(later.lineProgramId); assert.notEqual(later.lineProgramId, program.id)
      const reopened = await openScheme({ lineId: later.lineProgramId, token: randomUUID() })
      assert(reopened.bundle); assert.notEqual(reopened.bundle.id, drawing.bundleId)
      assert.equal(reopened.bundle.revisions.length, 0)
      assert((await readSchemeBundle(db, drawing.bundleId)).deleted)
      // Explicit PDF deletion remains allowed on the historical bundle.
      await changeSchemeRevision({ bundleId: deletedBundle.id, token: drawing.token, version: deletedBundle.version,
        revisionId: drawing.revisions[0].revisionId, action: 'delete', operationId: randomUUID() })
      assert.equal((await readSchemeBundle(db, drawing.bundleId)).revisions.length, 1)
      assert.equal((await handleSchemeFile(new Request(`http://127.0.0.1/api/line-schemes/file?revision=${drawing.revisions[0].revisionId}`))).status, 404)
      await assert.rejects(() => store.size(drawing.revisions[0].fileKey), { code: 'ENOENT' })
      assert.equal(await store.size(main.fileKey), bytes.length)
      checks.push(`${mode}-deleted-line-view-delete-only-and-no-name-rebinding`)
    }

    const repair = await seedLine('repair', ['S9', 'S9R1', 'S10'])
    const [source, child, peer] = repair.rows
    await fixture(async () => {
      await db.update(weldJoints).set({ weldDate: '2026-11-01', vikResult: 'ремонт' }).where(eq(weldJoints.id, source.id))
      await db.update(weldJoints).set({ weldDate: '2026-11-02', vikResult: 'годен' }).where(eq(weldJoints.id, child.id))
      await db.update(weldJointProgramStates).set({ kind: 'repair', physicalRootId: source.id, sourceRowId: source.id }).where(eq(weldJointProgramStates.weldJointId, child.id))
    })
    const repairDrawing = await drawingFor(repair.program, [source.id])
    const repairPoint = (await points(repairDrawing))[0].points[0]
    assert.equal(repairPoint.joint.label, 'S9R1'); assert.equal(repairPoint.joint.rowId, child.id); assert.equal(repairPoint.joint.color, 'good')
    const beforeGuard = await snapshot(repairDrawing, repair.rows.map(row => row.id))
    await assert.rejects(async () => remove('bulk', await versions([source.id, peer.id])), /Нельзя удалить предшественника/)
    assert.deepEqual(await snapshot(repairDrawing, repair.rows.map(row => row.id)), beforeGuard)
    await remove('single', await versions([child.id]))
    const restored = (await points(repairDrawing))[0].points[0]
    assert.equal(restored.id, repairPoint.id); assert.equal(restored.physicalId, repairPoint.physicalId)
    assert.equal(restored.joint.label, 'S9'); assert.equal(restored.joint.rowId, source.id); assert.equal(restored.joint.color, 'rejected')
    checks.push('predecessor-guard-atomicity', 'repair-deletion-restores-live-representative')

    const moved = await seedLine('move-source', ['S20']), destination = await seedLine('move-target', [])
    const moveDrawing = await drawingFor(moved.program, [moved.rows[0].id])
    const beforeMove = (await points(moveDrawing))[0].points[0]
    await updateWeldJoint({ data: { id: moved.rows[0].id, expectedVersion: (await versions([moved.rows[0].id]))[0].version,
      projectTitle: project, subtitleCode: destination.program.subtitleCode, line: destination.program.line } })
    const afterMove = (await points(moveDrawing))[0].points[0]
    assert.equal(afterMove.physicalId, beforeMove.physicalId); assert.equal(afterMove.joint.label, 'S20')
    assert.equal(afterMove.joint.color, 'inactive'); assert.match(afterMove.joint.reason, /перенесён/)
    const [movedRow] = await db.select().from(weldJoints).where(eq(weldJoints.id, moved.rows[0].id))
    assert.equal(movedRow.lineProgramId, destination.program.id)
    const targetDrawing = await drawingFor(destination.program, [])
    assert.equal((await points(targetDrawing))[0].points.length, 0)
    await deleteLine(moved.program.id)
    await assertFilesSurviveDeletedLine(moveDrawing, moved.program.line)
    checks.push('real-move-keeps-source-point-without-target-placement')

    // Unlike the existing officiality/deletion suite, this fixture already has
    // durable PDF members. Both rebuild directions and the next real repair
    // must therefore exercise the new membership hook rather than its no-op.
    const rebuilt = await seedLine('official-rebuild', ['S41', 'S41R1', 'F42'])
    const [original, repaired] = rebuilt.rows, rebuiltIds = rebuilt.rows.map(row => row.id)
    await fixture(async () => {
      for (const [index, row] of rebuilt.rows.entries()) {
        const date = `2026-10-0${index + 1}`
        await db.update(weldJoints).set({ weldDate: date, d1: 108, d2: 108, t1: 4, t2: 4,
          materialGroup: 'М01', weldingMethod: 'РД', stamp1K: 'SCHEME-QA',
          vikRequest: `SCHEME-VIK-R-${row.id}`, vikRequestDate: date, vikResult: 'годен', vikConclusion: `SCHEME-VIK-C-${row.id}`, vikConclusionDate: date,
          hasUzk: index < 2 ? 'да' : null, uzkRequest: index < 2 ? `SCHEME-UZK-R-${row.id}` : null, uzkRequestDate: index < 2 ? date : null,
          uzkResult: index < 2 ? 'ремонт' : null, uzkConclusion: index < 2 ? `SCHEME-UZK-C-${row.id}` : null, uzkConclusionDate: index < 2 ? date : null,
        }).where(eq(weldJoints.id, row.id))
      }
      await db.update(weldJointProgramStates).set({ kind: 'repair', physicalRootId: original.id, sourceRowId: original.id }).where(eq(weldJointProgramStates.weldJointId, repaired.id))
    })
    await syncFixtureDocuments(rebuiltIds)
    const rebuiltDrawing = await drawingFor(rebuilt.program, [original.id], true), originalPoints = await points(rebuiltDrawing)
    const originalPhysicalId = originalPoints[0].points[0].physicalId
    const originalQuota = await quota(rebuilt.program), originalLinks = await documentLinks(rebuiltIds), originalFacts = await controlFacts(rebuiltIds)
    assert(originalLinks.length > 0); assert(originalQuota.length > 0)
    await assertSameDrawing(rebuiltDrawing, originalPoints, repaired.id, 'S41R1', 'rejected')
    for (const officiality of ['unofficial', 'official'] as const) {
      const targets = await versions([original.id])
      const plan = await previewLnkOfficialityChange({ data: { targets, officiality } })
      assert(plan.renames.some(change => change.rowId === repaired.id), 'The fixture must really rebuild the existing repair')
      await applyLnkOfficialityChange({ data: { targets, officiality, expectedPlanKey: plan.planKey } })
      await assertSameDrawing(rebuiltDrawing, originalPoints, repaired.id, officiality === 'unofficial' ? 'S41' : 'S41R1', 'rejected')
      assert.deepEqual(await controlFacts(rebuiltIds), originalFacts)
      assert.deepEqual(await documentLinks(rebuiltIds), originalLinks)
    }
    assert.deepEqual(await quota(rebuilt.program), originalQuota, 'Restoring officiality restores the original quota, not a second physical place')
    const [future] = await createWeldJoints({ data: { source: (await versions([repaired.id]))[0], targetJoints: ['S41R2'] } })
    const [futureMember] = await db.select().from(lineSchemeMembers).where(eq(lineSchemeMembers.weldJointId, future.id))
    assert.equal(futureMember?.physicalId, originalPhysicalId)
    await assertSameDrawing(rebuiltDrawing, originalPoints, future.id, 'S41R2', 'rejected')
    assert.deepEqual(await quota(rebuilt.program), originalQuota, 'A future R must not increase the physical quota or primary rejection count')
    await remove('single', await versions([future.id]))
    await assertSameDrawing(rebuiltDrawing, originalPoints, repaired.id, 'S41R1', 'rejected')
    assert.deepEqual(await quota(rebuilt.program), originalQuota)
    assert.deepEqual(await documentLinks(rebuiltIds), originalLinks)
    const afterTailDeletion = await assertSp09(repaired.id, true)
    assert.equal(afterTailDeletion.repeatedJointTasks.filter(task => task.kind === 'create' && task.row.id === repaired.id && task.targetJoint === 'S41R2').length, 1,
      'Deleting the tail restores one real continuation task, not a stale identity warning')
    checks.push('placed-identity-survives-officiality-rebuild-and-next-repair', 'placed-tail-deletion-keeps-quota-documents-and-dispatcher')

    // Recorded replacement is monotonic under ordinary deletion. Its explicit
    // SP-09 correction must revive the same saved point in both PDF editions.
    const restoredLine = await seedLine('coil-restoration', ['S51', 'F52']), [restorationRoot] = restoredLine.rows
    const restorationIds = restoredLine.rows.map(row => row.id)
    await fixture(async () => {
      for (const row of restoredLine.rows) await db.update(weldJoints).set({ weldDate: '2026-10-01',
        stamp1K: 'SCHEME-RESTORE', hasUzk: 'да', vikResult: 'годен', vikRequest: `SCHEME-RESTORE-VIK-R-${row.id}`, vikRequestDate: '2026-10-01',
        vikConclusion: `SCHEME-RESTORE-VIK-C-${row.id}`, vikConclusionDate: '2026-10-01',
        uzkResult: 'годен', uzkRequest: `SCHEME-RESTORE-UZK-R-${row.id}`, uzkRequestDate: '2026-10-01',
        uzkConclusion: `SCHEME-RESTORE-UZK-C-${row.id}`, uzkConclusionDate: '2026-10-01',
      }).where(eq(weldJoints.id, row.id))
    })
    await syncFixtureDocuments(restorationIds)
    const restorationDrawing = await drawingFor(restoredLine.program, [restorationRoot.id], true), restorationPoints = await points(restorationDrawing)
    const restorationQuota = await quota(restoredLine.program), restorationLinks = await documentLinks(restorationIds), restorationFacts = await controlFacts(restorationIds)
    assert(restorationLinks.length > 0)
    await assertSameDrawing(restorationDrawing, restorationPoints, restorationRoot.id, 'S51', 'good')
    // Synthetic erroneous historical entry; normal creation guards are not
    // bypassed by any operator action below. The real correction is tested.
    const erroneousCoils = await fixture(() => db.insert(weldJoints).values([1, 2].map(side => ({ lineProgramId: restoredLine.program.id,
      projectTitle: project, subtitleCode: restoredLine.program.subtitleCode, line: restoredLine.program.line, joint: `S51Y${side}`,
      connectionType: 'С17', officiality: 'действующий', revisionActuality: 'актуальная', weldDate: '2026-10-02', hasVik: 'да', pstoRequired: 'Нет',
    }))).returning())
    await syncFixtureDocuments(erroneousCoils.map(row => row.id))
    await assertSameDrawing(restorationDrawing, restorationPoints, restorationRoot.id, 'S51', 'inactive')
    await remove('bulk', await versions(erroneousCoils.map(row => row.id)))
    await assertSameDrawing(restorationDrawing, restorationPoints, restorationRoot.id, 'S51', 'inactive')
    await assertSp09(restorationRoot.id, true)
    // Call the same server transaction as the route, keeping its access check;
    // tsx does not apply TanStack's server-function transport transform.
    await assertSecurityScope('entry')
    const correction = await db.transaction(tx => previewCoilRestorationInTransaction(tx, restorationRoot.id))
    assert.equal(correction.reason, null); assert.equal(correction.before.joints, 1); assert.equal(correction.after.joints, 2)
    await assertSameDrawing(restorationDrawing, restorationPoints, restorationRoot.id, 'S51', 'inactive')
    const restoreRequest = { rootId: restorationRoot.id, token: correction.token, confirmedNotInstalled: true }
    await assertSecurityScope('edit')
    assert.equal((await db.transaction(tx => restoreCoilInTransaction(tx, restoreRequest))).alreadyApplied, false)
    assert.equal((await db.transaction(tx => restoreCoilInTransaction(tx, restoreRequest))).alreadyApplied, true)
    assert.equal((await db.select().from(coilRestorationEvents).where(eq(coilRestorationEvents.sourceWeldJointId, restorationRoot.id))).length, 1)
    await assertSameDrawing(restorationDrawing, restorationPoints, restorationRoot.id, 'S51', 'good')
    assert.deepEqual(await quota(restoredLine.program), restorationQuota)
    assert.deepEqual(await documentLinks(restorationIds), restorationLinks)
    assert.deepEqual(await controlFacts(restorationIds), restorationFacts)
    await assertSp09(restorationRoot.id, false)
    checks.push('placed-point-revives-only-after-confirmed-coil-restoration', 'restoration-preserves-quota-documents-and-dispatcher')
  })
  console.log(JSON.stringify({ journalSchemeContracts: checks.length, checks, realJournalDeletes: true,
    lateAtomicRollback: true, namesakeIsolation: true, repairRestoration: true, deletedLineFiles: true, realRenameAndMove: true }))
} finally {
  try { await fixture(() => cleanupLineSchemeProjects([project])) }
  finally { await closeDatabase() }
}
