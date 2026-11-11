import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { assertSafeE2eDatabaseUrl } from './database'
import { schemeDimensionPair } from '../src/lib/line-schemes'

assert.equal(process.env.E2E_DATABASE_PROFILE, 'line-scheme-s3-backup')
assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
assert.equal(process.env.LINE_SCHEME_S3_BUCKET, 'welding-journal-schemes-test')
assert.equal(process.env.LINE_SCHEME_STORAGE_DRIVER, 's3')
const { requireDb, closeDatabase } = await import('../src/db')
const { authUsers, linePrograms, weldJoints, weldJointProgramStates } = await import('../src/db/schema')
const { runWithAccess, toAccessIdentity } = await import('../src/server/access-context')
const { openScheme, prepareSchemeUpload, publishSchemeFile, saveSchemePoints, updateSchemeLease } = await import('../src/server/line-scheme-write')
const { getSchemeFileStore } = await import('../src/server/line-scheme-storage')
const db = requireDb(), store = await getSchemeFileStore(), token = randomUUID()
try {
  const [user] = await db.select().from(authUsers).where(eq(authUsers.role, 'owner'))
  assert(user)
  const [line] = await db.insert(linePrograms).values({ projectTitle: 'S3 backup recovery', subtitleCode: 'RESTORE', line: 'BACKUP-01', pstoAssignment: 'unassigned' }).returning()
  const joints = await db.insert(weldJoints).values([1, 2].map(n => ({ lineProgramId: line.id, projectTitle: line.projectTitle,
    subtitleCode: line.subtitleCode, line: line.line, joint: `S${n}`, officiality: 'действующий', revisionActuality: 'актуальная',
    connectionType: 'С', hasVik: 'Нет', pstoRequired: 'Нет' }))).returning()
  await db.insert(weldJointProgramStates).values(joints.map(j => ({ weldJointId: j.id, kind: 'primary', physicalRootId: j.id })))
  const revisions: unknown[] = []
  await runWithAccess(toAccessIdentity(user), 's3-backup-fixture', [], async () => {
    const opened = await openScheme({ lineId: line.id, token })
    const bundleId = opened.bundle!.id
    let version = opened.bundle!.version
    for (let n = 1; n <= 3; n++) {
      const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica)
      for (let page = 1; page <= n; page++) pdf.addPage([842, 595]).drawText(`S3 backup / revision ${n} / page ${page}`, { x: 50, y: 500, font, size: 22 })
      const bytes = await pdf.save()
      const request = { bundleId, version, token, operationId: randomUUID(), replace: 'archive' as const }
      const key = await prepareSchemeUpload(request)
      const uploaded = await store.upload(key, new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } }))
      const published = await publishSchemeFile({ ...request, fileKey: key, fileName: `Backup ${n}.pdf`, changeNumber: String(n), ...uploaded })
      version = published.version
      const points = joints.map((joint, index) => ({ id: randomUUID(), rootId: joint.id, page: 1, x: .2 + index * .4, y: .3 + n * .05 }))
      const annotation = { id: randomUUID(), page: 1, x: .5, y: .7, shape: 'triangle' as const,
        label: `Опора ${n}`, note: `Восстановить примечание ${n}\nВторая строка`, color: '#dc2626', size: 24, strokeWidth: 2, rotation: 45 }
      const dimension = { id: randomUUID(), ...schemeDimensionPair(`p:${points[0].id}`, `a:${annotation.id}`),
        page: 1, distanceMm: 1250 + n, offsetX: .02, offsetY: -.03, color: '#2563eb', strokeWidth: 1.5 }
      const saved = await saveSchemePoints({ bundleId, version, token, operationId: randomUUID(), revisionId: published.revisionId,
        revisionVersion: 1, changes: { upsert: points, remove: [], annotations: { upsert: [annotation], remove: [] }, dimensions: { upsert: [dimension], remove: [] } } })
      assert.equal(saved.revisionVersion, 2)
      revisions.push({ id: published.revisionId, key, fileName: `Backup ${n}.pdf`, size: bytes.length,
        digest: uploaded.digest, pageCount: n, points, annotation, dimension })
    }
    await updateSchemeLease({ bundleId, token, release: true })
    await writeFile(join(process.env.E2E_S3_REPORT_DIR!, 'fixture.json'), JSON.stringify({ project: line.projectTitle, line: line.line, lineId: line.id, bundleId, revisions }, null, 2) + '\n', { mode: 0o600 })
  })
  console.log('S3 backup fixture: three published PDFs, two archives, points, dimensions and annotations ready')
} finally { await closeDatabase() }
