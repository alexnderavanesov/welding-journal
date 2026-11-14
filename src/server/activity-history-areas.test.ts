import { beforeEach, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { SETTING_ACCESS_AREAS, type AccessIdentity, type Permission } from '@/lib/access-permissions'

const state = vi.hoisted(() => ({ identity: null as AccessIdentity | null, predicate: undefined as SQL | undefined }))
vi.mock('./access-context', () => ({ requireIdentity: async () => state.identity }))
vi.mock('@/db', () => ({ requireDb: () => ({ select: () => ({ from: () => ({ where: (predicate: SQL) => {
  state.predicate = predicate
  return { orderBy: () => ({ limit: async () => [] }) }
} }) }) }) }))

import { getActivityDetails } from './activity-history'

beforeEach(() => {
  state.predicate = undefined
  state.identity = { id: 'reader', name: 'Читатель', email: '', title: '', role: 'user', permissions: ['history.view'], revision: 1 }
})

async function selectedAreas() {
  await getActivityDetails({ operationId: '00000000-0000-4000-8000-000000000001' })
  return new PgDialect().sqlToQuery(state.predicate!).params
}

it.each([...new Set(Object.values(SETTING_ACCESS_AREAS))])('includes history of the authorized %s settings', async area => {
  state.identity!.permissions.push(`${area}.view` as Permission)
  expect(await selectedAreas()).toContain(area)
})

it('does not select warning-setting history without its view permission', async () => {
  state.identity!.permissions.push('welding.view')
  expect(await selectedAreas()).not.toContain('assignmentWarnings')
})

it('includes warning-setting history for an administrator', async () => {
  state.identity!.role = 'admin'
  expect(await selectedAreas()).toContain('assignmentWarnings')
})
