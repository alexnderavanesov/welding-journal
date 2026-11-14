import { describe, expect, it } from 'vitest'
import { buildStatisticsCalculationCacheKey, normalizeStatisticsRpcRequest, normalizeStatisticsServerRequest } from './statistics'
import type { StatisticsServerRequest } from '@/lib/statistics-server-summary'
import { STATISTICS_TRANSPORT, type StatisticsRpcRequest } from '@/lib/statistics-result-payload'

describe('statistics no longer publishes the replaced percentage-line calculator', () => {
  it('directs stale clients to the line program before any data load', () => {
    expect(() => normalizeStatisticsServerRequest({ tab: 'percentageLines' } as unknown as StatisticsServerRequest))
      .toThrow(/Программ.*линий/i)
  })
  it.each(['general', 'lnk', 'psto', 'welders', 'lineSummary'] as const)('keeps the active %s tab', tab => {
    expect(normalizeStatisticsServerRequest({ tab }).tab).toBe(tab)
  })
})
it('normalizes the support tab to count/length semantics without F/S or WDI switches', () => {
  expect(normalizeStatisticsServerRequest({ tab: 'supports', unit: 'wdi', jointFilter: 'f' })).toMatchObject({ tab: 'supports', unit: 'joints', jointFilter: 'all' })
})

it('negotiates transport without changing the calculation/cache identity for old clients', () => {
  const request: StatisticsServerRequest = { tab: 'lnk', projectFilter: ' Project ', selectedSubtitles: ['B', 'a'] }
  const legacy = normalizeStatisticsRpcRequest(request)
  const current = normalizeStatisticsRpcRequest({ ...request, transport: STATISTICS_TRANSPORT })
  expect(legacy.transport).toBeUndefined()
  expect(current.transport).toBe(STATISTICS_TRANSPORT)
  expect(current.request).toEqual(legacy.request)
  expect(current.request).not.toHaveProperty('transport')
})

it.each([null, '', 'json', 'statistics-ids-v2', false, {}])('rejects unsupported transport capability %j', transport => {
  expect(() => normalizeStatisticsRpcRequest({ tab: 'lnk', transport } as unknown as StatisticsRpcRequest)).toThrow(/формат статистики/)
})

it('shares only identical LNK/PSTO calculations and retains every selection parameter', () => {
  const request = normalizeStatisticsServerRequest({ tab: 'lnk', projectFilter: 'P', selectedSubtitles: ['S'], from: '2026-10-01', to: '2026-10-31' })
  const key = buildStatisticsCalculationCacheKey(request)
  expect(buildStatisticsCalculationCacheKey({ ...request, tab: 'psto' })).toBe(key)
  for (const change of [
    { tab: 'general' }, { tab: 'supports' }, { tab: 'welders' }, { tab: 'lineSummary' },
    { projectFilter: 'Q' }, { selectedSubtitles: ['T'] }, { from: '2026-09-01' }, { to: '2026-11-01' },
    { unit: 'wdi' }, { jointFilter: 's' }, { controlDynamicsScale: 'month' }, { weldingDynamicsScale: 'week' },
  ] as Partial<StatisticsServerRequest>[]) expect(buildStatisticsCalculationCacheKey({ ...request, ...change })).not.toBe(key)
  expect(buildStatisticsCalculationCacheKey({ ...request, tab: 'lineSummary' }, 'new-schemes'))
    .not.toBe(buildStatisticsCalculationCacheKey({ ...request, tab: 'lineSummary' }, 'old-schemes'))
})
