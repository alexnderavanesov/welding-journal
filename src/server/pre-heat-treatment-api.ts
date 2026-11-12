import { createServerFn } from '@tanstack/react-start'
import type { PreHeatTreatmentFillRequest } from './pre-heat-treatment-fill'
import type { PreHeatTreatmentBatchRequest } from './pre-heat-treatment-batch'
import type { NewPreHeatTreatmentRequest } from './new-pre-heat-treatment'
export const previewNewPreHeatTreatment = createServerFn({ method: 'POST' })
  .validator((data: NewPreHeatTreatmentRequest) => data)
  .handler(async ({ data }) => (await import('./new-pre-heat-treatment')).previewNewPreHeatTreatment({ data }))
export const previewPreHeatTreatmentBatch = createServerFn({ method: 'POST' })
  .validator((data: PreHeatTreatmentBatchRequest) => data)
  .handler(async ({ data }) => (await import('./pre-heat-treatment-batch')).previewPreHeatTreatmentBatch({ data }))
export const savePreHeatTreatmentBatch = createServerFn({ method: 'POST' })
  .validator((data: PreHeatTreatmentBatchRequest) => data)
  .handler(async ({ data }) => (await import('./pre-heat-treatment-batch')).savePreHeatTreatmentBatch({ data }))
export const previewPreHeatTreatmentChain = createServerFn({ method: 'POST' })
  .validator((data: { rowId: number; required?: boolean }) => data)
  .handler(async ({ data }) => (await import('./pre-heat-treatment-chain')).previewPreHeatTreatmentChain({ data }))
export const previewPreHeatTreatmentFill = createServerFn({ method: 'POST' })
  .validator((data: PreHeatTreatmentFillRequest) => data)
  .handler(async ({ data }) => (await import('./pre-heat-treatment-fill')).previewPreHeatTreatmentFill({ data }))
export const savePreHeatTreatmentFill = createServerFn({ method: 'POST' })
  .validator((data: PreHeatTreatmentFillRequest) => data)
  .handler(async ({ data }) => (await import('./pre-heat-treatment-fill')).savePreHeatTreatmentFill({ data }))
