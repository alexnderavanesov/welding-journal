import type { PreHeatTreatmentFillOptions } from './pre-heat-treatment-fill'

export type PreHeatTreatmentConfirmation = {
  required: boolean
  token: string
  fill?: PreHeatTreatmentFillOptions
}
