import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import * as compatibility from '@/lib/welder-stamp-compatibility-issues'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  loadWelderQualificationImpactScopes,
  MAX_WELDER_QUALIFICATION_PROFILES,
  WELDER_QUALIFICATION_PROFILE_FIELDS,
  type WelderQualificationProfile,
} from './welder-qualification-impact'

const dialect = new PgDialect()
const scope = { projectTitle: 'P', subtitleCode: 'S', line: 'L' }
const card: WelderStampRecord = {
  id: 1, naksStamp: 'AB12', internalStamp: '', welderName: '', archived: false,
  weldType: '', materialGroups: '', diameterFrom: '', diameterTo: '', thicknessFrom: '', thicknessTo: '', validFrom: '', validTo: '',
  naksPermits: [{ id: 'n1', weldType: 'РАД', materialGroups: 'М01', diameterFrom: '1', diameterTo: '500',
    thicknessFrom: '1', thicknessTo: '20', validFrom: '2026-01-01', validTo: '2026-12-31', note: '' }], dlsPermits: [],
}

function profile(overrides: Partial<WelderQualificationProfile> = {}): WelderQualificationProfile {
  return { stamp1K: 'AB12', stamp1Z: '', stamp1O: '', stamp2K: '', stamp2Z: '', stamp2O: '',
    weldingMethod: 'РАД', materialGroup: 'М01', connectionType: 'С17', d1: '100', d2: '100', t1: '5', t2: '5',
    weldDate: '2026-07-01', ...overrides }
}

function database(profiles: unknown[], settings: Array<{ key: string; value: string }> = [], scopes: unknown[] = [scope]) {
  const execute = vi.fn(async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement)
    if (query.sql.includes('qualification_use_profiles')) return { rows: profiles }
    if (query.sql.includes('changed_qualification_profiles')) return { rows: scopes }
    if (query.sql.includes('app_settings')) return { rows: settings }
    throw new Error(`Unexpected SQL: ${query.sql}`)
  })
  return { tx: { execute } as unknown as Parameters<typeof loadWelderQualificationImpactScopes>[0], execute,
    queries: () => execute.mock.calls.map(([statement]) => dialect.sqlToQuery(statement)) }
}

function input(after: WelderStampRecord[] = [{ ...card, naksPermits: [{ ...card.naksPermits[0], diameterTo: '200' }] }]) {
  return { officialAliases: ['AB12'], before: [card], after, suspensions: [] as WelderStampSuspensionRecord[] }
}

