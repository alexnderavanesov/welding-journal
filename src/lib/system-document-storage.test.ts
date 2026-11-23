import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCurrentSystemDocumentBlob, loadSystemDocumentDateContext, loadSystemDocumentRows } from './system-document-storage'
import type { StoredDocumentTemplate } from './document-template-storage'
import type { SystemDocumentReference, SystemDocumentSummary } from './system-document-types'
import type { WeldRow } from './dispatcher-types'

const mocks = vi.hoisted(() => ({ rows: vi.fn(), context: vi.fn(), specialists: vi.fn(), blob: vi.fn() }))
vi.mock('@/server/system-documents', () => ({
  getSystemDocumentRows: mocks.rows, getSystemDocumentDateContext: mocks.context, getSystemDocumentSpecialists: mocks.specialists,
  listSystemDocumentHistoryFilterOptions: vi.fn(), listSystemDocumentHistoryGrid: vi.fn(), listWorkflowDocumentHistoryGrid: vi.fn(),
}))
vi.mock('@/lib/document-template-storage', () => ({ createWeldingJournalBlobFromTemplate: mocks.blob, loadDocumentTemplate: vi.fn() }))
vi.mock('@/lib/generated-document-storage', () => ({ downloadGeneratedDocument: vi.fn() }))

const identity: SystemDocumentReference = {
  documentId: 7, type: 'lnkConclusion', title: 'Общее заключение', date: '2026-08-10', methodCode: 'ВИК',
  sourceKind: 'beforeHeatTreatment', cycleSequences: [1, 2],
}
const snapshot = { first: { id: 5, name: 'Иванов И.И.', certificate: 'Сохранённое удостоверение', stamp: 'К5' }, second: null }
function largeSummary(): SystemDocumentSummary {
  return { ...identity, documentId: 7, id: 'system-document:7', label: 'Заключение', fileName: 'document.xlsx', methodCodes: ['ВИК'],
    rowCount: 10_000, positionCount: 10_000, projects: ['Проект'], subtitleCodes: ['01'], lines: ['L'],
    periodFrom: identity.date, periodTo: identity.date, updatedAt: identity.date, documentVersion: 'v7', specialistsRevision: 4,
    rowIds: Array.from({ length: 10_000 }, (_, index) => index + 1), jointComposition: 'L · F1 '.repeat(10_000),
  }
}
const template = { fileType: 'xlsx' } as StoredDocumentTemplate
const rows = [{ id: 1, vikConclusion: identity.title, vikConclusionDate: identity.date }] as WeldRow[]

describe('system document lookup payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rows.mockResolvedValue(rows)
    mocks.context.mockResolvedValue({ rows, sourcePositions: [] })
    mocks.specialists.mockResolvedValue(snapshot)
    mocks.blob.mockResolvedValue(new Blob(['document']))
  })
  it.each([
    ['rows', loadSystemDocumentRows, mocks.rows], ['date context', loadSystemDocumentDateContext, mocks.context],
  ] as const)('sends only identity fields in a %s GET when given a 10k-member summary', async (_name, load, request) => {
    const summary = { ...largeSummary(), specialists: snapshot }
    await load(summary)
    expect(JSON.stringify(request.mock.calls[0][0]).length).toBeLessThan(500)
    expect(request).toHaveBeenCalledExactlyOnceWith({ data: identity })
    expect(summary.specialists).toBe(snapshot)
    expect(summary.rowIds).toHaveLength(10_000)
  })
  it('uses a compact specialists GET and retains its returned snapshot in the exported template', async () => {
    await createCurrentSystemDocumentBlob({ reference: largeSummary(), rows, welderStamps: [], template })
    expect(JSON.stringify(mocks.specialists.mock.calls[0][0]).length).toBeLessThan(500)
    expect(mocks.specialists).toHaveBeenCalledExactlyOnceWith({ data: identity })
    expect(mocks.blob.mock.calls[0][2].systemDocument.specialists).toEqual(snapshot)
  })
  it.each(['reference', 'summary'] as const)('preserves an existing %s specialist snapshot without fetching a new one', async source => {
    const summary = { ...largeSummary(), specialists: snapshot }
    await createCurrentSystemDocumentBlob({
      reference: source === 'reference' ? summary : identity,
      summary: source === 'summary' ? summary : undefined, rows, welderStamps: [], template,
    })
    expect(mocks.specialists).not.toHaveBeenCalled()
    expect(mocks.blob.mock.calls[0][2].systemDocument.specialists).toEqual(snapshot)
  })
})
