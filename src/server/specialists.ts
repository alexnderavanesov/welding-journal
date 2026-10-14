import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { specialists, generatedDocuments } from '@/db/schema'
import { assertSecurityScope } from '@/server/security-functions'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'
import { DOCUMENT_VERSION_SELECT } from './document-version'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { getSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import { SPECIALIST_METHODS, getSpecialistDocumentProfile, normalizeSpecialistSelection, resolveDocumentSpecialists, type DocumentSpecialists, type SpecialistCreationAssignment, type SpecialistRecord, type SpecialistSelection } from '@/lib/document-specialists'

// Never load weld membership/source metadata when assigning document signers.
const SPECIALIST_DOCUMENT_SELECT = {
  id: generatedDocuments.id, type: generatedDocuments.type, title: generatedDocuments.title, periodFrom: generatedDocuments.periodFrom,
  specialists: generatedDocuments.specialists, specialistsRevision: generatedDocuments.specialistsRevision, updatedAt: generatedDocuments.updatedAt,
  documentVersion: DOCUMENT_VERSION_SELECT,
}

export const listSpecialists = createServerFn({ method: 'GET' })
  .validator((data: { search?: string; offset?: number; kind?: SpecialistRecord['kind']; methods?: readonly string[]; status?: 'active' | 'archived' | 'all'; includeCounts?: boolean } = {}) => ({
    search: String(data.search ?? '').trim().slice(0, 200), offset: Math.max(0, Math.floor(Number(data.offset) || 0)),
    kind: data.kind === 'inspector' || data.kind === 'thermist' ? data.kind : undefined,
    methods: Array.isArray(data.methods) ? SPECIALIST_METHODS.filter(method => data.methods!.includes(method)) : [],
    status: data.status === 'all' || data.status === 'archived' ? data.status : 'active', includeCounts: data.includeCounts === true,
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    const filters = and(data.search ? or(ilike(specialists.name, `%${data.search.replace(/[\\%_]/g, '\\$&')}%`), ilike(specialists.certificate, `%${data.search.replace(/[\\%_]/g, '\\$&')}%`)) : undefined,
        data.kind ? eq(specialists.kind, data.kind) : undefined,
        data.methods.length ? sql`${specialists.methods} @> ${sql.param(data.methods)}::text[]` : undefined)
    const [found, counts] = await Promise.all([
      requireDb().select().from(specialists).where(and(filters, data.status === 'all' ? undefined : eq(specialists.archived, data.status === 'archived')))
        .orderBy(asc(specialists.name), asc(specialists.id)).limit(101).offset(data.offset),
      data.includeCounts ? requireDb().select({ all: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where not ${specialists.archived})::int`, archived: sql<number>`count(*) filter (where ${specialists.archived})::int` }).from(specialists).where(filters) : Promise.resolve([]),
    ])
    return { records: found.slice(0, 100), hasMore: found.length > 100, counts: counts[0] }
  })

export function normalizeSpecialistArchive(data: { id: number; revision: number; archived: boolean }) {
  if (!Number.isSafeInteger(data?.id) || data.id <= 0 || !Number.isSafeInteger(data.revision) || data.revision <= 0 || typeof data.archived !== 'boolean') throw new Error('Обновите карточку специалиста.')
  return { id: data.id, revision: data.revision, archived: data.archived }
}

export const archiveSpecialist = createServerFn({ method: 'POST' }).validator(normalizeSpecialistArchive).handler(async ({ data }) => {
  await assertSecurityScope('settings')
  const [saved] = await requireDb().update(specialists).set({ archived: data.archived, revision: sql`${specialists.revision} + 1` })
    .where(and(eq(specialists.id, data.id), eq(specialists.revision, data.revision))).returning()
  if (!saved) throw new Error('Карточка изменена другим пользователем. Обновите список и повторите действие.')
  return saved
})

export function normalizeSpecialistCard(data: Omit<SpecialistRecord, 'id' | 'revision'> & { id?: number; revision?: number }) {
  const name = String(data?.name ?? '').trim()
  const certificate = String(data?.certificate ?? '').trim()
  if (!name || !certificate || name.length > 300 || certificate.length > 200) throw new Error('Укажите ФИО и № квалификационного удостоверения (до 300 и 200 символов).')
  if (data.kind !== 'inspector' && data.kind !== 'thermist') throw new Error('Выберите тип специалиста.')
  const methods = data.kind === 'thermist' ? [] : [...new Set(data.methods ?? [])]
  if (data.kind === 'inspector' && (!methods.length || methods.some(method => !SPECIALIST_METHODS.includes(method)))) throw new Error('Выберите виды контроля специалиста.')
  if (data.id !== undefined && (!Number.isSafeInteger(data.id) || data.id <= 0 || !Number.isSafeInteger(data.revision) || data.revision! <= 0)) throw new Error('Обновите карточку специалиста.')
  return { id: data.id, revision: data.revision, name, certificate, kind: data.kind, methods }
}

export const saveSpecialist = createServerFn({ method: 'POST' })
  .validator(normalizeSpecialistCard)
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    const { id, revision, ...values } = data
    if (!id) return (await requireDb().insert(specialists).values(values).returning())[0]!
    const [saved] = await requireDb().update(specialists).set({ ...values, revision: sql`${specialists.revision} + 1` })
      .where(and(eq(specialists.id, id), eq(specialists.revision, revision!))).returning()
    if (!saved) throw new Error('Карточка изменена другим пользователем. Откройте её заново; ваши изменения не сохранены.')
    return saved
  })

export type SpecialistAssignmentTarget = { id: number; revision: number; updatedAt: string; documentVersion: string }
export type AssignDocumentSpecialistsInput = { documents: SpecialistAssignmentTarget[]; selection: SpecialistSelection }

export function normalizeSpecialistAssignment(data: AssignDocumentSpecialistsInput): AssignDocumentSpecialistsInput {
  if (!Array.isArray(data?.documents) || !data.documents.length || data.documents.length > 10000) throw new Error('Выберите от 1 до 10000 документов.')
  if (new Set(data.documents.map(document => document.id)).size !== data.documents.length || data.documents.some(document => !Number.isSafeInteger(document.id) || document.id <= 0 || !Number.isSafeInteger(document.revision) || document.revision < 0 || !Number.isFinite(Date.parse(document.updatedAt)))) throw new Error('Некорректный выбор документов. Обновите список.')
  if (data.documents.some(document => typeof document.documentVersion !== 'string' || !/^[1-9]\d{0,9}$/.test(document.documentVersion))) throw new Error('Открытые документы устарели или не содержат служебную версию. Ничего не сохранено. Обновите список и откройте назначение заново.')
  const selection = normalizeSpecialistSelection(data.selection)
  if (!Object.keys(selection).length) throw new Error('Выберите специалиста или очистку хотя бы одной роли.')
  return { documents: data.documents, selection }
}

export const assignDocumentSpecialists = createServerFn({ method: 'POST' })
  .validator(normalizeSpecialistAssignment)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    return applySpecialistAssignments(data)
  })

export async function applySpecialistAssignments(input: AssignDocumentSpecialistsInput) {
    const data = normalizeSpecialistAssignment(input)
    return requireDb().transaction(async tx => {
      const documents = await tx.select(SPECIALIST_DOCUMENT_SELECT).from(generatedDocuments).where(buildNumberArrayMatch(generatedDocuments.id, data.documents.map(document => document.id))).orderBy(asc(generatedDocuments.id)).for('update')
      const expected = new Map(data.documents.map(document => [document.id, document]))
      if (documents.length !== expected.size || documents.some(document => {
        const version = expected.get(document.id)!
        return document.documentVersion !== version.documentVersion || document.specialistsRevision !== version.revision || document.updatedAt.toISOString() !== new Date(version.updatedAt).toISOString()
      })) throw new Error('Документы изменились. Ничего не сохранено. Обновите список и повторите назначение.')
      const profiles = documents.map(document => getSpecialistDocumentProfile(document.type))
      if (profiles.some(profile => !profile) || new Set(profiles.map(profile => profile?.kind)).size !== 1) throw new Error('Выберите заключения НК/ТВМТ либо ПСТО отдельно. Заявки, ЖСР, чек-листы и ЗНИ не поддерживают назначения.')
      const records = await loadSelectedSpecialists(tx, [data.selection])
      await writeDocumentSpecialists(tx, documents.map((document, index) => ({ id: document.id, snapshot: resolveDocumentSpecialists(document.specialists, data.selection, records, profiles[index]!) })))
      return { count: documents.length }
    })
}

async function loadSelectedSpecialists(tx: SystemDocumentSequenceTransaction, selections: SpecialistSelection[]) {
  const ids = [...new Set(selections.flatMap(selection => [selection.first, selection.second]).filter((id): id is number => typeof id === 'number'))]
  const records = ids.length ? await tx.select().from(specialists).where(buildNumberArrayMatch(specialists.id, ids)).orderBy(asc(specialists.id)).for('share') : []
  return new Map(records.map(record => [record.id, record]))
}

export async function writeDocumentSpecialists(tx: SystemDocumentSequenceTransaction, writes: Array<{ id: number; snapshot: DocumentSpecialists }>) {
  if (!writes.length) return
  await tx.execute(sql`update ${generatedDocuments} as d set specialists = v.snapshot::jsonb,
    specialists_revision = d.specialists_revision + 1,
    updated_at = greatest(clock_timestamp(), d.updated_at + interval '1 millisecond')
    from unnest(${sql.param(writes.map(write => write.id))}::integer[], ${sql.param(writes.map(write => JSON.stringify(write.snapshot)))}::text[]) as v(id, snapshot)
    where d.id = v.id`)
}

/** Only called after new-document validation and index sync in the SAME transaction. */
export async function assignCreatedDocumentSpecialists(tx: SystemDocumentSequenceTransaction, assignments: SpecialistCreationAssignment[] | undefined, allowed: SystemDocumentReference[]) {
  if (!assignments?.length) return
  const referencesByTitle = new Map<string, SystemDocumentReference[]>()
  for (const reference of allowed) if (getSpecialistDocumentProfile(reference.type, reference.methodCode)) {
    const references = referencesByTitle.get(reference.title) ?? []
    references.push(reference); referencesByTitle.set(reference.title, references)
  }
  const targets = assignments.map(assignment => {
    const references = referencesByTitle.get(assignment.title) ?? []
    if (references.length !== 1) throw new Error('Назначение специалиста не соответствует создаваемому заключению.')
    const reference = references[0]!
    const type = `system:${getSystemDocumentTemplateId(reference)}`
    // First/repeat PSTO/TVMT cycles share one identity, including legacy storage.
    // Ordinary NK conclusions on different stages are independent documents.
    const sourceKinds = type === 'system:pstoConclusion' || type === 'system:tvmtConclusion'
      ? ['', 'pstoCycle', 'pstoRepeat'] : [reference.sourceKind ?? '']
    return { ...assignment, selection: normalizeSpecialistSelection(assignment.selection), reference, type, sourceKinds }
  })
  const result = await tx.execute(sql`select d.id, d.type, d.title, d.period_from::text as "periodFrom", d.specialists from ${generatedDocuments} d
    join jsonb_to_recordset(${JSON.stringify(targets.map(target => ({ type: target.type, title: target.title, date: target.reference.date, sourceKinds: target.sourceKinds })))}::jsonb) as n(type text, title text, date date, "sourceKinds" text[])
      on d.type = n.type and d.title = n.title and d.period_from = n.date
      and coalesce(nullif(d.source_metadata, '')::jsonb->>'sourceKind', '') = any(n."sourceKinds")
    order by d.id for update of d`)
  const found = result.rows as Array<{ id: number; type: string; title: string; periodFrom: string; specialists: DocumentSpecialists | null }>
  const records = await loadSelectedSpecialists(tx, targets.map(target => target.selection))
  const key = (type: string, title: string, date: string) => JSON.stringify([type, title, date])
  const foundByKey = new Map<string, typeof found>()
  for (const document of found) {
    const id = key(document.type, document.title, document.periodFrom ?? '')
    const values = foundByKey.get(id) ?? []; values.push(document); foundByKey.set(id, values)
  }
  const writes = targets.map(target => {
    const matches = foundByKey.get(key(target.type, target.title, target.reference.date)) ?? []
    if (matches.length !== 1) throw new Error('Не удалось определить создаваемое заключение для назначения специалиста.')
    const document = matches[0]!
    return { id: document.id, snapshot: resolveDocumentSpecialists(document.specialists, target.selection, records, getSpecialistDocumentProfile(document.type)!) }
  })
  if (new Set(writes.map(write => write.id)).size !== writes.length) throw new Error('Назначения одного документа повторяются.')
  await writeDocumentSpecialists(tx, writes)
}