describe('bounded registry qualification profiles', () => {
  it('does not read welds/settings for metadata-only or unsafe aliases', async () => {
    const db = database([])
    expect(await loadWelderQualificationImpactScopes(db.tx, { ...input(), officialAliases: [] })).toEqual([])
    expect(await loadWelderQualificationImpactScopes(db.tx, { ...input(), officialAliases: ['КЛ12'] })).toBeNull()
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('selects every evaluator input, preserves null/empty semantics and caps profiles before any evaluation', async () => {
    const db = database([])
    expect(await loadWelderQualificationImpactScopes(db.tx, input())).toEqual([])
    expect(db.execute).toHaveBeenCalledOnce()
    const [query] = db.queries()
    expect(query.sql).toContain('select distinct')
    expect(query.params).toContain(MAX_WELDER_QUALIFICATION_PROFILES + 1)
    expect(WELDER_QUALIFICATION_PROFILE_FIELDS).toEqual([
      'stamp1K', 'stamp1Z', 'stamp1O', 'stamp2K', 'stamp2Z', 'stamp2O',
      'weldingMethod', 'materialGroup', 'connectionType', 'd1', 'd2', 't1', 't2', 'weldDate',
    ])
    for (const field of WELDER_QUALIFICATION_PROFILE_FIELDS) expect(query.sql).toContain(`as "${field}"`)
    expect(query.sql).toContain('coalesce(')
    expect(query.sql).not.toContain('select * from "weld_joints"')
    expect(query.sql).not.toContain('officiality')
    expect(query.sql).not.toContain('_fact')
  })

  it.each([1, 512])('skips unchanged eligibility for %i profiles using two queries, not per-profile SQL', async count => {
    const db = database(Array.from({ length: count }, (_, i) => profile({ d1: String(1 + i / 10) })))
    expect(await loadWelderQualificationImpactScopes(db.tx, input())).toEqual([])
    expect(db.execute).toHaveBeenCalledTimes(2)
  })

  it('returns conservative fallback at 513 profiles without evaluating or loading settings', async () => {
    const db = database(Array.from({ length: 513 }, () => profile()))
    const spy = vi.spyOn(compatibility, 'getOfficialStampCompatibilityIssues')
    try {
      expect(await loadWelderQualificationImpactScopes(db.tx, input())).toBeNull()
      expect(db.execute).toHaveBeenCalledOnce()
      expect(spy).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })

  it.each([{}, { ...profile(), d1: null }, { ...profile(), weldDate: new Date() }])('falls back for an unsafe profile: %j', async bad => {
    const db = database([bad])
    expect(await loadWelderQualificationImpactScopes(db.tx, input())).toBeNull()
    expect(db.execute).toHaveBeenCalledOnce()
  })

  it('selects only changed exact profiles in one batch and leaves full-context expansion to the caller', async () => {
    const unchanged = profile({ d1: '100', d2: '100' }), changed = profile({ d1: '300', d2: '300', stamp1K: ' ab12\u00a0' })
    const db = database([unchanged, changed])
    expect(await loadWelderQualificationImpactScopes(db.tx, input())).toEqual([scope])
    expect(db.execute).toHaveBeenCalledTimes(3)
    const query = db.queries()[2]
    expect(query.sql).toContain('exists')
    expect(query.sql).toContain('select distinct')
    expect(query.params).toContain(501)
    expect(query.params).toContain('300')
    expect(query.params).not.toContain('100')
    expect(query.params).toContain(' ab12\u00a0')
    for (const field of WELDER_QUALIFICATION_PROFILE_FIELDS) expect(query.sql).toContain(`"changed"."${field}"`)
  })

  it('batches 512 changed profiles without additional SQL and keeps the scope limit', async () => {
    const db = database(Array.from({ length: 512 }, (_, i) => profile({ d1: String(201 + i / 10), d2: String(201 + i / 10) })))
    const spy = vi.spyOn(compatibility, 'getOfficialStampCompatibilityIssues')
    try {
      expect(await loadWelderQualificationImpactScopes(db.tx, input())).toEqual([scope])
      expect(spy).toHaveBeenCalledTimes(2 * 512)
    } finally { spy.mockRestore() }
    expect(db.execute).toHaveBeenCalledTimes(3)
    const overflow = database([profile({ d1: '300', d2: '300' })], [], Array.from({ length: 501 }, (_, i) => ({ ...scope, line: String(i) })))
    expect(await loadWelderQualificationImpactScopes(overflow.tx, input())).toBeNull()
  })

  it('compares issue text, not just eligibility or reason keys', async () => {
    const dls = { ...card, dlsPermits: [{ ...card.naksPermits[0], number: 'ДЛС-1', diameterTo: '5' }] }
    const after = { ...dls, dlsPermits: [{ ...dls.dlsPermits[0], weldType: 'РД' }] }
    const db = database([profile()], [{ key: PROJECT_SETTING_KEYS.saveCheck, value: '{"officialDls":true}' }])
    // Both states produce reason=dls, but one describes D and the other the welding method.
    expect(await loadWelderQualificationImpactScopes(db.tx, { ...input([after]), before: [dls] })).toEqual([scope])
  })

  it('uses other.requireDlsForOfficialStamps fallback and explicit save-check override', async () => {
    const dls = { ...card, dlsPermits: [{ ...card.naksPermits[0], number: 'ДЛС-1' }] }
    const args = { ...input([card]), before: [dls] }
    const other = { key: PROJECT_SETTING_KEYS.other, value: '{"requireDlsForOfficialStamps":true}' }
    expect(await loadWelderQualificationImpactScopes(database([profile()], [other]).tx, args)).toEqual([scope])
    expect(await loadWelderQualificationImpactScopes(database([profile()], [other,
      { key: PROJECT_SETTING_KEYS.saveCheck, value: '{"officialDls":false}' },
    ]).tx, args)).toEqual([])
  })

  it('uses persisted welding types rather than browser/default lists', async () => {
    const custom = { ...card, naksPermits: [{ ...card.naksPermits[0], weldType: 'РД' }] }
    const after = { ...custom, naksPermits: [{ ...custom.naksPermits[0], weldType: 'МАД' }] }
    const db = database([profile({ weldingMethod: 'МАД' })], [{ key: PROJECT_SETTING_KEYS.dataList, value: '{"weldingTypes":["МАД"]}' }])
    expect(await loadWelderQualificationImpactScopes(db.tx, { ...input([after]), before: [custom] })).toEqual([scope])
  })

  it('keeps historical archived permits and suppresses administrative card-archive checks like the dispatcher', async () => {
    const archived = { ...card, archived: true, archivedAt: '2026-01-01', naksPermits: [{ ...card.naksPermits[0], archived: true }] }
    const after = { ...archived, naksPermits: [{ ...archived.naksPermits[0], validTo: '2026-06-01' }] }
    const db = database([profile()])
    expect(await loadWelderQualificationImpactScopes(db.tx, { ...input([after]), before: [archived] })).toEqual([scope])
    expect(await loadWelderQualificationImpactScopes(database([profile()]).tx, { ...input([archived]), before: [card] })).toEqual([])
  })

  it('keeps empty-date archived-candidate behavior and suspension precedence', async () => {
    const archived = { ...card, naksPermits: [{ ...card.naksPermits[0], archived: true }] }
    expect(await loadWelderQualificationImpactScopes(database([profile({ weldDate: '' })]).tx,
      { ...input([archived]), before: [card] })).toEqual([])
    expect(await loadWelderQualificationImpactScopes(database([profile({ d1: '300', d2: '300' })]).tx, {
      ...input(), suspensions: [{ id: 1, naksStamp: 'AB12', suspendedFrom: '2026-06-01', suspendedTo: '2026-08-01' }],
    })).toEqual([])
  })

  it('evaluates all cards of a shared alias and all six team positions, including dissimilar-material sides', async () => {
    const other = { ...card, id: 2, naksStamp: 'CD34', naksPermits: [{ ...card.naksPermits[0], weldType: 'РД', materialGroups: 'М01, М05' }] }
    const both = { ...card, naksPermits: [{ ...card.naksPermits[0], materialGroups: 'М01, М05' }] }
    const reduced = { ...other, naksPermits: [{ ...other.naksPermits[0], materialGroups: 'М01' }] }
    expect(await loadWelderQualificationImpactScopes(database([profile({ stamp1K: 'CD34', stamp2O: 'AB12', weldingMethod: 'РАД, РД', materialGroup: 'М01 + М05' })]).tx,
      { ...input([both, reduced]), before: [both, other], officialAliases: ['CD34'] })).toEqual([scope])
    const duplicate = { ...card, id: 2 }
    expect(await loadWelderQualificationImpactScopes(database([profile({ d1: '300', d2: '300' })]).tx,
      { ...input(), before: [card, duplicate], after: [duplicate, ...input().after] })).toEqual([])
  })

  it('ignores submitted card order but keeps ordered messages from permit order changes', async () => {
    const first = { ...card, naksPermits: [card.naksPermits[0], { ...card.naksPermits[0], id: 'n2', weldType: 'РД', materialGroups: 'М05' }] }
    const second = { ...card, id: 2, naksPermits: [{ ...card.naksPermits[0], id: 'n3', weldType: 'МАД', materialGroups: 'М05' }] }
    const row = profile({ materialGroup: 'М01 + М05' })
    expect(await loadWelderQualificationImpactScopes(database([row]).tx,
      { ...input([second, first]), before: [first, second] })).toEqual([])
    const combined = { ...card, naksPermits: [...first.naksPermits, ...second.naksPermits] }
    expect(await loadWelderQualificationImpactScopes(database([row]).tx,
      { ...input([{ ...combined, naksPermits: [...combined.naksPermits].reverse() }]), before: [combined] })).toEqual([scope])
  })

  it.each(['stamp1K', 'stamp1Z', 'stamp1O', 'stamp2K', 'stamp2Z', 'stamp2O'] as const)(
    'detects qualification changes in official position %s', async field => {
      const db = database([profile({ stamp1K: '', [field]: 'AB12', d1: '300', d2: '300' })])
      expect(await loadWelderQualificationImpactScopes(db.tx, input())).toEqual([scope])
    },
  )

  it('propagates database errors rather than turning them into an empty impact', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('read failed'))
    await expect(loadWelderQualificationImpactScopes({ execute } as never, input())).rejects.toThrow('read failed')
  })
})
