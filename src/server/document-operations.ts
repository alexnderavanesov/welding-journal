import { createServerFn } from '@tanstack/react-start'
import type { DocumentOperationRequest } from '@/lib/system-document-operation'

export const planDocumentOperationBatches = createServerFn({ method: 'POST' })
  .validator((data: { documentIds: number[]; merge: boolean }) => data)
  .handler(async ({ data }) => (await import('./document-operation-service')).planOperationBatches(data))

export const previewDocumentOperation = createServerFn({ method: 'POST' })
  .validator((data: DocumentOperationRequest) => data)
  .handler(async ({ data }) => (await import('./document-operation-service')).previewOperation(data))

export const applyDocumentOperation = createServerFn({ method: 'POST' })
  .validator((data: DocumentOperationRequest & { fingerprint: string; previewHash: string; operationId: string; acceptSpecialistClearing?: boolean }) => data)
  .handler(async ({ data }) => (await import('./document-operation-service')).applyOperation(data))

export const getDocumentOperationResult = createServerFn({ method: 'POST' })
  .validator((data: { operationId: string }) => data)
  .handler(async ({ data }) => (await import('./document-operation-service')).getOperationResult(data.operationId))

export const getDocumentOperationComposition = createServerFn({ method: 'POST' })
  .validator((data: DocumentOperationRequest & { fingerprint: string; groupKey: string; query: string; page: number }) => data)
  .handler(async ({ data }) => (await import('./document-operation-service')).getOperationComposition(data))
