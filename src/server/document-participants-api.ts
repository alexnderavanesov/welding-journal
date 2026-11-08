import { createServerFn } from '@tanstack/react-start'
import type { ParticipantKind } from '@/lib/document-template-participants'
export const getDocumentTemplateParticipants = createServerFn({ method: 'POST' })
  .validator((data: { rowIds: number[]; kinds: ParticipantKind[] }) => data)
  .handler(async ({ data }) => (await import('./document-participants')).loadDocumentTemplateParticipants(data))
