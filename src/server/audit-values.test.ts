import { expect, it } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { weldJoints } from '@/db/schema'
import { businessFieldChanges } from './audited-database'
import { SERVICE_DATE_FIELDS } from '@/lib/weld-field-access'

it('captures every stored working joint field without a hand-maintained audit allowlist', () => {
  const keys = Object.keys(getTableColumns(weldJoints)).filter(key => key !== 'id' && !SERVICE_DATE_FIELDS.has(key))
  const before = Object.fromEntries(keys.map(key => [key, null]))
  const after = Object.fromEntries(keys.map(key => [key, `changed-${key}`]))
  const changes = businessFieldChanges(before, after)
  expect(Object.keys(changes).sort()).toEqual(keys.sort())
  for (const key of keys) expect(changes[key]).toEqual({ before: null, after: `changed-${key}` })
})
it('preserves missing, empty, zero and exact numeric changes while omitting repeated saves and technical timestamps', () => {
  expect(businessFieldChanges({ d1: 1.001, note: '', n: null, updatedAt: 'old' }, { d1: 1.002, note: '', n: 0, updatedAt: 'new' }))
    .toEqual({ d1: { before: 1.001, after: 1.002 }, n: { before: null, after: 0 } })
  expect(businessFieldChanges(undefined, { id: 1, note: null })).toEqual({ id: { after: 1 }, note: { after: null } })
  expect(businessFieldChanges({ id: 1, note: null }, undefined)).toEqual({ id: { before: 1 }, note: { before: null } })
  expect(businessFieldChanges({ note: 'same' }, { note: 'same' })).toEqual({})
})
