import { describe, expect, it } from 'vitest'
import { getWelderStampDispatcherImpact, getWelderStampSuspensionDispatcherImpact } from './welder-stamp-dispatcher-impact'
import type { WelderStampNaksPermit, WelderStampRecord } from './welder-stamp-types'

const card: WelderStampRecord = {
  id: 1, naksStamp: 'AB12', internalStamp: 'I-1', welderName: 'Иванов', archived: false, archivedAt: '',
  weldType: 'РАД', materialGroups: 'М01', diameterFrom: '1', diameterTo: '500', thicknessFrom: '1', thicknessTo: '20',
  validFrom: '2026-01-01', validTo: '2026-12-31',
  naksPermits: [{ id: 'n1', weldType: 'РАД', materialGroups: 'М01', diameterFrom: '1', diameterTo: '500',
    thicknessFrom: '1', thicknessTo: '20', validFrom: '2026-01-01', validTo: '2026-12-31', note: '', archived: false }],
  dlsPermits: [],
}
const unchanged = { changed: false, officialAliases: [], decisionOwnerIds: [] }
const remindersOnly = { changed: true, officialAliases: [], decisionOwnerIds: [] }
const qualificationChanged = { changed: true, officialAliases: ['AB12'], decisionOwnerIds: [] }
const qualificationFields = ['validFrom', 'validTo', 'weldType', 'materialGroups', 'diameterFrom', 'diameterTo', 'thicknessFrom', 'thicknessTo'] as const
const emptyPermit: WelderStampNaksPermit = {
  id: 'empty', weldType: '', materialGroups: '', diameterFrom: '', diameterTo: '',
  thicknessFrom: '', thicknessTo: '', validFrom: '', validTo: '', note: '', archived: false,
}

