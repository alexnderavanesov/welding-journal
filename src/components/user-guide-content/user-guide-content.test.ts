import { describe, expect, it } from 'vitest'

import { REFERENCE_GUIDE_SECTIONS as REFERENCE_GUIDE_SECTIONS_1 } from '@/components/user-guide-content/reference-sections-1'
import { REFERENCE_GUIDE_SECTIONS as REFERENCE_GUIDE_SECTIONS_2 } from '@/components/user-guide-content/reference-sections-2'
import { REFERENCE_GUIDE_SECTIONS as REFERENCE_GUIDE_SECTIONS_3 } from '@/components/user-guide-content/reference-sections-3'
import { WORK_GUIDE_SECTIONS } from '@/components/user-guide-content/work-sections'

describe('user guide content', () => {
  it('explains the release waiting page and avoids automatic retry of a save', () => {
    const content = JSON.stringify(WORK_GUIDE_SECTIONS)
    expect(content).toContain('Идёт обновление системы')
    expect(content).toContain('Сама страница ожидания не запускает миграции и не меняет данные')
    expect(content).toContain('сначала проверьте, что уже сохранилось до начала обновления')
    const reference = JSON.stringify(REFERENCE_GUIDE_SECTIONS_1)
    expect(reference).toContain('pnpm db:remote-migration --backup-confirmed --maintenance-window-confirmed --release-deployed-confirmed')
    expect(reference).toContain('/health/live')
    expect(reference).toContain('/health/ready')
  })
  it('does not offer implicit document deletion in either line-move guide', () => {
    const content = JSON.stringify([...WORK_GUIDE_SECTIONS, ...REFERENCE_GUIDE_SECTIONS_1])
    expect(content).toContain('Удаление ошибочных документов выполняется отдельно')
    expect(content).not.toContain('перенести его в «До ТО» либо удалить')
    expect(content).not.toContain('перенести комплект в «До ТО» или удалить')
  })
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
