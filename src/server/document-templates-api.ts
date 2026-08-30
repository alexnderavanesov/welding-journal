import { createServerFn } from '@tanstack/react-start'
import type {
  DocumentTemplateConstructorConfig,
  DocumentTemplateId,
  DocumentTemplateOptions,
  StoredDocumentTemplate,
  TemplateMarkerLocation,
} from '@/lib/document-template-storage'

export type RemoteDocumentTemplate = Omit<StoredDocumentTemplate, 'fileData'> & {
  fileDataBase64: string
}

export type RemoteDocumentTemplateSummary = Omit<StoredDocumentTemplate, 'fileData'>

type SaveDocumentTemplateInput = {
  id: DocumentTemplateId
  fileName: string
  fileType: string
  fileSize: number
  fileDataBase64: string
  sheetNames?: string[]
  fields: string[]
  markerCount: number
  locations: TemplateMarkerLocation[]
  warnings: string[]
  constructorConfig?: DocumentTemplateConstructorConfig | null
}

type UpdateDocumentTemplateInput = {
  id: DocumentTemplateId
  options?: DocumentTemplateOptions
  constructorConfig?: DocumentTemplateConstructorConfig
}

export const listRemoteDocumentTemplates = createServerFn({ method: 'GET' })
  .handler(async (): Promise<RemoteDocumentTemplateSummary[]> => {
    const server = await import('@/server/document-templates')
    return server.listRemoteDocumentTemplates()
  })

export const listRemoteDocumentTemplateIds = createServerFn({ method: 'GET' })
  .handler(async (): Promise<DocumentTemplateId[]> => {
    const server = await import('@/server/document-templates')
    return server.listRemoteDocumentTemplateIds() as Promise<DocumentTemplateId[]>
  })

export const getRemoteDocumentTemplate = createServerFn({ method: 'GET' })
  .validator((data: { id: DocumentTemplateId }) => data)
  .handler(async ({ data }): Promise<RemoteDocumentTemplate | null> => {
    const server = await import('@/server/document-templates')
    return server.getRemoteDocumentTemplate({ data })
  })

export const saveRemoteDocumentTemplate = createServerFn({ method: 'POST' })
  .validator((data: SaveDocumentTemplateInput) => data)
  .handler(async ({ data }): Promise<RemoteDocumentTemplate> => {
    const server = await import('@/server/document-templates')
    return server.saveRemoteDocumentTemplate({ data })
  })

export const updateRemoteDocumentTemplate = createServerFn({ method: 'POST' })
  .validator((data: UpdateDocumentTemplateInput) => data)
  .handler(async ({ data }): Promise<RemoteDocumentTemplateSummary | null> => {
    const server = await import('@/server/document-templates')
    return server.updateRemoteDocumentTemplate({ data })
  })

export const deleteRemoteDocumentTemplate = createServerFn({ method: 'POST' })
  .validator((data: { id: DocumentTemplateId }) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/document-templates')
    return server.deleteRemoteDocumentTemplate({ data })
  })