describe('registry change dependency classification', () => {
  it('ignores card order and JSON property order, but not changes to another card in the submitted snapshot', () => {
    const second = { ...card, id: 2, naksStamp: 'CD34' }
    const reordered = Object.fromEntries(Object.entries(card).reverse()) as WelderStampRecord
    expect(getWelderStampDispatcherImpact([card, second], [second, reordered])).toEqual(unchanged)
    expect(getWelderStampDispatcherImpact([card, second], [card, {
      ...second, naksPermits: [{ ...second.naksPermits[0], validTo: '2026-10-01' }],
    }]))
      .toEqual({ changed: true, officialAliases: ['CD34'], decisionOwnerIds: [] })
  })

  it.each<Partial<WelderStampRecord>>([
    { welderName: 'Петров' }, { internalStamp: 'I-2' }, { archived: true, archivedAt: '2026-10-14' },
    { archivedAt: '2026-10-13' },
  ])('updates registry projections without touching joint tasks for %j', change => {
    expect(getWelderStampDispatcherImpact([card], [{ ...card, ...change }]))
      .toEqual({ changed: true, officialAliases: [], decisionOwnerIds: [] })
  })

  it.each(qualificationFields)(
    'invalidates all weld dates for a changed permit %s', field => {
      const changed = { ...card, naksPermits: [{ ...card.naksPermits[0], [field]: 'changed' }] }
      expect(getWelderStampDispatcherImpact([card], [changed]).officialAliases).toEqual(['AB12'])
    },
  )

  it.each(qualificationFields)('keeps DLS qualification dependency for %s', field => {
    const before = { ...card, dlsPermits: [{ ...card.naksPermits[0], id: 'd1', number: 'ДЛС-1' }] }
    const after = { ...before, dlsPermits: [{ ...before.dlsPermits[0], [field]: 'changed' }] }
    expect(getWelderStampDispatcherImpact([before], [after])).toEqual(qualificationChanged)
  })

  it.each(['id', 'note'] as const)('persists NAKS %s and refreshes reminders without joint invalidation', field => {
    const after = { ...card, naksPermits: [{ ...card.naksPermits[0], [field]: 'changed' }] }
    expect(getWelderStampDispatcherImpact([card], [after])).toEqual(remindersOnly)
  })

  it.each(['id', 'note', 'number'] as const)('persists DLS %s and refreshes reminders without joint invalidation', field => {
    const before = { ...card, dlsPermits: [{ ...card.naksPermits[0], id: 'd1', number: 'ДЛС-1' }] }
    const after = { ...before, dlsPermits: [{ ...before.dlsPermits[0], [field]: 'changed' }] }
    expect(getWelderStampDispatcherImpact([before], [after])).toEqual(remindersOnly)
  })

  it.each(qualificationFields)('uses legacy %s only when it supplies the effective fallback', field => {
    const legacy = { ...card, naksPermits: [] }
    expect(getWelderStampDispatcherImpact([legacy], [{ ...legacy, [field]: 'changed' }]))
      .toEqual(qualificationChanged)
    expect(getWelderStampDispatcherImpact([card], [{ ...card, [field]: 'changed' }]))
      .toEqual(remindersOnly)
  })

  it('keeps legacy qualification stable across resubmission, metadata edits and explicit equivalent permits', () => {
    const legacy = { ...card, naksPermits: [] }
    expect(getWelderStampDispatcherImpact([legacy], [{ ...legacy }])).toEqual(unchanged)
    expect(getWelderStampDispatcherImpact([legacy], [{ ...legacy, welderName: 'Петров' }])).toEqual(remindersOnly)
    expect(getWelderStampDispatcherImpact([legacy], [card])).toEqual(remindersOnly)
    expect(getWelderStampDispatcherImpact([card], [legacy])).toEqual(remindersOnly)
  })

  it('resolves meaningful NAKS notes before projecting qualification, including legacy fallback restoration', () => {
    const fallback = { ...card, naksPermits: [{ ...emptyPermit }] }
    const noteOnly = { ...card, naksPermits: [{ ...emptyPermit, note: 'legacy note' }] }
    expect(getWelderStampDispatcherImpact([fallback], [noteOnly])).toEqual(qualificationChanged)
    expect(getWelderStampDispatcherImpact([noteOnly], [fallback])).toEqual(qualificationChanged)
    expect(getWelderStampDispatcherImpact([noteOnly], [{
      ...noteOnly, naksPermits: [{ ...emptyPermit, note: 'another note', id: 'another-id' }],
    }])).toEqual(remindersOnly)
    expect(getWelderStampDispatcherImpact([fallback], [{
      ...fallback, naksPermits: [{ ...emptyPermit, id: 'another-id' }],
    }])).toEqual(remindersOnly)
  })

  it.each(['number', 'note'] as const)('resolves DLS meaningful-only %s before dropping metadata', field => {
    const emptyDls = { ...card, dlsPermits: [{ ...emptyPermit, number: '' }] }
    const meaningful = { ...card, dlsPermits: [{ ...emptyPermit, number: '', [field]: 'present' }] }
    expect(getWelderStampDispatcherImpact([emptyDls], [meaningful])).toEqual(qualificationChanged)
    expect(getWelderStampDispatcherImpact([meaningful], [emptyDls])).toEqual(qualificationChanged)
    expect(getWelderStampDispatcherImpact([meaningful], [{
      ...meaningful, dlsPermits: [{ ...meaningful.dlsPermits[0], [field]: 'renamed', id: 'another-id' }],
    }])).toEqual(remindersOnly)
  })

  it('retains qualification-neutral DLS metadata changes when either note or number keeps it meaningful', () => {
    const numbered = { ...card, dlsPermits: [{ ...emptyPermit, number: 'ДЛС-1' }] }
    const noted = { ...card, dlsPermits: [{ ...emptyPermit, number: '', note: 'legacy note' }] }
    expect(getWelderStampDispatcherImpact([numbered], [noted])).toEqual(remindersOnly)
  })

  it('preserves effective NAKS/DLS order and permit archival, including already archived cards', () => {
    const naksPermits = [card.naksPermits[0], { ...card.naksPermits[0], id: 'n2', weldType: 'РД' }]
    const dlsPermits = naksPermits.map((permit, index) => ({ ...permit, id: `d${index}`, number: `ДЛС-${index}` }))
    const before = { ...card, archived: true, archivedAt: '2026-10-01', naksPermits, dlsPermits }
    for (const after of [
      { ...before, naksPermits: [...naksPermits].reverse() },
      { ...before, dlsPermits: [...dlsPermits].reverse() },
      { ...before, naksPermits: naksPermits.map(permit => ({ ...permit, archived: true })) },
      { ...before, dlsPermits: dlsPermits.map(permit => ({ ...permit, archived: true })) },
    ]) expect(getWelderStampDispatcherImpact([before], [after])).toEqual(qualificationChanged)
  })

  it.each(['naksPermits', 'dlsPermits'] as const)('keeps edits to already archived %s qualification significant', key => {
    const archivedPermit = { ...card.naksPermits[0], number: 'ДЛС-1', archived: true }
    const before = { ...card, [key]: [archivedPermit] }
    expect(getWelderStampDispatcherImpact([before], [{
      ...before, [key]: [{ ...archivedPermit, validTo: '2026-09-30' }],
    }])).toEqual(qualificationChanged)
    expect(getWelderStampDispatcherImpact([before], [{
      ...before, [key]: [{ ...archivedPermit, note: 'metadata', id: 'another-id', number: 'ДЛС-2' }],
    }])).toEqual(remindersOnly)
  })

  it('ignores nonmeaningful placeholders without dropping their persisted changes', () => {
    expect(getWelderStampDispatcherImpact([card], [{
      ...card, naksPermits: [emptyPermit, ...card.naksPermits], dlsPermits: [{ ...emptyPermit, number: '' }],
    }])).toEqual(remindersOnly)
    const legacy = { ...card, naksPermits: [] }
    expect(getWelderStampDispatcherImpact([legacy], [{ ...legacy, naksPermits: [emptyPermit] }]))
      .toEqual(remindersOnly)
  })

  it('normalizes effective permit values without treating normalized spellings as qualification changes', () => {
    const after = { ...card, naksPermits: [{ ...card.naksPermits[0],
      weldType: ' рад ', materialGroups: ' м01 ', validFrom: '01.01.2026', diameterFrom: ' 1 ', archived: undefined,
    }] }
    expect(getWelderStampDispatcherImpact([card], [after])).toEqual(remindersOnly)
  })

  it('keeps mixed and duplicate-card edits independent; never merges their qualifications or owners', () => {
    const duplicate = { ...card, id: 2 }
    const other = { ...card, id: 3, naksStamp: 'CD34' }
    const metadataOnly = { ...card, naksPermits: [{ ...card.naksPermits[0], note: 'updated' }] }
    const changedOther = { ...other, naksPermits: [{ ...other.naksPermits[0], thicknessTo: '5' }] }
    expect(getWelderStampDispatcherImpact([card, duplicate, other], [changedOther, duplicate, metadataOnly]))
      .toEqual({ changed: true, officialAliases: ['CD34'], decisionOwnerIds: [] })
    expect(getWelderStampDispatcherImpact([card, duplicate], [metadataOnly]))
      .toEqual({ changed: true, officialAliases: ['AB12'], decisionOwnerIds: [2] })
    expect(getWelderStampDispatcherImpact([card, duplicate], [card, {
      ...duplicate, naksPermits: [{ ...duplicate.naksPermits[0], thicknessTo: '5' }],
    }])).toEqual(qualificationChanged)
  })

  it('distinguishes permit archiving/removal from card archiving and covers DLS as well as legacy summaries', () => {
    const archivedPermit = { ...card, naksPermits: [{ ...card.naksPermits[0], archived: true }] }
    const withDls = { ...card, dlsPermits: [{ ...card.naksPermits[0], id: 'd1', number: 'ДЛС-1' }] }
    const legacy = { ...card, naksPermits: [] }
    for (const [before, after] of [[card, archivedPermit], [withDls, card], [legacy, { ...legacy, thicknessTo: '5' }]]) {
      expect(getWelderStampDispatcherImpact([before], [after]).officialAliases).toEqual(['AB12'])
    }
  })

  it('keeps both names, added missing-registry matches, and deleted duplicate-card decision owners', () => {
    expect(getWelderStampDispatcherImpact([card], [{ ...card, naksStamp: 'CD34' }]))
      .toEqual({ changed: true, officialAliases: ['AB12', 'CD34'], decisionOwnerIds: [1] })
    expect(getWelderStampDispatcherImpact([], [card]).officialAliases).toEqual(['AB12'])
    expect(getWelderStampDispatcherImpact([card, { ...card, id: 2 }], [card]))
      .toEqual({ changed: true, officialAliases: ['AB12'], decisionOwnerIds: [2] })
  })

  it('preserves reminder identity changes even when the official alias only changes case', () => {
    expect(getWelderStampDispatcherImpact([{ ...card, naksStamp: 'ab12' }], [card]))
      .toEqual({ changed: true, officialAliases: [], decisionOwnerIds: [1] })
  })

  it('does not assign official joint dependencies to an internal-only card', () => {
    expect(getWelderStampDispatcherImpact([], [{ ...card, naksStamp: '', naksPermits: [] }]))
      .toEqual({ changed: true, officialAliases: [], decisionOwnerIds: [] })
  })

  it('covers old/new suspension names and all dates, including removal and open intervals', () => {
    const suspension = { id: 1, naksStamp: 'AB12', suspendedFrom: '2026-07-01', suspendedTo: '' }
    expect(getWelderStampSuspensionDispatcherImpact([suspension], [{ ...suspension }])).toEqual(unchanged)
    expect(getWelderStampSuspensionDispatcherImpact([suspension], [{ ...suspension, naksStamp: 'CD34' }]).officialAliases)
      .toEqual(['AB12', 'CD34'])
    for (const after of [[], [{ ...suspension, suspendedTo: '2026-08-01' }], [{ ...suspension, suspendedFrom: '2026-06-01' }]]) {
      expect(getWelderStampSuspensionDispatcherImpact([suspension], after).officialAliases).toEqual(['AB12'])
    }
  })
})
