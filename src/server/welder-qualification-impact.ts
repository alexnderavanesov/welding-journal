import { sql } from 'drizzle-orm'
import { appSettings, weldJoints } from '@/db/schema'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '@/lib/report-common-config'
import { OFFICIAL_STAMP_COMPATIBILITY_PROFILE_FIELDS as WELDER_QUALIFICATION_PROFILE_FIELDS } from '@/lib/welder-stamp-compatibility-profile'
import { getOfficialStampCompatibilityIssues } from '@/lib/welder-stamp-compatibility-issues'
import { normalizeStampForCompare } from '@/lib/welder-stamp-compatibility-utils'
import { DEFAULT_DATA_LIST_SETTINGS, normalizeDataListSettings } from '@/lib/data-list-settings'
import { normalizeSaveCheckSettings } from '@/lib/save-check-settings'
import { normalizeOtherSettings } from '@/lib/other-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import type { WeldInput } from '@/lib/weld-fields'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'
import type { DispatcherDirtyScope } from './dispatcher-task-index-dirty'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildWelderStampAliasWhere, MAX_SCOPED_REBUILD_SCOPES } from './dispatcher-dirty-scope-selection'

export { WELDER_QUALIFICATION_PROFILE_FIELDS }
export const MAX_WELDER_QUALIFICATION_PROFILES = 512
export type WelderQualificationProfile = Record<typeof WELDER_QUALIFICATION_PROFILE_FIELDS[number], string>

type QualificationImpactInput = {
  officialAliases: readonly string[]
  before: readonly WelderStampRecord[]
  after: readonly WelderStampRecord[]
  suspensions: readonly WelderStampSuspensionRecord[]
}

/** Caller retains the exclusive registry lock from snapshot validation through
 * persistence/invalidation. Only qualification edits belong here; decision-owner
 * deletion/rename and suspension writes must use the conservative scope loader.
 * null requests that same fallback; [] proves no observed qualification changes.
 * Bounds limit JS/transport, not the cost of the underlying DISTINCT SQL scan.
 */
