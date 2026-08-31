import { describe, expect, it } from 'vitest'

import { REFERENCE_GUIDE_SECTIONS as REFERENCE_GUIDE_SECTIONS_1 } from '@/components/user-guide-content/reference-sections-1'
import { REFERENCE_GUIDE_SECTIONS as REFERENCE_GUIDE_SECTIONS_2 } from '@/components/user-guide-content/reference-sections-2'
import { REFERENCE_GUIDE_SECTIONS as REFERENCE_GUIDE_SECTIONS_3 } from '@/components/user-guide-content/reference-sections-3'
import { WORK_GUIDE_SECTIONS } from '@/components/user-guide-content/work-sections'

describe('user guide content', () => {
  it('keeps every concise workflow in its expected order', () => {
    expect(WORK_GUIDE_SECTIONS.map((section) => section.id)).toEqual([
      'work-start',
      'work-journal',
      'work-assignments',
      'work-lnk',
      'work-psto',
      'work-stamps',
      'work-dispatcher',
      'work-percentage',
      'work-statistics',
      'work-documents',
      'work-import',
      'work-settings',
    ])
  })

  it('keeps every full-reference section exactly once across the lazy chunks', () => {
    const sectionIds = [
      ...REFERENCE_GUIDE_SECTIONS_1,
      ...REFERENCE_GUIDE_SECTIONS_2,
      ...REFERENCE_GUIDE_SECTIONS_3,
    ].map((section) => section.id)

    expect(sectionIds).toEqual([
      'start',
      'sidebar',
      'technical-map',
      'journal',
      'control-states',
      'joint-modal',
      'lnk-psto',
      'daily-workflows',
      'import',
      'chains',
      'dispatcher',
      'stamps',
      'percentage-lines',
      'duplicate-control',
      'statistics',
      'documents',
      'settings',
      'rule-matrices',
    ])
    expect(new Set(sectionIds).size).toBe(sectionIds.length)
  })
})
