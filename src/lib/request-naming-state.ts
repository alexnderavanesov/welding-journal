export type RequestNamingState = {
  mode: 'system' | 'custom'
  customName: string
}

export const defaultRequestNamingState: RequestNamingState = { mode: 'system', customName: '' }
