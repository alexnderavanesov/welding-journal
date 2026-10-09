import { createServerFn } from '@tanstack/react-start'
import type { TechnologyCardPageRequest } from '@/server/technology-card-registry'
import type { TechnologyCardAssignmentApplyInput, TechnologyCardAssignmentChunk, TechnologyCardAssignmentContext } from '@/lib/technology-card-assignment'

export type TechnologyCardChange =
  | { action: 'create'; card: unknown }
  | { action: 'update'; id: number; expectedRevision: number; card: unknown }
  | { action: 'archive'; id: number; expectedRevision: number; archived: boolean }
  | { action: 'delete'; id: number; expectedRevision: number; confirmed: boolean }

export const getTechnologyCardPage = createServerFn({ method: 'GET' })
  .validator((data: TechnologyCardPageRequest) => data)
  .handler(async ({ data }) => (await import('@/server/technology-cards')).getPage(data))

export const getTechnologyCardSnapshot = createServerFn({ method: 'GET' })
  .handler(async () => (await import('@/server/technology-cards')).getSnapshot())

export const changeTechnologyCard = createServerFn({ method: 'POST' })
  .validator((data: TechnologyCardChange) => data)
  .handler(async ({ data }) => (await import('@/server/technology-cards')).changeCard(data))

export const previewTechnologyCardAssignments = createServerFn({ method: 'GET' })
  .validator((data: { context?: TechnologyCardAssignmentContext; afterId?: number }) => data)
  .handler(async ({ data }) => (await import('@/server/technology-cards')).previewAssignments(data))

export const getTechnologyCardAssignmentDetails = createServerFn({ method: 'POST' })
  .validator((data: { context: TechnologyCardAssignmentContext; chunk: TechnologyCardAssignmentChunk }) => data)
  .handler(async ({ data }) => (await import('@/server/technology-cards')).assignmentDetails(data))

export const applyTechnologyCardAssignmentBatch = createServerFn({ method: 'POST' })
  .validator((data: TechnologyCardAssignmentApplyInput) => data)
  .handler(async ({ data }) => (await import('@/server/technology-cards')).applyAssignments(data))
