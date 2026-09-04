import { describe, expect, it } from 'vitest'

import {
  findPercentageLineNavigationTarget,
  isPercentageLineNavigationViewReady,
} from '@/lib/percentage-line-navigation'
import type { PercentageLineSummary } from '@/lib/percentage-line-summary'

describe('percentage line navigation', () => {
  it('finds the current line and stamp without case sensitivity', () => {
    const summary = [{
      projectTitle: 'Project',
      subtitleCode: 'S1',
      line: 'Lin123',
      stamps: [{ stamp: 'K-77' }],
    }] as PercentageLineSummary[]

    const target = findPercentageLineNavigationTarget(summary, {
      id: 1,
      action: 'assign-missing-controls',
      projectTitle: ' project ',
      subtitleCode: 's1',
      line: 'LIN123',
      stamp: 'k-77',
    })

    expect(target?.line).toBe(summary[0])
    expect(target?.stamp).toBe(summary[0]?.stamps[0])
  })

  it('waits for the target project, subtitle and stamp filters before opening an action', () => {
    const request = {
      id: 1,
      action: 'assign-missing-controls' as const,
      projectTitle: 'Project',
      subtitleCode: 'S1',
      line: 'Lin123',
      stamp: 'K-77',
    }

    expect(isPercentageLineNavigationViewReady(request, {
      allPeriod: false,
      projectFilter: 'Project',
      selectedSubtitles: ['S1'],
      search: 'K-77',
    })).toBe(false)
    expect(isPercentageLineNavigationViewReady(request, {
      allPeriod: true,
      projectFilter: 'Другой проект',
      selectedSubtitles: ['S2'],
      search: '',
    })).toBe(false)
    expect(isPercentageLineNavigationViewReady(request, {
      allPeriod: true,
      projectFilter: ' project ',
      selectedSubtitles: ['s1'],
      search: 'k-77',
    })).toBe(true)
  })
})
