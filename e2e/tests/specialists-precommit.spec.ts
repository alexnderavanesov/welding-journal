import { asE2eOwner } from '../with-owner-access'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { and, eq } from 'drizzle-orm'
import { assertSafeE2eDatabaseUrl, E2E_DATABASE_URL, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { requireDb } from '../../src/db'
import { preHeatTreatmentControls, weldJoints } from '../../src/db/schema'
import type { DocumentSpecialists, SpecialistSelection, SpecialistSnapshot } from '../../src/lib/document-specialists'
import type { DocumentOperationRequest } from '../../src/lib/system-document-operation'
import { applySpecialistAssignments, assignCreatedDocumentSpecialists } from '../../src/server/specialists'
import { initializeSystemDocumentIndexesInTransaction, syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { syncPreHeatTreatmentDocumentsInTransaction } from '../../src/server/pre-heat-treatment-system-documents'
import { applyOperation as raw_applyOperation, previewOperation as raw_previewOperation } from '../../src/server/document-operation-service'
import { deleteWeldJoint as raw_deleteWeldJoint } from '../../src/server/weld-mutations'
import { persistLayeredControlDocumentWrites } from '../../src/server/layered-control-documents'
import { loadRemoteGeneratedDocument } from '../../src/server/generated-documents'
import { rpcName } from '../rpc'

// Real SQL/service regressions; layered removal also uses the actual row menu.
// specialist-results.spec.ts covers the result-creation UI. Playwright config
// binds server imports to the disposable database; refuse any different target.
test.describe.configure({ mode: 'serial' })
const date = '2026-10-12'
const applyOperation = asE2eOwner(raw_applyOperation, 'documents.edit')
const previewOperation = asE2eOwner(raw_previewOperation, 'documents.view')
type Stage = 'primary' | 'beforeHeatTreatment'
type StoredConclusion = {
  id: number; title: string; period_from: string; stage: string; row_count: number
  specialists: DocumentSpecialists | null; specialists_revision: number
  updated_at: Date; source_metadata: string | null; row_ids: number[]; document_version: string
}
let project = ''
const specialistIds: number[] = []
const receiptIds: string[] = []

test.beforeEach(() => {
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  expect(process.env.DATABASE_URL).toBe(E2E_DATABASE_URL)
  project = `E2E specialists precommit ${randomUUID()}`
})

test.afterEach(async () => {
  if (!project) return
  try {
    await cleanupLineProgramProjects([project])
  } finally {
    await withE2eDatabase(async db => {
      if (receiptIds.length) await db.query('delete from document_operation_receipts where id=any($1::text[])', [receiptIds])
      if (specialistIds.length) await db.query('delete from specialists where id=any($1::integer[])', [specialistIds])
    })
    receiptIds.length = 0
    specialistIds.length = 0
    project = ''
  }
})

async function seedWelds(count: number): Promise<number[]> {
  return withE2eDatabase(async db => (await db.query<{ id: number }>(`
    insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,psto_required)
    select $1,'SPEC-AUDIT','SPEC-AUDIT-L'||n,'F99800'||n,'2026-10-01','действующий','актуальная','да','нет'
    from generate_series(1,$2::integer) n returning id`, [project, count])).rows.map(row => row.id))
}

async function person(label: string, certificate: string): Promise<SpecialistSnapshot> {
  return withE2eDatabase(async db => {
    const result = await db.query<SpecialistSnapshot>(`
      insert into specialists(name,kind,certificate,methods)
      values($1,'inspector',$2,array['ВИК']) returning id,name,certificate`, [`${project} ${label}`, certificate])
    const saved = result.rows[0]!
    specialistIds.push(saved.id)
    return saved
  })
}

/** The same index-sync + assignment boundary used by creation workflows.
 * No mocked database and no hand-seeded generated document/specialist snapshot.
 */
async function createConclusion(stage: Stage, weldId: number, title: string, selection: SpecialistSelection) {
  await requireDb().transaction(async tx => {
    const where = and(eq(weldJoints.id, weldId), eq(weldJoints.projectTitle, project))
    const [previous] = await tx.select().from(weldJoints).where(where).for('update')
    if (!previous) throw new Error('Scoped specialist audit weld is missing')
    if (stage === 'primary') {
      const [saved] = await tx.update(weldJoints).set({
        vikRequest: `${title} request`, vikRequestDate: '2026-10-02',
        vikResult: 'годен', vikConclusion: title, vikConclusionDate: date, updatedAt: new Date(),
      }).where(where).returning()
      await syncSystemDocumentsForWeldChangesInTransaction(tx, [saved!], new Map([[weldId, previous]]))
    } else {
      const [saved] = await tx.update(weldJoints).set({ pstoRequired: 'да', updatedAt: new Date() }).where(where).returning()
      const [control] = await tx.insert(preHeatTreatmentControls).values({
        weldJointId: weldId, method: 'ВИК', requestName: `${title} pre request`, requestDate: '2026-10-02',
        result: 'годен', conclusionName: title, conclusionDate: date, defectDescription: 'ДНО',
      }).returning()
      await syncPreHeatTreatmentDocumentsInTransaction(tx, [saved!], [control!])
    }
    await assignCreatedDocumentSpecialists(tx, [{ title, selection }], [{
      type: 'lnkConclusion', methodCode: 'ВИК', title, date,
      ...(stage === 'beforeHeatTreatment' ? { sourceKind: 'beforeHeatTreatment' as const } : {}),
    }])
  })
}

async function conclusions(): Promise<StoredConclusion[]> {
  return withE2eDatabase(async db => (await db.query<StoredConclusion>(`
    select d.id,d.title,d.period_from::text,d.row_count,d.specialists,d.specialists_revision,d.updated_at,d.source_metadata,d.xmin::text as document_version,
      coalesce(nullif(d.source_metadata,'')::jsonb->>'sourceKind','') as stage,
      array(select a.weld_joint_id from generated_document_weld_joints a where a.document_id=d.id order by a.weld_joint_id) as row_ids
    from generated_documents d
    where d.type='system:lnkConclusionVik' and exists (
      select 1 from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id
      where a.document_id=d.id and w.project_title=$1
    ) order by d.id`, [project])).rows)
}

for (const createdStage of ['primary', 'beforeHeatTreatment'] as const) {
  test(`creation assigns only ${createdStage} when title/date/method match the other stage`, async () => {
    const [existingWeld, createdWeld] = await seedWelds(2)
    const existingPerson = await person('other stage', 'НК-OTHER')
    const createdPerson = await person('created stage', 'НК-NEW')
    const title = `${project} same-name ВИК`
    const existingStage = createdStage === 'primary' ? 'beforeHeatTreatment' : 'primary'
    await createConclusion(existingStage, existingWeld!, title, { first: existingPerson.id, second: existingPerson.id })
    const before = await conclusions()
    expect(before).toHaveLength(1)
    expect(before[0]!.specialists).toEqual({ first: existingPerson, second: existingPerson })

    // Prior lookup selected both stages and rolled back this real transaction.
    await createConclusion(createdStage, createdWeld!, title, { first: createdPerson.id, second: null })
    const after = await conclusions()
    expect(after).toHaveLength(2)
    expect(after.find(row => row.id === before[0]!.id)).toEqual(before[0])
    const created = after.find(row => row.id !== before[0]!.id)!
    expect(created).toMatchObject({
      title, period_from: date, stage: createdStage === 'primary' ? '' : 'beforeHeatTreatment',
      row_count: 1, row_ids: [createdWeld], specialists: { first: createdPerson, second: null }, specialists_revision: 1,
    })
    await withE2eDatabase(async db => {
      if (createdStage === 'primary') {
        expect((await db.query('select vik_conclusion,vik_result from weld_joints where id=$1 and project_title=$2', [createdWeld, project])).rows)
          .toEqual([{ vik_conclusion: title, vik_result: 'годен' }])
      } else {
        expect((await db.query('select conclusion_name,result from pre_heat_treatment_controls where weld_joint_id=$1 and method=$2', [createdWeld, 'ВИК'])).rows)
          .toEqual([{ conclusion_name: title, result: 'годен' }])
      }
    })
  })
}

test('real merge keeps equal saved FIO/certificate from distinct cards without clearance consent', async () => {
  // Initialize before creating signed fixtures: lazy preview initialization must
  // not be confused with a merge changing an unselected document's timestamp.
  await requireDb().transaction(initializeSystemDocumentIndexesInTransaction)
  const [firstWeld, secondWeld, untouchedWeld] = await seedWelds(3)
  const first = await person('same saved person', 'НК-SAVED')
  const duplicate = await person('same saved person', 'НК-SAVED')
  const untouchedPerson = await person('unselected person', 'НК-UNSELECTED')
  expect(first.id).not.toBe(duplicate.id)
  expect([first.name, first.certificate]).toEqual([duplicate.name, duplicate.certificate])
  await createConclusion('primary', firstWeld!, `${project} A`, { first: first.id, second: null })
  await createConclusion('primary', secondWeld!, `${project} B`, { first: duplicate.id, second: null })
  await createConclusion('primary', untouchedWeld!, `${project} untouched`, { first: untouchedPerson.id, second: untouchedPerson.id })
  const before = await conclusions()
  expect(before).toHaveLength(3)
  const sourceDocuments = before.filter(row => row.row_ids[0] === firstWeld || row.row_ids[0] === secondWeld)
  const untouched = before.find(row => row.row_ids[0] === untouchedWeld)!
  expect(sourceDocuments.map(row => row.specialists?.first?.id).sort((a, b) => Number(a) - Number(b)))
    .toEqual([first.id, duplicate.id].sort((a, b) => a - b))
  // Registry edits must not replace the saved document facts during the merge.
  await withE2eDatabase(db => db.query('update specialists set name=name||$2,certificate=$3,revision=revision+1 where id=any($1::integer[])',
    [[first.id, duplicate.id], ' current registry', 'НК-CURRENT']))

  const input: DocumentOperationRequest = { documentIds: sourceDocuments.map(row => row.id), action: 'merge', merge: true, mode: 'none' }
  const initial = await previewOperation(input)
  expect(initial.groups).toHaveLength(1)
  expect(initial.groups[0]!.specialistsCleared).toBe(false)
  const group = initial.groups[0]!
  const title = `${project} merged`
  const named: DocumentOperationRequest = { ...input, names: { [group.key]: { mode: 'custom', name: title, membership: group.membership } } }
  const preview = await previewOperation(named)
  expect(preview.groups).toHaveLength(1)
  expect(preview.groups[0]).toMatchObject({ name: title, error: '', specialistsCleared: false, rowCount: 2 })
  const operationId = randomUUID()
  receiptIds.push(operationId)
  // Deliberately omit acceptSpecialistClearing: equal saved facts need none.
  expect(await applyOperation({ ...named, fingerprint: preview.fingerprint, previewHash: preview.previewHash, operationId }))
    .toEqual({ changedDocumentCount: 2, resultingDocumentCount: 1, affectedRowCount: 2 })
  const after = await conclusions()
  expect(after).toHaveLength(2)
  expect(after.find(row => row.id === untouched.id)).toEqual(untouched)
  const merged = after.find(row => row.title === title)!
  expect(merged.row_ids).toEqual([firstWeld, secondWeld].sort((a, b) => a! - b!))
  expect(merged.specialists?.first).toMatchObject({ name: first.name, certificate: 'НК-SAVED' })
  expect(merged.specialists?.second).toBeNull()
  expect(sourceDocuments.map(row => row.specialists)).toContainEqual(merged.specialists)
  await withE2eDatabase(async db => {
    const facts = await db.query('select id,vik_conclusion,vik_result from weld_joints where project_title=$1 and id=any($2::integer[]) order by id',
      [project, [firstWeld, secondWeld]])
    expect(facts.rows).toEqual([firstWeld, secondWeld].sort((a, b) => a! - b!).map(id => ({ id, vik_conclusion: title, vik_result: 'годен' })))
  })
})

test('bulk assignment rejects stale membership after actual weld deletion without partial writes', async ({}, testInfo) => {
  await requireDb().transaction(initializeSystemDocumentIndexesInTransaction)
  const [removedWeld, retainedWeld, companionWeld] = await seedWelds(3)
  const original = await person('original pair', 'НК-ORIGINAL')
  const replacement = await person('pending replacement', 'НК-REPLACEMENT')
  const sharedTitle = `${project} shared bulk target`
  await createConclusion('primary', removedWeld!, sharedTitle, { first: original.id, second: original.id })
  await createConclusion('primary', retainedWeld!, sharedTitle, { first: original.id, second: original.id })
  await createConclusion('primary', companionWeld!, `${project} companion bulk target`, { first: original.id, second: original.id })

  // Fixture setup mirrors a retained weld's valid date edit followed by the
  // actual index sync. Never write document versions or memberships by hand.
  // This puts the document on the summary-version path AFTER signer assignment.
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project)).for('update')
    const previous = rows.find(row => row.id === retainedWeld)!
    const updatedAt = new Date(Math.max(Date.now(), ...rows.map(row => row.updatedAt.getTime())) + 1)
    const [saved] = await tx.update(weldJoints).set({ weldDate: '2026-09-30', updatedAt })
      .where(and(eq(weldJoints.id, retainedWeld!), eq(weldJoints.projectTitle, project))).returning()
    await syncSystemDocumentsForWeldChangesInTransaction(tx, [saved!], new Map([[retainedWeld!, previous]]))
  })
  const weldVersions = () => withE2eDatabase(async db => (await db.query<{
    id: number; version: string; updated_at: Date
  }>('select id,xmin::text as version,updated_at from weld_joints where project_title=$1 order by id', [project])).rows)
  const before = await conclusions()
  expect(before).toHaveLength(2)
  const sharedBefore = before.find(document => document.title === sharedTitle)!
  const companionBefore = before.find(document => document.id !== sharedBefore.id)!
  expect(sharedBefore.row_ids).toEqual([removedWeld, retainedWeld].sort((a, b) => a! - b!))
  expect(sharedBefore.row_count).toBe(2)
  for (const document of before) expect(document.specialists).toEqual({ first: original, second: original })
  // Both documents are selected: rejecting the stale one must reject the whole
  // batch, including an otherwise unchanged and eligible companion document.
  const staleRequest = {
    documents: before.map(document => ({ id: document.id, revision: document.specialists_revision, updatedAt: document.updated_at.toISOString(), documentVersion: document.document_version })),
    selection: { first: replacement.id, second: null },
  }
  const weldsBefore = await weldVersions()
  const deletionTarget = weldsBefore.find(row => row.id === removedWeld)!
  expect(deletionTarget.updated_at.getTime()).toBeLessThan(weldsBefore.find(row => row.id === retainedWeld)!.updated_at.getTime())

  // Exercise the public deletion service, including guards, transaction and
  // document synchronization; a raw DELETE would not establish reachability.
  expect(await deleteWeldJoint({ data: { id: deletionTarget.id, version: deletionTarget.version } })).toEqual({ ok: true })
  const afterDeletion = await conclusions()
  const weldsAfterDeletion = await weldVersions()
  expect(weldsAfterDeletion).toEqual(weldsBefore.filter(row => row.id !== removedWeld))
  expect(afterDeletion.map(document => document.id)).toEqual(before.map(document => document.id))
  const sharedAfterDeletion = afterDeletion.find(document => document.id === sharedBefore.id)!
  expect(sharedBefore.document_version).toMatch(/^[1-9]\d*$/)
  expect(sharedAfterDeletion.document_version).not.toBe(sharedBefore.document_version)
  expect(sharedAfterDeletion).toMatchObject({ row_count: 1, row_ids: [retainedWeld], specialists: sharedBefore.specialists })
  expect(afterDeletion.find(document => document.id === companionBefore.id)).toEqual(companionBefore)

  const outcome = await applySpecialistAssignments(staleRequest).then(
    result => ({ accepted: true as const, result }),
    (error: unknown) => ({ accepted: false as const, message: error instanceof Error ? error.message : String(error) }),
  )
  const afterApply = await conclusions()
  // Retain exact before/after evidence; the guard uses the captured document
  // version rather than relying on millisecond timestamp equality.
  await testInfo.attach('bulk-stale-membership-evidence', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({
      before, afterDeletion, afterApply, weldsBefore, weldsAfterDeletion, staleRequest, outcome,
      unchangedVersionDespiteDeletion: sharedBefore.specialists_revision === sharedAfterDeletion.specialists_revision &&
        sharedBefore.updated_at.getTime() === sharedAfterDeletion.updated_at.getTime(),
    }, null, 2)),
  })
  // Agreed bulk contract: reject concurrent document changes, with no partial
  // assignment/clearance and no automatic rewriting of the captured targets.
  expect.soft(outcome).toMatchObject({ accepted: false, message: expect.stringMatching(/Документы изменились|состав.*измен|устарел/i) })
  expect(afterApply).toEqual(afterDeletion)

  const freshTargets = afterDeletion.map(document => ({ id: document.id, revision: document.specialists_revision,
    updatedAt: document.updated_at.toISOString(), documentVersion: document.document_version }))
  const missingToken = freshTargets.map(({ documentVersion: _version, ...target }) => target)
  await expect(applySpecialistAssignments({ documents: missingToken as never, selection: { first: null } })).rejects.toThrow('служебную версию')
  expect(await conclusions()).toEqual(afterDeletion)
  expect(await applySpecialistAssignments({ documents: freshTargets, selection: staleRequest.selection })).toEqual({ count: 2 })
  const freshSaved = await conclusions()
  expect(freshSaved.every(document => document.specialists?.first?.id === replacement.id && document.specialists?.second === null)).toBe(true)

  const concurrentTargets = freshSaved.map(document => ({ id: document.id, revision: document.specialists_revision,
    updatedAt: document.updated_at.toISOString(), documentVersion: document.document_version }))
  const attempts = await Promise.allSettled([
    applySpecialistAssignments({ documents: concurrentTargets, selection: { first: original.id } }),
    applySpecialistAssignments({ documents: concurrentTargets, selection: { first: null } }),
  ])
  expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1)
  expect(attempts.filter(attempt => attempt.status === 'rejected')).toHaveLength(1)
  const lost = attempts.find(attempt => attempt.status === 'rejected') as PromiseRejectedResult
  expect(String(lost.reason)).toContain('Документы изменились')
  const winningFirst = attempts[0].status === 'fulfilled' ? original : null
  const final = await conclusions()
  for (const document of final) {
    expect(document.specialists).toEqual({ first: winningFirst, second: null })
    const saved = freshSaved.find(previous => previous.id === document.id)!
    expect(document.specialists_revision).toBe(saved.specialists_revision + 1)
    expect(document.row_ids).toEqual(saved.row_ids)
  }
})

