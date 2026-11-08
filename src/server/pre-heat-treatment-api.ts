import { createServerFn } from '@tanstack/react-start'
import type { PreHeatTreatmentFillRequest } from './pre-heat-treatment-fill'
export const previewPreHeatTreatmentChain = createServerFn({ method: 'POST' })
  .validator((data: { rowId: number; required?: boolean }) => data)
  .handler(async ({ data }) => (await import('./pre-heat-treatment-chain')).previewPreHeatTreatmentChain({ data }))
export const previewPreHeatTreatmentFill = createServerFn({ method: 'POST' })
  .validator((data: PreHeatTreatmentFillRequest) => data)
  .handler(async ({ data }) => (await import('./pre-heat-treatment-fill')).previewPreHeatTreatmentFill({ data }))
export const savePreHeatTreatmentFill = createServerFn({ method: 'POST' })
  .validator((data: PreHeatTreatmentFillRequest) => data)
  .handler(async ({ data }) => (await import('./pre-heat-treatment-fill')).savePreHeatTreatmentFill({ data }))