export async function loadWelderQualificationImpactScopes(
  tx: Pick<SystemDocumentSequenceTransaction, 'execute'>,
  input: QualificationImpactInput,
): Promise<DispatcherDirtyScope[] | null> {
  if (!input.officialAliases.some(alias => normalizeStampForCompare(alias))) return []
  const aliasWhere = buildWelderStampAliasWhere(input.officialAliases)
  if (aliasWhere === null) return null
  const profiles = await tx.execute<WelderQualificationProfile>(sql`
    with qualification_use_profiles as (
      select distinct ${sql.join(WELDER_QUALIFICATION_PROFILE_FIELDS.map(key =>
        sql`${profileValue(key)} as ${sql.identifier(key)}`), sql`, `)}
      from ${weldJoints} where ${aliasWhere}
      limit ${MAX_WELDER_QUALIFICATION_PROFILES + 1}
    ) select * from qualification_use_profiles
  `)
  if (profiles.rows.length > MAX_WELDER_QUALIFICATION_PROFILES || profiles.rows.some(profile =>
    !profile || WELDER_QUALIFICATION_PROFILE_FIELDS.some(key => typeof profile[key] !== 'string'),
  )) return null
  if (!profiles.rows.length) return []

  // Same persisted settings and fallback as dispatcher-task-index.ts, never UI
  // localStorage. Administrative card archive is disabled by the audit builder.
  const settings = await tx.execute<{ key: string; value: string }>(sql`
    select ${appSettings.key} as "key", ${appSettings.value} as "value" from ${appSettings}
    where ${appSettings.key} = any(${sql.param([
      PROJECT_SETTING_KEYS.dataList, PROJECT_SETTING_KEYS.saveCheck, PROJECT_SETTING_KEYS.other,
    ])}::text[])
  `)
  const stored = (key: string) => {
    const value = settings.rows.find(row => row.key === key)?.value
    try { return value === undefined ? null : JSON.parse(value) } catch { return null }
  }
  const dataLists = normalizeDataListSettings(stored(PROJECT_SETTING_KEYS.dataList) ?? DEFAULT_DATA_LIST_SETTINGS)
  const other = normalizeOtherSettings(stored(PROJECT_SETTING_KEYS.other))
  const options = {
    archiveValidationMode: 'audit' as const,
    materialGroups: dataLists.materialGroups,
    weldingTypes: dataLists.weldingTypes,
    suspensions: input.suspensions,
    saveCheckSettings: { ...normalizeSaveCheckSettings(stored(PROJECT_SETTING_KEYS.saveCheck), {
      officialDlsFallback: other.requireDlsForOfficialStamps,
    }), officialArchive: false },
  }
  const before = recordsByAlias(input.before), after = recordsByAlias(input.after)
  const changed = profiles.rows.filter(profile => {
    const stamps = new Set(OFFICIAL_WELDER_STAMP_FIELD_KEYS.map(key => normalizeStampForCompare(profile[key])))
    const issues = (records: Map<string, WelderStampRecord[]>) => getOfficialStampCompatibilityIssues(
      profile as WeldInput, [...stamps].flatMap(stamp => records.get(stamp) ?? []), options,
    )
    // Task keys and details depend on ordered issues, not just a pass/fail flag.
    return JSON.stringify(issues(before)) !== JSON.stringify(issues(after))
  })
  if (!changed.length) return []

  const scopes = await tx.execute<DispatcherDirtyScope>(sql`
    with changed_qualification_profiles (${sql.join(WELDER_QUALIFICATION_PROFILE_FIELDS.map(key => sql.identifier(key)), sql`, `)}) as (
      values ${sql.join(changed.map(profile => sql`(${sql.join(WELDER_QUALIFICATION_PROFILE_FIELDS.map(key => sql`${profile[key]}::text`), sql`, `)})`), sql`, `)}
    )
    select distinct ${weldJoints.projectTitle} as "projectTitle", ${weldJoints.subtitleCode} as "subtitleCode", ${weldJoints.line} as "line"
    from ${weldJoints} where ${aliasWhere} and exists (
      select 1 from changed_qualification_profiles as "changed"
      where ${sql.join(WELDER_QUALIFICATION_PROFILE_FIELDS.map(key =>
        sql`${profileValue(key)} = ${sql.identifier('changed')}.${sql.identifier(key)}`), sql` and `)}
    ) limit ${MAX_SCOPED_REBUILD_SCOPES + 1}
  `)
  if (scopes.rows.length > MAX_SCOPED_REBUILD_SCOPES || scopes.rows.some(scope =>
    !scope || ['projectTitle', 'subtitleCode', 'line'].some(key => {
      const value = scope[key as keyof DispatcherDirtyScope]
      return value !== null && typeof value !== 'string'
    }),
  )) return null
  return scopes.rows.map(scope => ({ projectTitle: scope.projectTitle ?? '', subtitleCode: scope.subtitleCode ?? '', line: scope.line ?? '' }))
}

function profileValue(key: typeof WELDER_QUALIFICATION_PROFILE_FIELDS[number]) {
  // Match the evaluator's String(value ?? '') inputs. Use the exact same SQL
  // expression when joining back, including nulls and untrimmed stamp spelling.
  return sql`coalesce(${weldJoints[key]}::text, '')`
}

function recordsByAlias(records: readonly WelderStampRecord[]) {
  const result = new Map<string, WelderStampRecord[]>()
  // Persistence reads cards by ID, irrespective of the submitted snapshot order.
  for (const record of [...records].sort((left, right) => left.id - right.id)) {
    const key = normalizeStampForCompare(record.naksStamp)
    const matches = result.get(key) ?? []
    matches.push(record)
    result.set(key, matches)
  }
  return result
}
