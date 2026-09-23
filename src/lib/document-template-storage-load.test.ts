import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  deleteRemoteDocumentTemplate: vi.fn(),
  getRemoteDocumentTemplate: vi.fn(),
  listRemoteDocumentTemplatesWithFiles: vi.fn(),
  saveRemoteDocumentTemplate: vi.fn(),
  updateRemoteDocumentTemplate: vi.fn(),
}))

vi.mock('@/server/document-templates-api', () => apiMocks)

import { loadDocumentTemplates } from '@/lib/document-template-storage'

describe('document template bulk loading', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads every template through one server request', async () => {
    apiMocks.listRemoteDocumentTemplatesWithFiles.mockResolvedValue([
      remoteTemplate('weldingJournal', 'ЖСР.xlsx', 'AQI='),
      remoteTemplate('checklist', 'Чек-лист.xlsx', 'AwQ='),
    ])

    const templates = await loadDocumentTemplates()

    expect(apiMocks.listRemoteDocumentTemplatesWithFiles).toHaveBeenCalledTimes(1)
    expect(apiMocks.getRemoteDocumentTemplate).not.toHaveBeenCalled()
    expect(templates.weldingJournal?.fileData).toEqual(new Uint8Array([1, 2]).buffer)
    expect(templates.checklist?.fileData).toEqual(new Uint8Array([3, 4]).buffer)
  })
})

function remoteTemplate(
  id: 'weldingJournal' | 'checklist',
  fileName: string,
  fileDataBase64: string,
) {
  return {
    id,
    version: '2026-09-22T12:00:00.000Z',
    fileName,
    fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileSize: 2,
    uploadedAt: '2026-09-22T12:00:00.000Z',
    sheetNames: ['Лист1'],
    fields: [],
    markerCount: 0,
    locations: [],
    warnings: [],
    fileDataBase64,
  }
}
