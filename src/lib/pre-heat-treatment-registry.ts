export type PreHeatTreatmentRegistryFilters = {
  search: string
  methodCode: string
  requestFilter: 'all' | 'open' | 'fixed'
  resultFilter: 'all' | 'годен' | 'ремонт' | 'вырез'
}

export const DEFAULT_PRE_HEAT_TREATMENT_REGISTRY_FILTERS: PreHeatTreatmentRegistryFilters = {
  search: '', methodCode: '', requestFilter: 'all', resultFilter: 'all',
}
