import type { SystemDocumentSplitMode, SystemDocumentSplitSettingId } from './system-document-splitting'

export type RequestNamingState = {
  mode: 'system' | 'custom'
  customName: string
  customGroupNames?: Record<string, string>
  /** The operation's draft, never a live binding to another user's preference. */
  splitModes?: Partial<Record<SystemDocumentSplitSettingId, SystemDocumentSplitMode>>
  groupModes?: Record<string, 'system' | 'custom'>
  customGroupMembers?: Record<string, string>
  groupingDefaultsState?: 'loading' | 'ready' | 'error'
}

export const defaultRequestNamingState: RequestNamingState = {
  mode: 'system',
  customName: '',
  customGroupNames: {},
}
