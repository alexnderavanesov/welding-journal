export type RequestNamingState = {
  mode: 'system' | 'custom'
  customName: string
  customGroupNames?: Record<string, string>
}

export const defaultRequestNamingState: RequestNamingState = {
  mode: 'system',
  customName: '',
  customGroupNames: {},
}
