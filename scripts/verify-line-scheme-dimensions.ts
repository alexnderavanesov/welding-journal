import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { dirname, basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { PDFDocument } from 'pdf-lib'
import { eq, inArray } from 'drizzle-orm'
import { assertSafeE2eDatabaseUrl } from '../e2e/database'
import type { SchemeAnnotation, SchemeChanges, SchemeDimension } from '../src/lib/line-schemes'

assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
assert.equal(basename(process.env.LINE_SCHEME_STORAGE_PATH ?? ''), 'line-schemes')
assert((await realpath(dirname(process.env.LINE_SCHEME_STORAGE_PATH!))).startsWith(join(await realpath(tmpdir()), 'welding-e2e-templates-')))
const { schemeDimensionPair } = await import('../src/lib/line-schemes')
const { requireDb, closeDatabase } = await import('../src/db')
const { cleanupLineSchemeProjects } = await import('../e2e/line-scheme-fixtures')
const { authUsers, linePrograms, weldJoints, weldJointProgramStates, lineSchemeAnnotations, lineSchemeDimensions, lineSchemeRevisions } = await import('../src/db/schema')
const { runWithAccess, toAccessIdentity, accessContext } = await import('../src/server/access-context')
const { openScheme, saveSchemePoints, prepareSchemeUpload, publishSchemeFile, updateSchemeRevisionNumber, changeSchemeRevision, updateSchemeLease } = await import('../src/server/line-scheme-write')
const { readSchemeBundle, readSchemePointPage } = await import('../src/server/line-scheme-read')
const { createSchemeFileStore } = await import('../src/server/line-scheme-files')
const db = requireDb(), store = createSchemeFileStore(process.env.LINE_SCHEME_STORAGE_PATH!)
const [owner] = await db.select().from(authUsers).where(eq(authUsers.role, 'owner'))
assert(owner)
const fixture = <T>(run: () => Promise<T>) => accessContext.exit(run)
const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage(); const bytes = await pdf.save()
let checks = 0
const accountIds: string[] = []
try {
  await runWithAccess(toAccessIdentity(owner), 'scheme-dimensions-test', [], async () => {
    const [line] = await fixture(() => db.insert(linePrograms).values({ projectTitle: 'E2E manual dimensions', subtitleCode: 'DIM', line: 'D', pstoAssignment: 'unassigned' }).returning())
    const joints = await fixture(() => db.insert(weldJoints).values([1, 2, 3].map(n => ({ lineProgramId: line.id, projectTitle: line.projectTitle, subtitleCode: 'DIM', line: 'D', joint: `S${n}`, officiality: 'действующий', revisionActuality: 'актуальная', connectionType: 'С' }))).returning())
    await db.insert(weldJointProgramStates).values(joints.map(row => ({ weldJointId: row.id, kind: 'primary' as const, physicalRootId: row.id })))
    const token = randomUUID(), opened = await openScheme({ lineId: line.id, token }), bundleId = opened.bundle!.id
    const request = async () => ({ bundleId, token, version: (await readSchemeBundle(db, bundleId)).version, operationId: randomUUID() })
    const upload = async () => {
      const data = { ...await request(), replace: 'archive' as const }, key = await prepareSchemeUpload(data)
      const stored = await store.write(key, new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
      return publishSchemeFile({ ...data, fileKey: key, fileName: 'Dimensions.pdf', ...stored, pageCount: await store.validate(key) })
    }
    const original = await upload(), revisionId = original.revisionId
    const read = async () => { const { updatedAt, ...state } = await readSchemePointPage({ revisionId, page: 1 }); return { ...state, dimensions: state.dimensions.map(({ fromAnnotationId, toAnnotationId, ...d }) => ({ ...d, ...(fromAnnotationId ? { fromAnnotationId } : {}), ...(toAnnotationId ? { toAnnotationId } : {}) })) } }
    const saveRequest = async (changes: SchemeChanges) => ({ ...await request(), revisionId, revisionVersion: (await read()).version, changes })
    const points = joints.map((row, i) => ({ id: randomUUID(), rootId: row.id, page: 1, x: .2 + i * .2, y: .5 }))
    const pair = [points[0].id, points[1].id].sort()
    const dim: SchemeDimension = { color: '#64748b', strokeWidth: 1.5, id: randomUUID(), fromPointId: pair[0], toPointId: pair[1], page: 1, distanceMm: 1234.5, offsetX: 0, offsetY: -.1 }
    const first = await saveRequest({ upsert: points, remove: [], dimensions: { upsert: [dim], remove: [] } })
    const saved = await saveSchemePoints(first)
    assert.deepEqual(await saveSchemePoints(first), saved)
    assert.deepEqual((await read()).dimensions, [dim]); checks++
    await assert.rejects(() => saveSchemePoints({ ...first, operationId: randomUUID() }), /уже изменена/)
    await assert.rejects(() => saveSchemePoints({ ...first, changes: { ...first.changes, dimensions: { upsert: [{ ...dim, distanceMm: 2 }], remove: [] } } }), /уже использован/); checks++
    // An invalid dimension must roll back point moves and the revision version.
    const before = await read()
    for (const invalid of [{ ...dim, toPointId: randomUUID() }, { ...dim, page: 2 }]) {
      const req = await saveRequest({ upsert: [{ ...points[0], x: .9 }], remove: [], dimensions: { upsert: [invalid], remove: [] } })
      await assert.rejects(() => saveSchemePoints(req))
      assert.deepEqual(await read(), before)
    }
    const movePage = await saveRequest({ upsert: [{ ...points[0], page: 2 }], remove: [] })
    await assert.rejects(() => saveSchemePoints(movePage), /одного листа/)
    assert.deepEqual(await read(), before); checks++
    const duplicate = await saveRequest({ upsert: [], remove: [], dimensions: { upsert: [{ ...dim, id: randomUUID() }], remove: [] } })
    await assert.rejects(() => saveSchemePoints(duplicate)); assert.deepEqual(await read(), before); checks++
    await saveSchemePoints(await saveRequest({ upsert: [{ ...points[0], x: .25 }], remove: [] }))
    assert.equal((await read()).dimensions[0].distanceMm, 1234.5)
    const changed = { ...dim, distanceMm: 40.25, offsetY: -.2 }
    await saveSchemePoints(await saveRequest({ upsert: [], remove: [], dimensions: { upsert: [changed], remove: [] } }))
    assert.deepEqual((await read()).dimensions, [changed]); checks++
    // Metadata is independent of the file, points and their version.
    const originalRevision = (await db.select().from(lineSchemeRevisions).where(eq(lineSchemeRevisions.id, revisionId)))[0]
    const numberRequest = { ...await request(), revisionId, changeNumber: ' 02.1 ' }
    const numberResult = await updateSchemeRevisionNumber(numberRequest)
    assert.deepEqual(await updateSchemeRevisionNumber(numberRequest), numberResult)
    await assert.rejects(() => updateSchemeRevisionNumber({ ...numberRequest, operationId: randomUUID() }), /изменился/)
    const numbered = (await db.select().from(lineSchemeRevisions).where(eq(lineSchemeRevisions.id, revisionId)))[0]
    assert.deepEqual(numbered, { ...originalRevision, changeNumber: '02.1' }); checks++
    const next = await upload()
    assert.deepEqual((await read()).dimensions, [changed])
    const archivedWrite = await saveRequest({ upsert: [], remove: [], dimensions: { upsert: [{ ...changed, distanceMm: 999 }], remove: [] } })
    await assert.rejects(() => saveSchemePoints(archivedWrite), /основной редакции/)
    await updateSchemeRevisionNumber({ ...await request(), revisionId, changeNumber: null })
    assert.equal((await readSchemeBundle(db, bundleId)).revisions.find(item => item.id === revisionId)!.changeNumber, null); checks++
    const foreign = { ...await request(), revisionId: next.revisionId, revisionVersion: 1, changes: { upsert: [], remove: [], dimensions: { upsert: [changed], remove: [] } } }
    await assert.rejects(() => saveSchemePoints(foreign), /другой редакции/)
    const missingRevision = { ...await request(), revisionId: randomUUID(), changeNumber: '1' }
    await assert.rejects(() => updateSchemeRevisionNumber(missingRevision), /больше не существует/); checks++
    await changeSchemeRevision({ ...await request(), revisionId, action: 'activate' })
    assert.deepEqual((await read()).dimensions, [changed])
    const deletePoint = await saveRequest({ upsert: [], remove: [points[0].id] })
    const deletion = await saveSchemePoints(deletePoint)
    assert.deepEqual(await saveSchemePoints(deletePoint), deletion)
    assert.equal((await read()).points.length, 2); assert.equal((await read()).dimensions.length, 0); checks++
    // Restore and explicitly remove only the dimension, preserving its points.
    await saveSchemePoints(await saveRequest({ upsert: [points[0]], remove: [], dimensions: { upsert: [dim], remove: [] } }))
    await saveSchemePoints(await saveRequest({ upsert: [], remove: [], dimensions: { upsert: [], remove: [dim.id] } }))
    assert.equal((await read()).points.length, 3); assert.equal((await read()).dimensions.length, 0)
    await saveSchemePoints(await saveRequest({ upsert: [], remove: [], dimensions: { upsert: [dim], remove: [] } })); checks++
    // Symbols never create physical joints. Both endpoint kinds share the
    // locked save, cascading deletion, archive, lease and receipt rules.
    const annotations: SchemeAnnotation[] = ['dot', 'triangle', 'line'].map((shape, i) => ({ id: randomUUID(), page: 1, x: .2 + i * .2, y: .7, shape: shape as SchemeAnnotation['shape'], label: `Опора ${i + 1}`, note: i === 0 ? "Проверить крепление\nПосле монтажа" : "", color: '#0284c7', size: 24, strokeWidth: 2, rotation: 45 }))
    const mixed: SchemeDimension = { ...dim, color: '#dc2626', strokeWidth: 3, id: randomUUID(), ...schemeDimensionPair(`a:${annotations[0].id}`, `p:${points[0].id}`) }
    const symbolPair: SchemeDimension = { ...dim, id: randomUUID(), ...schemeDimensionPair(`a:${annotations[0].id}`, `a:${annotations[1].id}`) }
    const symbolsRequest = await saveRequest({ upsert: [], remove: [], annotations: { upsert: annotations, remove: [] }, dimensions: { upsert: [mixed, symbolPair], remove: [] } })
    const symbolsResult = await saveSchemePoints(symbolsRequest)
    assert.deepEqual(await saveSchemePoints(symbolsRequest), symbolsResult)
    assert.equal((await read()).points.length, 3); assert.equal((await read()).annotations.length, 3); assert.equal((await read()).dimensions.length, 3); checks++
    assert.equal((await read()).annotations.find(a => a.id === annotations[0].id)?.note, annotations[0].note)
    assert.equal((await read()).dimensions.find(d => d.id === mixed.id)?.color, '#dc2626')
    assert.equal((await read()).dimensions.find(d => d.id === mixed.id)?.strokeWidth, 3)
    const symbolsBefore = await read()
    const badMoves: SchemeChanges[] = [
      { upsert: [], remove: [], annotations: { upsert: [{ ...annotations[0], note: 'x'.repeat(1001) }], remove: [] } },
      { upsert: [], remove: [], dimensions: { upsert: [{ ...mixed, color: 'url(https://example.invalid)' }], remove: [] } },
      { upsert: [], remove: [], dimensions: { upsert: [{ ...mixed, strokeWidth: 50 }], remove: [] } },
      { upsert: [], remove: [], annotations: { upsert: [{ ...annotations[0], page: 2 }], remove: [] } },
      { upsert: [], remove: [], annotations: { upsert: [], remove: [annotations[0].id] }, dimensions: { upsert: [mixed], remove: [] } },
      { upsert: [], remove: [], annotations: { upsert: [{ ...annotations[0], x: .9 }], remove: [] }, dimensions: { upsert: [{ ...mixed, toPointId: points[2].id }], remove: [] } },
    ]
    for (const changes of badMoves) { await assert.rejects(async () => saveSchemePoints(await saveRequest(changes))); assert.deepEqual(await read(), symbolsBefore) }
    checks++
    const symbolArchive = await upload()
    assert.equal((await read()).annotations.length, 3)
    await assert.rejects(async () => saveSchemePoints(await saveRequest({ upsert: [], remove: [], annotations: { upsert: [{ ...annotations[0], label: 'Changed archive' }], remove: [] } })), /основной редакции/)
    await assert.rejects(async () => saveSchemePoints({ ...await request(), revisionId: symbolArchive.revisionId, revisionVersion: 1, changes: { upsert: [], remove: [], annotations: { upsert: [annotations[0]], remove: [] } } }), /другой редакции/)
    await changeSchemeRevision({ ...await request(), revisionId, action: 'activate' })
    await saveSchemePoints(await saveRequest({ upsert: [], remove: [], annotations: { upsert: [{ ...annotations[1], rotation: 90, size: 32 }], remove: [annotations[0].id] } }))
    const afterSymbolDelete = await read()
    assert.equal(afterSymbolDelete.annotations.length, 2); assert.equal(afterSymbolDelete.dimensions.length, 1); assert.equal(afterSymbolDelete.dimensions[0].id, dim.id); assert.equal(afterSymbolDelete.points.length, 3)
    checks++
    const [viewer] = await fixture(() => db.insert(authUsers).values({ id: randomUUID(), email: `${randomUUID()}@e2e.test`, name: 'Dimension viewer', status: 'active', emailVerified: true, permissions: ['schemes.view'] }).returning())
    accountIds.push(viewer.id)
    const guarded = await saveRequest({ upsert: [], remove: [], dimensions: { upsert: [], remove: [dim.id] } })
    const metadata = { ...await request(), revisionId, changeNumber: '9' }
    await runWithAccess(toAccessIdentity(viewer), 'view-only', [], async () => {
      await assert.rejects(() => saveSchemePoints(guarded), /Недостаточно прав/)
      await assert.rejects(() => updateSchemeRevisionNumber(metadata), /Недостаточно прав/)
    })
    await updateSchemeLease({ bundleId, token, release: true })
    await assert.rejects(() => saveSchemePoints(guarded), /потеряно/)
    await assert.rejects(() => updateSchemeRevisionNumber(metadata), /потеряно/)
    await openScheme({ lineId: line.id, token }); checks++
    await changeSchemeRevision({ ...await request(), revisionId, action: 'delete' })
    assert.equal((await db.select().from(lineSchemeAnnotations).where(eq(lineSchemeAnnotations.revisionId, revisionId))).length, 0)
    assert.equal((await db.select().from(lineSchemeDimensions).where(eq(lineSchemeDimensions.revisionId, revisionId))).length, 0)
    assert.equal((await db.select().from(weldJoints).where(eq(weldJoints.lineProgramId, line.id))).length, 3); checks++
  })
  process.stdout.write(JSON.stringify({ dimensionContracts: checks }))
} finally {
  try {
    await fixture(() => cleanupLineSchemeProjects(['E2E manual dimensions']))
    if (accountIds.length) await fixture(() => db.delete(authUsers).where(inArray(authUsers.id, accountIds)))
  } finally { await closeDatabase() }
}
