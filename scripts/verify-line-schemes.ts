import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { chmod, stat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, basename, join } from 'node:path'
import { eq, and, inArray } from 'drizzle-orm'
import { assertSafeE2eDatabaseUrl } from '../e2e/database'

assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
if (!process.env.LINE_SCHEME_STORAGE_PATH?.includes('welding-e2e-')) throw new Error('Disposable PDF directory is required.')
assert.equal(basename(process.env.LINE_SCHEME_STORAGE_PATH), 'line-schemes')
assert((await realpath(dirname(process.env.LINE_SCHEME_STORAGE_PATH))).startsWith(join(await realpath(tmpdir()), 'welding-e2e-templates-')))
const { requireDb, closeDatabase } = await import('../src/db')
const { cleanupLineSchemeProjects } = await import('../e2e/line-scheme-fixtures')
const { authUsers, linePrograms, weldJoints, weldJointProgramStates, lineSchemeBundles, lineSchemeFiles, lineSchemePoints, lineSchemeRevisions, lineSchemeReceipts, lineSchemePhysicals, lineSchemeMembers } = await import('../src/db/schema')
const { runWithAccess, toAccessIdentity, accessContext } = await import('../src/server/access-context')
const { openScheme, prepareSchemeUpload, publishSchemeFile, saveSchemePoints, changeSchemeRevision, updateSchemeLease, cleanupSchemeFiles } = await import('../src/server/line-scheme-write')
const { handleSchemeFile } = await import('../src/server/line-scheme-http')
const { readSchemePointPage, readSchemeBundle, readSchemeLines, readSchemeFilterOptions } = await import('../src/server/line-scheme-read')
const { createSchemeFileStore } = await import('../src/server/line-scheme-files')
const db = requireDb(), store = createSchemeFileStore(process.env.LINE_SCHEME_STORAGE_PATH!)
const [user] = await db.select().from(authUsers).where(eq(authUsers.role, 'owner'))
assert(user, 'Prepared E2E owner is required')
const actor = toAccessIdentity(user), token = randomUUID(), secondToken = randomUUID()
const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage(); const bytes = await pdf.save()
let checks = 0
const accountIds: string[] = []
const check = () => { checks++ }
// Synthetic setup only, on the verified disposable target. Actual scheme
// commands below keep their normal current-actor and transaction guards.
const fixture = <T>(run: () => Promise<T>) => accessContext.exit(run)
try {
  await runWithAccess(actor, 'line-scheme-integration', [], async () => {
    const lines = await fixture(async () => db.insert(linePrograms).values(['A', 'B'].map(line => ({ projectTitle: 'E2E scheme contracts', subtitleCode: 'API', line, pstoAssignment: 'unassigned' as const }))).returning())
    const joints = await fixture(async () => db.insert(weldJoints).values(lines.map(line => ({ lineProgramId: line.id, projectTitle: line.projectTitle, subtitleCode: line.subtitleCode, line: line.line, joint: 'S1', officiality: 'действующий', revisionActuality: 'актуальная', connectionType: 'С', weldDate: '2026-11-01', hasVik: 'Да', pstoRequired: 'Нет' }))).returning())
    await db.insert(weldJointProgramStates).values(joints.map(row => ({ weldJointId: row.id, kind: 'primary', physicalRootId: row.id })))
    const opened = await openScheme({ lineId: lines[0].id, token }), bundleId = opened.bundle!.id
    assert(opened.lease.owned); assert.equal((await openScheme({ lineId: lines[0].id, token: secondToken })).lease.owned, false); check()
    const upload = async (id: number, version: number, lockToken = token, replace: 'archive' | 'delete' = 'archive') => {
      const data = { bundleId: id, version, token: lockToken, operationId: randomUUID(), replace }
      const key = await prepareSchemeUpload(data)
      const stored = await store.write(key, new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
      const payload = { ...data, fileKey: key, fileName: 'Fixture.pdf', changeNumber: '01', ...stored, pageCount: await store.validate(key) }
      const result = await publishSchemeFile(payload)
      assert.deepEqual(await publishSchemeFile(payload), result)
      assert.equal((await readSchemeBundle(db, id)).revisions.find(item => item.id === result.revisionId)?.changeNumber, '01')
      await assert.rejects(() => publishSchemeFile({ ...payload, changeNumber: '02' }), /уже использован/)
      return result
    }
    const placedCount = async () => (await readSchemeLines({ filters: { projectTitle: ['E2E scheme contracts'], line: ['A'] } })).rows[0].placedCount
    assert.equal(await placedCount(), 0)
    const original = await upload(bundleId, opened.bundle!.version)
    const point = { id: randomUUID(), rootId: joints[0].id, page: 1, x: .123456789, y: .876543219 }
    const save = { bundleId, token, version: original.version, operationId: randomUUID(), revisionId: original.revisionId, revisionVersion: 1, changes: { upsert: [point], remove: [] as string[] } }
    const saved = await saveSchemePoints(save)
    assert.equal(await placedCount(), 1)
    assert.equal(saved.revisionVersion, 2); assert.deepEqual(await saveSchemePoints(save), saved)
    const read = await readSchemePointPage({ revisionId: original.revisionId, page: 1 }); assert.equal(read.points[0].x, point.x); assert.equal(read.points[0].joint.label, 'S1'); check()
    await assert.rejects(() => saveSchemePoints({ ...save, changes: { ...save.changes, upsert: [{ ...point, x: .5 }] } }), /уже использован/)
    await assert.rejects(() => saveSchemePoints({ ...save, operationId: randomUUID() }), /уже изменена/)
    await assert.rejects(() => saveSchemePoints({ ...save, operationId: randomUUID(), revisionVersion: 2, changes: { upsert: [{ ...point, id: randomUUID(), page: 2 }], remove: [] } }), /уже размещён/); check()
    const archive = await upload(bundleId, original.version)
    assert.equal(await placedCount(), 0) // archived coordinates do not count
    assert.equal((await readSchemePointPage({ revisionId: archive.revisionId, page: 1 })).points.length, 0)
    await fixture(async () => db.update(weldJoints).set({ joint: 'S1-corrected', vikResult: 'Годен' }).where(eq(weldJoints.id, joints[0].id)))
    assert.equal((await readSchemePointPage({ revisionId: original.revisionId, page: 1 })).points[0].joint.label, 'S1-corrected'); check()
    await assert.rejects(() => saveSchemePoints({ ...save, version: archive.version, revisionVersion: 2, operationId: randomUUID() }), /основной редакции/)
    const activate = await changeSchemeRevision({ bundleId, token, version: archive.version, operationId: randomUUID(), revisionId: original.revisionId, action: 'activate' })
    assert.equal((await readSchemeBundle(db, bundleId)).activeRevisionId, original.revisionId); assert.equal(await placedCount(), 1); check()
    await db.update(lineSchemeBundles).set({ lockExpiresAt: new Date(Date.now() - 1000) }).where(eq(lineSchemeBundles.id, bundleId))
    assert.equal((await updateSchemeLease({ bundleId, token })).owned, false)
    assert.equal((await openScheme({ lineId: lines[0].id, token: secondToken })).lease.owned, true)
    await assert.rejects(() => saveSchemePoints({ ...save, version: activate.version, revisionVersion: 2, operationId: randomUUID() }), /потеряно/); check()
    const other = await openScheme({ lineId: lines[1].id, token }), otherPdf = await upload(other.bundle!.id, other.bundle!.version)
    const collisionId = randomUUID()
    const outcomes = await Promise.allSettled([
      saveSchemePoints({ bundleId, token: secondToken, version: activate.version, operationId: randomUUID(), revisionId: original.revisionId, revisionVersion: 2,
        changes: { upsert: [{ ...point, id: collisionId }], remove: [point.id] } }),
      saveSchemePoints({ bundleId: other.bundle!.id, token, version: otherPdf.version, operationId: randomUUID(), revisionId: otherPdf.revisionId, revisionVersion: 1,
        changes: { upsert: [{ ...point, id: collisionId, rootId: joints[1].id, x: .8 }], remove: [] } }),
    ])
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
    const [collision] = await db.select().from(lineSchemePoints).where(eq(lineSchemePoints.id, collisionId))
    assert.equal(collision.x, collision.revisionId === original.revisionId ? point.x : .8); check()
    const [viewer] = await fixture(async () => db.insert(authUsers).values({ id: randomUUID(), email: `${randomUUID()}@e2e.test`, name: 'Only scheme viewer', emailVerified: true, status: 'active', permissions: ['schemes.view'] }).returning())
    accountIds.push(viewer.id)
    await runWithAccess(toAccessIdentity(viewer), 'scheme-viewer', [], async () => {
      assert.equal((await openScheme({ lineId: lines[1].id, token: randomUUID() })).lease.owned, false)
      await assert.rejects(() => saveSchemePoints({ ...save, operationId: randomUUID() }), /Недостаточно прав/)
      await assert.rejects(() => changeSchemeRevision({ bundleId: other.bundle!.id, token, version: otherPdf.version, operationId: randomUUID(), revisionId: otherPdf.revisionId, action: 'delete' }), /Недостаточно прав/)
    }); check()
    const [editor] = await fixture(async () => db.insert(authUsers).values({ id: randomUUID(), email: `${randomUUID()}@e2e.test`, name: 'Scheme editor without file deletion', emailVerified: true, status: 'active', permissions: ['schemes.view', 'schemes.edit'] }).returning())
    accountIds.push(editor.id)
    await updateSchemeLease({ bundleId, token: secondToken, release: true })
    await runWithAccess(toAccessIdentity(editor), 'scheme-editor', [], async () => {
      const editorToken = randomUUID(), current = await openScheme({ lineId: lines[0].id, token: editorToken })
      assert(current.lease.owned)
      const request = { bundleId, token: editorToken, version: current.bundle!.version, operationId: randomUUID() }
      await assert.rejects(() => prepareSchemeUpload({ ...request, replace: 'delete' }), /Недостаточно прав/)
      await assert.rejects(() => changeSchemeRevision({ ...request, revisionId: original.revisionId, action: 'delete' }), /Недостаточно прав/)
      const points = await readSchemePointPage({ revisionId: original.revisionId, page: 1 })
      assert.equal(points.points.length, 1)
      await saveSchemePoints({ ...request, revisionId: original.revisionId, revisionVersion: points.version, changes: { upsert: [], remove: [points.points[0].id] } })
      assert.equal((await readSchemePointPage({ revisionId: original.revisionId, page: 1 })).points.length, 0)
      assert.equal(await placedCount(), 0)
      assert.equal((await db.select().from(weldJoints).where(eq(weldJoints.id, joints[0].id))).length, 1)
      await updateSchemeLease({ bundleId, token: editorToken, release: true })
    }); check()
    assert((await openScheme({ lineId: lines[0].id, token: secondToken })).lease.owned)
    // Renaming the stable line updates every revision without touching its PDF.
    await fixture(async () => db.update(linePrograms).set({ line: 'A-renamed' }).where(eq(linePrograms.id, lines[0].id)))
    assert.equal((await readSchemeBundle(db, bundleId)).line, 'A-renamed')
    const listed = await readSchemeLines({ search: 'E2E scheme contracts' }); assert.equal(listed.total, 2); assert.equal(listed.rows.find(row => row.lineId === lines[0].id)?.welded, 1); check()
    const beforeDelete = await readSchemeBundle(db, bundleId)
    await changeSchemeRevision({ bundleId, token: secondToken, version: beforeDelete.version, operationId: randomUUID(), revisionId: original.revisionId, action: 'delete' })
    const afterDelete = await readSchemeBundle(db, bundleId)
    assert.equal(afterDelete.activeRevisionId, null); assert.equal(afterDelete.revisions.length, 1)
    assert.equal((await db.select().from(weldJoints).where(eq(weldJoints.id, joints[0].id))).length, 1)
    assert.equal((await db.select().from(lineSchemePoints).where(eq(lineSchemePoints.revisionId, original.revisionId))).length, 0)
    assert((await db.select().from(lineSchemeReceipts).where(eq(lineSchemeReceipts.bundleId, bundleId))).length >= 5); check()
    assert.equal((await db.select().from(lineSchemeRevisions).where(and(eq(lineSchemeRevisions.bundleId, bundleId), eq(lineSchemeRevisions.id, archive.revisionId)))).length, 1)
    const replacement = await upload(other.bundle!.id, otherPdf.version, token, 'delete')
    assert.equal((await db.select().from(lineSchemeRevisions).where(eq(lineSchemeRevisions.id, otherPdf.revisionId))).length, 0)
    assert.equal((await readSchemePointPage({ revisionId: replacement.revisionId, page: 1 })).points.length, 0); check()
    assert.equal((await readSchemeLines({ filters: { projectTitle: ['E2E scheme contracts'], line: ['B'] } })).rows[0].placedCount, 0)
    // Values beyond the first 50 rows and 100 suggestions remain searchable.
    await fixture(() => db.insert(linePrograms).values(Array.from({ length: 125 }, (_, i) => ({ projectTitle: 'E2E scheme filters', subtitleCode: i < 100 ? 'FIRST' : 'LAST', line: `F-${String(i).padStart(3, '0')}` }))))
    const filterScope = { search: 'E2E scheme filters' }
    assert.equal((await readSchemeLines(filterScope)).total, 125)
    const allValues = await readSchemeFilterOptions({ ...filterScope, field: 'line' })
    assert.equal(allValues.options.length, 100); assert(allValues.hasMore)
    assert.deepEqual((await readSchemeFilterOptions({ ...filterScope, field: 'line', valueSearch: 'F-124' })).options, [{ value: 'F-124', label: 'F-124', count: 1 }])
    const scoped = { ...filterScope, filters: { subtitleCode: ['LAST'], line: ['F-124'] } }
    assert.equal((await readSchemeLines(scoped)).rows[0].line, 'F-124')
    assert.equal((await readSchemeFilterOptions({ ...scoped, field: 'line' })).options.length, 25) // own selection excluded
    assert.equal((await readSchemeFilterOptions({ ...scoped, field: 'projectTitle', valueSearch: '%' })).options.length, 0) // literal wildcard
    await assert.rejects(() => readSchemeFilterOptions({ ...filterScope, field: 'unknown' as never }), /столбец/); check()
    // Percentage excludes annulled and moved physical joints, even when both
    // old/new lines are in the same registry page. Archive points never count.
    await fixture(async () => {
      const [a, b] = await db.insert(linePrograms).values(['PCT-A', 'PCT-B'].map(line => ({ projectTitle: 'E2E scheme percent', line }))).returning()
      const [ba, bb] = await db.insert(lineSchemeBundles).values([a, b].map(line => ({ lineProgramId: line.id, projectTitle: line.projectTitle, subtitleCode: '', line: line.line }))).returning()
      const [live, cancelled, moved] = await db.insert(weldJoints).values([
        { lineProgramId: a.id, line: a.line, joint: 'LIVE', revisionActuality: 'актуальная' },
        { lineProgramId: a.id, line: a.line, joint: 'CANCELLED', revisionActuality: 'не актуален' },
        { lineProgramId: b.id, line: b.line, joint: 'MOVED', revisionActuality: 'актуальная' },
      ].map(row => ({ ...row, projectTitle: a.projectTitle, officiality: 'действующий' }))).returning()
      const physicals = await db.insert(lineSchemePhysicals).values([live, cancelled, moved].map(row => ({ seedNodeId: row.id, lastLabel: row.joint! }))).returning()
      await db.insert(lineSchemeMembers).values(physicals.map(row => ({ weldJointId: row.seedNodeId, physicalId: row.id })))
      await db.insert(weldJointProgramStates).values([live, cancelled, moved].map(row => ({ weldJointId: row.id, kind: 'primary' as const, physicalRootId: row.id })))
      const key = randomUUID(); await db.insert(lineSchemeFiles).values({ key, state: 'ready' })
      const [revision] = await db.insert(lineSchemeRevisions).values({ id: randomUUID(), bundleId: ba.id, fileKey: key, fileName: 'Percent.pdf', size: 10, pageCount: 2, authorId: user.id, authorName: user.name }).returning()
      await db.update(lineSchemeBundles).set({ activeRevisionId: revision.id }).where(eq(lineSchemeBundles.id, ba.id))
      await db.insert(lineSchemePoints).values(physicals.slice(1).map(row => ({ id: randomUUID(), revisionId: revision.id, physicalId: row.id, page: 1, x: .3, y: .3 })))
      let result = await readSchemeLines({ search: a.projectTitle })
      assert.equal(result.rows.find(row => row.bundleId === ba.id)?.placedCount, 2)
      assert.equal(result.rows.find(row => row.bundleId === ba.id)?.placedPercent, 0)
      assert.equal(result.rows.find(row => row.bundleId === bb.id)?.placedPercent, 0)
      await db.insert(lineSchemePoints).values({ id: randomUUID(), revisionId: revision.id, physicalId: physicals[0].id, page: 2, x: .5, y: .5 })
      result = await readSchemeLines({ search: a.projectTitle })
      assert.equal(result.rows.find(row => row.bundleId === ba.id)?.placedCount, 3)
      assert.equal(result.rows.find(row => row.bundleId === ba.id)?.placedPercent, 100)
      await db.update(weldJoints).set({ revisionActuality: 'не актуален' }).where(eq(weldJoints.id, live.id))
      assert.equal((await readSchemeLines({ search: a.projectTitle })).rows.find(row => row.bundleId === ba.id)?.placedPercent, null)
    }); check()
    const [noView] = await fixture(async () => db.insert(authUsers).values({ id: randomUUID(), email: `${randomUUID()}@e2e.test`, name: 'No scheme access', emailVerified: true, status: 'active', permissions: ['welding.view'] }).returning())
    accountIds.push(noView.id)
    const fileUrl = `http://127.0.0.1/api/line-scheme-file?revision=${replacement.revisionId}`
    await runWithAccess(toAccessIdentity(noView), 'scheme-no-view', [], async () => {
      assert.equal((await handleSchemeFile(new Request(fileUrl))).status, 403)
    })
    assert.equal((await handleSchemeFile(new Request(fileUrl, { headers: { 'Sec-Fetch-Site': 'cross-site' } }))).status, 403); check()
    const [file] = await db.select().from(lineSchemeRevisions).where(eq(lineSchemeRevisions.id, replacement.revisionId))
    const directoryMode = (await stat(process.env.LINE_SCHEME_STORAGE_PATH!)).mode & 0o777
    try {
      await chmod(process.env.LINE_SCHEME_STORAGE_PATH!, 0o500)
      // The DB deletion succeeds even if the object cannot yet be removed.
      await changeSchemeRevision({ bundleId: other.bundle!.id, token, version: replacement.version, operationId: randomUUID(), revisionId: replacement.revisionId, action: 'delete' })
      assert.equal((await db.select().from(lineSchemeFiles).where(eq(lineSchemeFiles.key, file.fileKey)))[0].state, 'deleting')
      assert.equal(await store.size(file.fileKey), bytes.length)
    } finally { await chmod(process.env.LINE_SCHEME_STORAGE_PATH!, directoryMode) }
    await cleanupSchemeFiles()
    await assert.rejects(() => store.size(file.fileKey), /ENOENT/)
    assert.equal((await db.select().from(lineSchemeFiles).where(eq(lineSchemeFiles.key, file.fileKey))).length, 0)
    const [retained] = await db.select().from(lineSchemeRevisions).where(eq(lineSchemeRevisions.id, archive.revisionId))
    assert.equal(await store.size(retained.fileKey), bytes.length); check()
    // File deletion is a separate permission, not an implicit editing grant.
    const [deleteLine] = await fixture(async () => db.insert(linePrograms).values({ projectTitle: 'E2E deletion-only scheme', line: 'DELETE-ONLY' }).returning())
    const deleteOpened = await openScheme({ lineId: deleteLine.id, token })
    const deletePdf = await upload(deleteOpened.bundle!.id, deleteOpened.bundle!.version)
    await updateSchemeLease({ bundleId: deleteOpened.bundle!.id, token, release: true })
    const [deleter] = await fixture(async () => db.insert(authUsers).values({ id: randomUUID(), email: `${randomUUID()}@e2e.test`, name: 'Scheme file deleter', emailVerified: true, status: 'active', permissions: ['schemes.view', 'schemes.delete'] }).returning())
    accountIds.push(deleter.id)
    await runWithAccess(toAccessIdentity(deleter), 'scheme-delete-only', [], async () => {
      const deleteToken = randomUUID(), current = await openScheme({ lineId: deleteLine.id, token: deleteToken })
      assert(current.lease.owned)
      const request = { bundleId: current.bundle!.id, token: deleteToken, version: current.bundle!.version, operationId: randomUUID() }
      await assert.rejects(() => prepareSchemeUpload({ ...request, replace: 'archive' }), /Недостаточно прав/)
      await assert.rejects(() => saveSchemePoints({ ...request, revisionId: deletePdf.revisionId, revisionVersion: 1, changes: { upsert: [], remove: [] } }), /Недостаточно прав/)
      await assert.rejects(() => changeSchemeRevision({ ...request, revisionId: deletePdf.revisionId, action: 'activate' }), /Недостаточно прав/)
      await changeSchemeRevision({ ...request, revisionId: deletePdf.revisionId, action: 'delete' })
      assert.equal((await readSchemeBundle(db, request.bundleId)).revisions.length, 0)
    }); check()
  })
  console.log(JSON.stringify({ schemeContracts: checks, leaseAndVersions: true, idempotency: true, crossBundleCollision: true, liveArchive: true, fileIsolation: true }))
} finally {
  try {
    await fixture(() => cleanupLineSchemeProjects(['E2E scheme contracts', 'E2E scheme filters', 'E2E scheme percent', 'E2E deletion-only scheme']))
    if (accountIds.length) await fixture(() => db.delete(authUsers).where(inArray(authUsers.id, accountIds)))
  } finally { await closeDatabase() }
}
