import type { SystemDocumentSplitMode, SystemDocumentSplitSettingId } from './system-document-splitting'
import type { SpecialistDraft, SpecialistRecord } from './document-specialists'
import type { SpecialistDefaults } from './specialist-defaults'

export type RequestNamingState = {
  specialists?: SpecialistDraft
  specialistDefaults?: SpecialistDefaults
  specialistDefaultRecords?: SpecialistRecord[]
  specialistProfile?: string
  mode: 'system' | 'custom'
  customName: string
  customGroupNames?: Record<string, string>
  /** Read-only server preview; invalidated by date, rule, membership or context changes. */
  systemGroupNames?: Record<string, { signature: string; name: string }>
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
