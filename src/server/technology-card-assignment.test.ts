import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { technologyCardNames, technologyCards, weldJoints } from '@/db/schema'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { buildDocumentTemplateName } from '@/lib/document-template-name'
import { scanTechnologyCardAssignments, applyTechnologyCardAssignments } from './technology-card-assignment'
import { lockLayeredControlDocumentsForWeldChange, syncLayeredControlDocumentsForWeldChangesInTransaction } from './layered-control-documents'
import { lockWeldValidationSettings } from './weld-validation-settings-lock'

vi.mock('./audit-functions', () => ({ auditSql: vi.fn(async (_tx, _scope, run) => run()) }))
vi.mock('./weld-validation-settings-lock', () => ({ lockWeldValidationSettings: vi.fn() }))
vi.mock('./technology-card-registry-lock', () => ({ lockTechnologyCardRegistry: vi.fn() }))
vi.mock('./technology-card-registry', () => ({
  readTechnologyCardSettings: vi.fn(async () => DEFAULT_DATA_LIST_SETTINGS),
  toTechnologyCardRecord: vi.fn(card => card), markTechnologyCardsUsed: vi.fn(),
}))
vi.mock('./dispatcher-task-index-dirty', () => ({ getDispatcherDirtyScopes: vi.fn(() => []), markDispatcherTaskIndexDirty: vi.fn() }))
vi.mock('./layered-control-documents', () => ({
  lockLayeredControlDocumentsForWeldChange: vi.fn(), syncLayeredControlDocumentsForWeldChangesInTransaction: vi.fn(),
}))

const dialect = new PgDialect()
const card = { id: 1, revision: 1, name: 'ТК №12', weldingMethods: ['РАД'], connectionType: 'С17',
  materialGroups: ['М01'], diameterFrom: 57, diameterTo: 159, thicknessFrom: 3, thicknessTo: 8,
  psto: 'any', archived: false, fillerWire: 'Проволока из ТК' }
const saved = { id: 10, projectTitle: 'Проект', subtitleCode: 'П', line: 'Л', joint: 'F10',
  weldDate: '2026-10-01', technologyCardNumber: card.name, weldingMethod: 'РАД', connectionType: 'С17',
  materialGroup: 'М01', d1: 57, d2: 159, t1: 6, t2: 3, pstoRequired: false, fillerWire: 'Старая проволока',
  isometry: 'Историческая изометрия', weldingJournalNote: 'Не менять', version: '2026-11-07 10:00:00.123456+00' }

function fixture() {
  let row = { ...saved }
  const reads: Array<{ fields: unknown; query: ReturnType<PgDialect['sqlToQuery']> | undefined }> = []
  const tx = {
    select: vi.fn((fields?: Record<string, unknown>) => ({ from(table: unknown) {
      let predicate: Parameters<PgDialect['sqlToQuery']>[0] | undefined
      const query = {
        where(value: typeof predicate) { predicate = value; return query },
        orderBy() { return query }, limit() { return query }, for() { return query },
        then(resolve: (rows: unknown[]) => unknown) {
          if (table === technologyCards) return Promise.resolve(resolve([card]))
          if (table === technologyCardNames) return Promise.resolve(resolve([{ name: card.name, cardId: card.id }]))
          if (table !== weldJoints) throw new Error('Unexpected table')
          reads.push({ fields, query: predicate ? dialect.sqlToQuery(predicate) : undefined })
          return Promise.resolve(resolve([fields ? Object.fromEntries(Object.keys(fields).map(key => [key, row[key as keyof typeof row]])) : { ...row }]))
        },
      }
      return query
    } })),
    execute: vi.fn(async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
      const query = dialect.sqlToQuery(statement)
      const payload = query.params.find(value => typeof value === 'string' && value.startsWith('[{"id":')) as string
      const [change] = JSON.parse(payload)
      const { name, ...values } = change
      row = { ...row, ...values, technologyCardNumber: name }
      return { rows: [] }
    }),
  } as unknown as Parameters<typeof applyTechnologyCardAssignments>[0]
  return { tx, reads, current: () => row }
}

beforeEach(() => vi.clearAllMocks())

describe('technology card refresh and existing document names', () => {
  it('refreshes material-based titles using full previous data and title-only synchronization', async () => {
    const { tx, reads, current } = fixture()
    const title = (row: typeof saved) => buildDocumentTemplateName({ templateId: 'layeredVikEdges', periodFrom: '', periodTo: '', records: [row],
      config: { parts: [{ type: 'field', field: 'isometry' }, { type: 'text', text: ' — ' }, { type: 'field', field: 'fillerWire' }] } })
    let documentTitle = title(saved)
    vi.mocked(syncLayeredControlDocumentsForWeldChangesInTransaction).mockImplementation(async (_tx, rows, previous, options) => {
      expect(rows.map(row => row.id)).toEqual([saved.id])
      expect(previous.get(saved.id)).toMatchObject(saved)
      expect(options).toEqual({ refreshTitlesOnly: true })
      documentTitle = title(current())
    })
    const preview = await scanTechnologyCardAssignments(tx, {})
    const result = await applyTechnologyCardAssignments(tx, { context: preview.context, chunk: preview.chunks[0], actions: ['materials'], excludedIds: [] })
    expect(result.materials).toBe(1)
    expect(current()).toMatchObject({ fillerWire: card.fillerWire, isometry: saved.isometry, weldingJournalNote: saved.weldingJournalNote })
    expect(documentTitle).toBe('Историческая изометрия — Проволока из ТК')
    expect(syncLayeredControlDocumentsForWeldChangesInTransaction).toHaveBeenCalledOnce()
    const fullReads = reads.filter(read => read.fields === undefined)
    expect(fullReads).toHaveLength(1)
    expect(fullReads[0].query?.params).toEqual([[saved.id]])
    const settingsOrder = vi.mocked(lockWeldValidationSettings).mock.invocationCallOrder.at(-1)!
    expect(vi.mocked(lockLayeredControlDocumentsForWeldChange).mock.invocationCallOrder[0]).toBeLessThan(settingsOrder)
  })

  it('does not read full records or synchronize documents for excluded changes', async () => {
    const { tx, reads, current } = fixture()
    const preview = await scanTechnologyCardAssignments(tx, {})
    await applyTechnologyCardAssignments(tx, { context: preview.context, chunk: preview.chunks[0], actions: ['materials'], excludedIds: [saved.id] })
    expect(current()).toEqual(saved)
    expect(reads.filter(read => read.fields === undefined)).toHaveLength(0)
    expect(syncLayeredControlDocumentsForWeldChangesInTransaction).not.toHaveBeenCalled()
  })
})
