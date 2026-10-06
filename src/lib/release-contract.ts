import journal from '../../drizzle/meta/_journal.json'

// A data release is explicit maintenance, never a side effect of opening a page.
// A future, different data transition requires a new release key/version.
export const DATA_RELEASE_KEY = 'maintenance:release:line-program:v1'
export const LINE_PROGRAM_TRANSITION_KEY = 'maintenance:line-program:v1'
export const REQUIRED_SCHEMA_TIME = journal.entries.at(-1)!.when
// Written only after the migration runner verifies Drizzle metadata. Runtime
// credentials need access to app_settings, not to the administrator's schema.
export const DATA_RELEASE_VALUE = JSON.stringify({ status: 'complete', schemaTime: REQUIRED_SCHEMA_TIME })

export function isCompletedTransition(value: string | null | undefined) {
  try { return JSON.parse(value ?? '').status === 'complete' } catch { return false }
}
