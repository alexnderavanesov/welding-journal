import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import type { DocumentSpecialists, SpecialistCertificate } from '../../src/lib/document-specialists'
import type { SystemDocumentDateChangeData } from '../../src/server/weld-contracts'
import { ensureDispatcherTaskIndexFresh } from '../../src/server/dispatcher-task-index'
import { applySpecialistAssignments } from '../../src/server/specialists'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { changeSystemDocumentDate } from '../../src/server/system-document-date-workflow'
import { assertSafeE2eDatabaseUrl, E2E_DATABASE_URL, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { asE2eOwner } from '../with-owner-access'

const changeDate = asE2eOwner(changeSystemDocumentDate, 'documents.edit')
const assign = asE2eOwner(applySpecialistAssignments, 'documents.edit')
const certificates: SpecialistCertificate[] = [
  { number: 'УД-2025', validFrom: '2025-01-01', validTo: '2025-12-31', methods: ['ВИК'] },
  { number: 'УД-2026', validFrom: '2026-01-01', validTo: '2026-12-31', methods: ['ВИК'] },
]

type StoredRow = {
  id: number
  joint: string
  vik_result: string
  vik_conclusion: string
  date: string
  version: string
}
type StoredDocument = {
  id: number
  type: string
  title: string
  date: string
  row_count: number
  row_ids: number[]
  specialists: DocumentSpecialists | null
  specialists_revision: number
  updated_at: Date
  version: string
}

let project = ''
let personId: number | undefined
test.beforeEach(() => {
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  expect(process.env.DATABASE_URL).toBe(E2E_DATABASE_URL)
  project = `E2E certificate date conflicts ${randomUUID()}`
})
test.afterEach(async () => {
  try {
    if (project) await cleanupLineProgramProjects([project])
  } finally {
    if (personId) await withE2eDatabase(db => db.query('delete from specialists where id=$1', [personId]))
    project = ''
    personId = undefined
  }
})

async function stored() {
  return withE2eDatabase(async db => ({
    // Keep every stored field, timestamp and xmin: a failed operation must not
    // mutate a result, another document, a snapshot or even an optimistic token.
    rows: (await db.query<StoredRow>(`select w.*,w.vik_conclusion_date::text as date,w.xmin::text as version
      from weld_joints w where w.project_title=$1 order by w.id`, [project])).rows,
    documents: (await db.query<StoredDocument>(`select d.*,d.period_from::text as date,d.xmin::text as version,
      array(select a.weld_joint_id from generated_document_weld_joints a where a.document_id=d.id order by a.weld_joint_id) as row_ids
      from generated_documents d where exists (
        select 1 from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id
        where a.document_id=d.id and w.project_title=$1) order by d.id`, [project])).rows,
  }))
}
type StoredState = Awaited<ReturnType<typeof stored>>
const conclusions = (state: StoredState) => state.documents.filter(document => document.type === 'system:lnkConclusionVik')
const assignmentTargets = (state: StoredState) => conclusions(state).map(document => ({ id: document.id,
  revision: document.specialists_revision, updatedAt: document.updated_at.toISOString(), documentVersion: document.version }))
function dateInput(state: StoredState, document: StoredDocument): SystemDocumentDateChangeData {
  return { reference: { documentId: document.id, type: 'lnkConclusion', methodCode: 'ВИК', title: document.title, date: document.date },
    nextDate: '2026-01-01', expectedVersions: state.rows.filter(row => document.row_ids.includes(row.id)).map(row => ({ id: row.id, version: row.version })) }
}

async function confirmation(data: SystemDocumentDateChangeData) {
  const message = await changeDate({ data }).then(() => '', error => String(error.message))
  expect(message).toContain('Изменение даты заключения изменит удостоверения специалистов')
  const token = message.match(/\[specialist-confirmation:([a-f0-9]{64})\]/)?.[1]
  expect(token).toBeTruthy()
  return { token: token!, message }
}

async function seed(documentCount: number, rowsPerDocument: number) {
  personId = await withLineProgramFixture(async db => {
    const person = (await db.query<{ id: number }>(`insert into specialists(name,kind,certificate,stamp,methods,certificates)
      values($1,'inspector','УД-2025','КЛЕЙМО-ИСТОРИЯ',array['ВИК'],$2::jsonb) returning id`,
    [project + ' специалист', JSON.stringify(certificates)])).rows[0]!
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,
      has_vik,psto_required,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,vik_defect_description)
      select $1,'CERT-CONFLICTS','CERT-CONFLICTS-L'||((n-1)/$3::integer+1),'FC'||n,'2025-01-01',null,'актуальная',
        'да','нет',$1||' request','2025-01-02','годен',$1||' conclusion '||((n-1)/$3::integer+1),'2025-05-01','ДНО'
      from generate_series(1,$2::integer) n`, [project, documentCount * rowsPerDocument, rowsPerDocument])
    return person.id
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  // Publish the raw fixture before recording any versions. These tests measure
  // user interleavings, not unrelated dispatcher fixture initialization.
  await ensureDispatcherTaskIndexFresh()
  const initial = await stored()
  expect(conclusions(initial)).toHaveLength(documentCount)
  expect(initial.rows).toHaveLength(documentCount * rowsPerDocument)
  await assign({ documents: assignmentTargets(initial), selection: { first: personId, second: null } })
  return stored()
}

test('card edits and archiving between date confirmation and retry cannot partially change a shared conclusion', async () => {
  const before = await seed(1, 3)
  const document = conclusions(before)[0]!
  const input = dateInput(before, document)
  const original = await confirmation(input)
  expect(original.message).toContain('УД-2025 → № УД-2026')
  expect(await stored()).toEqual(before)

  // A second operator commits a card edit while the first operator is reading
  // the confirmation. The injected commit changes exactly the registry facts
  // and revision; every date attempt still uses the real transactional workflow.
  const editedCertificates = [certificates[0]!, { ...certificates[1]!, number: 'УД-2026-ИСПРАВЛЕНО' }]
  await withE2eDatabase(db => db.query(`update specialists set certificates=$1::jsonb,name=$2,stamp=$3,revision=revision+1 where id=$4`,
    [JSON.stringify(editedCertificates), project + ' новое ФИО', 'НОВОЕ КЛЕЙМО', personId]))
  const renewed = await confirmation({ ...input, specialistCorrectionConfirmation: original.token })
  expect(renewed.token).not.toBe(original.token)
  expect(renewed.message).toContain('УД-2025 → № УД-2026-ИСПРАВЛЕНО')
  expect(await stored()).toEqual(before)

  await withE2eDatabase(db => db.query('update specialists set archived=true,revision=revision+1 where id=$1', [personId]))
  await expect(changeDate({ data: { ...input, specialistCorrectionConfirmation: renewed.token } })).rejects.toThrow('архивирован')
  expect(await stored()).toEqual(before)
  expect(await withE2eDatabase(async db => (await db.query('select archived from specialists where id=$1', [personId])).rows[0]?.archived)).toBe(true)

  // Restoring the same printed number must not resurrect an old confirmation:
  // the intervening registry revision is independently part of its identity.
  await withE2eDatabase(db => db.query('update specialists set archived=false,revision=revision+1 where id=$1', [personId]))
  const restored = await confirmation({ ...input, specialistCorrectionConfirmation: renewed.token })
  expect(restored.token).not.toBe(renewed.token)
  expect(restored.message).toContain('УД-2025 → № УД-2026-ИСПРАВЛЕНО')
  expect(await stored()).toEqual(before)
  await changeDate({ data: { ...input, specialistCorrectionConfirmation: restored.token } })
  const after = await stored()
  expect(conclusions(after)).toHaveLength(1)
  expect(conclusions(after)[0]).toMatchObject({ id: document.id, title: document.title, date: '2026-01-01', row_count: 3, row_ids: document.row_ids })
  expect(conclusions(after)[0]!.specialists).toEqual({ first: { ...document.specialists!.first!, certificate: 'УД-2026-ИСПРАВЛЕНО', certificateDate: '2026-01-01' }, second: null })
  expect(after.rows.map(row => ({ id: row.id, date: row.date, result: row.vik_result, title: row.vik_conclusion })))
    .toEqual(before.rows.map(row => ({ id: row.id, date: '2026-01-01', result: row.vik_result, title: row.vik_conclusion })))
  expect(after.documents.filter(item => item.id !== document.id)).toEqual(before.documents.filter(item => item.id !== document.id))
})

test('a stale bulk assignment after another client changes one date rejects all targets and a fresh retry selects the new certificates', async () => {
  const before = await seed(2, 2)
  const staleTargets = assignmentTargets(before)
  const document = conclusions(before)[0]!
  const untouched = conclusions(before)[1]!
  const input = dateInput(before, document)
  const accepted = await confirmation(input)
  expect(await stored()).toEqual(before)
  await changeDate({ data: { ...input, specialistCorrectionConfirmation: accepted.token } })
  const changed = await stored()
  expect(conclusions(changed).find(item => item.id === untouched.id)).toEqual(untouched)
  expect(conclusions(changed).find(item => item.id === document.id)).toMatchObject({ date: '2026-01-01', row_ids: document.row_ids,
    specialists: { first: { certificate: 'УД-2026', certificateDate: '2026-01-01' }, second: null } })
  expect(changed.rows.filter(row => untouched.row_ids.includes(row.id))).toEqual(before.rows.filter(row => untouched.row_ids.includes(row.id)))

  const selection = { first: personId!, second: personId! }
  await expect(assign({ documents: staleTargets, selection })).rejects.toThrow('Документы изменились')
  expect(await stored()).toEqual(changed)
  await expect(assign({ documents: assignmentTargets(changed), selection })).resolves.toEqual({ count: 2 })
  const after = await stored()
  expect(after.rows).toEqual(changed.rows)
  expect(conclusions(after)).toHaveLength(2)
  for (const saved of conclusions(after)) {
    const previous = conclusions(changed).find(item => item.id === saved.id)!
    expect(saved.date).toBe(previous.date)
    expect(saved.row_ids).toEqual(previous.row_ids)
    expect(saved.specialists_revision).toBe(previous.specialists_revision + 1)
    const expected = { ...previous.specialists!.first!, certificate: saved.id === document.id ? 'УД-2026' : 'УД-2025', certificateDate: previous.date }
    expect(saved.specialists).toEqual({ first: expected, second: expected })
  }
  expect(after.documents.filter(item => item.type !== 'system:lnkConclusionVik'))
    .toEqual(changed.documents.filter(item => item.type !== 'system:lnkConclusionVik'))
})
