import { expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { dispatcherAcceptedWarnings } from '@/db/schema'
import { buildAcceptedWarningCategoryWhere } from './dispatcher-warnings'

it.each(['percentage-line-control', 'line-program-control', 'early-coil'] as const)(
  'filters category %s in SQL instead of silently returning every decision', category => {
    const query = drizzle.mock().select().from(dispatcherAcceptedWarnings)
      .where(buildAcceptedWarningCategoryWhere(category)).toSQL()
    expect(query.params).toEqual([category])
    expect(query.sql).toContain('"dispatcher_accepted_warnings"."kind" = $1')
  },
)
it('keeps Other disjoint from all explicit kinds and All unfiltered', () => {
  const query = drizzle.mock().select().from(dispatcherAcceptedWarnings)
    .where(buildAcceptedWarningCategoryWhere('other')).toSQL()
  expect(query.params).toEqual(['percentage-line-control', 'line-program-control', 'early-coil'])
  expect(query.sql).toContain('not in')
  expect(buildAcceptedWarningCategoryWhere('all')).toBeUndefined()
})
