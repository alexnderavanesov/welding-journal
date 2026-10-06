import { describe, expect, it } from 'vitest'
import { normalizeStatisticsServerRequest } from './statistics'
import type { StatisticsServerRequest } from '@/lib/statistics-server-summary'

describe('statistics no longer publishes the replaced percentage-line calculator', () => {
  it('directs stale clients to the line program before any data load', () => {
    expect(() => normalizeStatisticsServerRequest({ tab: 'percentageLines' } as unknown as StatisticsServerRequest))
      .toThrow(/Программ.*линий/i)
  })
  it.each(['general', 'lnk', 'psto', 'welders', 'lineSummary'] as const)('keeps the active %s tab', tab => {
    expect(normalizeStatisticsServerRequest({ tab }).tab).toBe(tab)
  })
})