for (const removal of ['layered removal', 'duplicate pruning', 'weld deletion'] as const) {
  test(`legacy shared layered document: ${removal} invalidates a real captured assignment token`, async ({ page }) => {
    const [removedWeld, retainedWeld] = await seedWelds(2)
    const signer = await person('legacy layered signer', 'НК-LAYERED')
    // Deliberately retain a legacy multi-weld parent. Current automatic creation
    // is one-weld-per-document; the approved guard must cover both shapes.
    const documentId = await withE2eDatabase(async db => {
      await db.query('update weld_joints set layered_control_assigned=true where project_title=$1', [project])
      const { rows: [document] } = await db.query<{ id: number }>(`insert into generated_documents
        (type,title,file_name,mime_type,row_count,source_metadata)
        values('layeredVikEdges',$1,'legacy.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',2,$2) returning id`,
      [`${project} legacy shared`, JSON.stringify({ kind: 'layeredControl', version: 1 })])
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::integer[])', [document!.id, [removedWeld, retainedWeld]])
      return document!.id
    })
    // Raw seeds bypass the normal save's final-status calculation. Settle them
    // before capturing either document or weld versions: a navigation-triggered
    // refresh must not race the membership operation this regression exercises.
    const [{ markDispatcherTaskIndexDirty }, { ensureDispatcherTaskIndexFresh }] = await Promise.all([
      import('../../src/server/dispatcher-task-index-dirty'),
      import('../../src/server/dispatcher-task-index'),
    ])
    await markDispatcherTaskIndexDirty(requireDb())
    await ensureDispatcherTaskIndexFresh()
    // Welded + VIK enabled, but no request/result: awaiting a request, not NK.
    expect(await withE2eDatabase(async db => (await db.query<{ final_status: string | null }>(
      'select final_status from weld_joints where project_title=$1 order by id', [project])).rows))
      .toEqual([{ final_status: 'ожидает заявку' }, { final_status: 'ожидает заявку' }])
    const read = async () => {
      const document = await loadRemoteGeneratedDocument(documentId)
      expect(document).not.toBeNull()
      expect(document!.documentVersion).toMatch(/^[1-9]\d*$/)
      return document!
    }
    const target = (document: Awaited<ReturnType<typeof read>>) => ({ id: document.id,
      revision: document.specialistsRevision!, updatedAt: document.updatedAt, documentVersion: document.documentVersion! })
    await applySpecialistAssignments({ documents: [target(await read())], selection: { first: signer.id, second: signer.id } })
    const before = await read()
    expect(before.rowCount).toBe(2)
    const staleTarget = target(before)
    const deletionTarget = await withE2eDatabase(async db => (await db.query<{ id: number; version: string }>(
      'select id,xmin::text as version from weld_joints where id=$1 and project_title=$2', [removedWeld, project])).rows[0]!)
    if (removal === 'layered removal') {
      await page.goto('/lnk')
      // In the full suite other projects occupy the first virtualized page.
      // Reach this fixture through the same report search an operator uses.
      await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
      await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
      await expect(page.locator('[data-lnk-grid] .journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
      const row = page.locator(`.ag-row[row-id="${removedWeld}"]`)
      const joint = row.getByRole('button', { name: 'F998001', exact: true })
      await joint.scrollIntoViewIfNeeded()
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      await joint.click({ button: 'right' })
      await expect(page.getByTestId('context-action-menu')).toBeVisible()
      await page.getByRole('button', { name: 'Дополнительно', exact: true }).click()
      await page.getByRole('button', { name: 'Убрать послойный контроль', exact: true }).click()
      await page.getByRole('button', { name: 'Убрать', exact: true }).click()
      await expect.poll(async () => (await read()).rowCount).toBe(1)
      await page.close()
    } else if (removal === 'duplicate pruning') {
      await requireDb().transaction(tx => persistLayeredControlDocumentWrites(tx, [], [{ documentId, weldJointId: removedWeld! }]))
    } else {
      await deleteWeldJoint({ data: deletionTarget })
    }
    const afterRemoval = await read()
    expect(afterRemoval.rowCount).toBe(1)
    expect(afterRemoval.documentVersion).not.toBe(before.documentVersion)
    expect(afterRemoval.specialists).toEqual(before.specialists)
    expect(await withE2eDatabase(async db => (await db.query('select weld_joint_id from generated_document_weld_joints where document_id=$1 order by weld_joint_id', [documentId])).rows))
      .toEqual([{ weld_joint_id: retainedWeld }])
    await expect(applySpecialistAssignments({ documents: [staleTarget], selection: { first: null, second: null } })).rejects.toThrow('Документы изменились')
    expect(await read()).toEqual(afterRemoval)
    await expect(applySpecialistAssignments({ documents: [target(afterRemoval)], selection: { first: null, second: null } })).resolves.toEqual({ count: 1 })
    expect((await read()).specialists).toEqual({ first: null, second: null })
  })
}

const deleteWeldJoint = asE2eOwner(raw_deleteWeldJoint, 'welding.delete')
