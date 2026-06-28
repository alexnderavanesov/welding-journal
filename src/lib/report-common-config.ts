import type { WeldFieldKey } from './weld-field-definitions'

export const WELDER_STAMP_WELD_TYPE_OPTIONS = ['РАД', 'РД', 'МП'] as const
export const WELDER_STAMP_EXPIRY_REMINDER_DAYS = 7
export const DAY_IN_MS = 24 * 60 * 60 * 1000
export const COLLAPSED_SECTIONS_STORAGE_PREFIX = 'welding-tracker-collapsed-sections'
export const HIGHLIGHT_DURATION_MS = 30000

export const OFFICIAL_WELDER_STAMP_FIELD_KEYS = [
  'stamp1K',
  'stamp1Z',
  'stamp1O',
  'stamp2K',
  'stamp2Z',
  'stamp2O',
] as const satisfies readonly WeldFieldKey[]

export const FACTUAL_WELDER_STAMP_FIELD_KEYS = [
  'stamp1KFact',
  'stamp1ZFact',
  'stamp1OFact',
  'stamp2KFact',
  'stamp2ZFact',
  'stamp2OFact',
] as const satisfies readonly WeldFieldKey[]

export const FACTUAL_WELDER_STAMP_FIELD_KEY_SET = new Set<WeldFieldKey>(FACTUAL_WELDER_STAMP_FIELD_KEYS)
export const WELDER_STAMP_FIELD_KEYS_FOR_DISPLAY: readonly WeldFieldKey[] = [
  ...OFFICIAL_WELDER_STAMP_FIELD_KEYS,
  ...FACTUAL_WELDER_STAMP_FIELD_KEYS,
]

