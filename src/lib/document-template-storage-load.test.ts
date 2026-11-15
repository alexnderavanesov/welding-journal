import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  deleteRemoteDocumentTemplate: vi.fn(),
  getRemoteDocumentTemplate: vi.fn(),
  getRemoteDocumentTemplateInventory: vi.fn(),
  cleanupRemoteDocumentTemplateFiles: vi.fn(),
  saveRemoteDocumentTemplate: vi.fn(),
  updateRemoteDocumentTemplate: vi.fn(),
}))

vi.mock('@/server/document-templates-api', () => apiMocks)

import { loadDocumentTemplateInventory, loadDocumentTemplate } from '@/lib/document-template-storage'

describe('document template metadata and selected-file loading', () => {
  beforeEach(() => vi.clearAllMocks())
  it('loads missing-file metadata and its version separately in one settings request', async () => {
    const { fileDataBase64: _, ...missing } = remoteTemplate('weldingJournal', 'ЖСР.xlsx', '')
    const { fileDataBase64: __, ...summary } = remoteTemplate('checklist', 'Чек-лист.xlsx', 'AwQ=')
    apiMocks.getRemoteDocumentTemplateInventory.mockResolvedValue({ templates: [summary], missing: [missing] })
    const inventory = await loadDocumentTemplateInventory()
    expect(inventory.templates.weldingJournal).toBeUndefined()
    expect(inventory.missing.weldingJournal).toEqual(missing)
    expect(inventory.templates.checklist).toEqual(summary)
    expect(inventory.templates.checklist).not.toHaveProperty('fileData')
    expect(inventory.templates.checklist).not.toHaveProperty('fileDataBase64')
    expect(apiMocks.getRemoteDocumentTemplateInventory).toHaveBeenCalledOnce()
    expect(apiMocks.getRemoteDocumentTemplate).not.toHaveBeenCalled()
  })

  it('loads only the selected file and does not retain its encoded duplicate', async () => {
    apiMocks.getRemoteDocumentTemplate.mockResolvedValue(remoteTemplate('checklist', 'Чек-лист.xlsx', 'AwQ='))
    const template = await loadDocumentTemplate('checklist')
    expect(template?.fileData).toEqual(new Uint8Array([3, 4]).buffer)
    expect(template).not.toHaveProperty('fileDataBase64')
    expect(apiMocks.getRemoteDocumentTemplate).toHaveBeenCalledExactlyOnceWith({ data: { id: 'checklist' } })
    expect(apiMocks.getRemoteDocumentTemplateInventory).not.toHaveBeenCalled()
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
