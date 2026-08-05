import { describe, expect, it } from 'vitest'

import {
  buildWeldingJournalGenerationPlan,
  ensureWeldingJournalXlsxFileName,
  getWeldingJournalRowsDateRange,
  prepareWeldingJournalDocumentRows,
} from '@/lib/welding-journal-generation'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS } from '@/lib/document-template-storage'

const rows = [
  { id: 1, projectTitle: 'Проект', subtitleCode: '400', line: 'A', joint: 'S2', weldDate: '2026-07-02' },
  { id: 2, projectTitle: 'Проект', subtitleCode: '400', line: 'A', joint: 'S1', weldDate: '2026-07-01' },
  { id: 3, projectTitle: 'Проект', subtitleCode: '500', line: 'B', joint: 'S3', weldDate: null },
] as WeldRow[]

describe('welding journal generation', () => {
  it('prepares the same filtered and sorted rows for page and compact dialog', () => {
    const prepared = prepareWeldingJournalDocumentRows({
      sourceRows: rows,
      contextRows: rows,
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
      options: { ...DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS, officialOnly: false, goodOnly: false },
      filters: { subtitles: ['400'] },
    })

    expect(prepared.map((row) => row.id)).toEqual([2, 1])
  })

  it('splits documents and makes repeated manual names unique', () => {
    const plan = buildWeldingJournalGenerationPlan({
      rows: rows.slice(0, 2),
      template: null,
      options: { ...DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS, splitMode: 'joint' },
      periodFrom: '2026-07-01',
      periodTo: '2026-07-02',
      manualTitle: 'ЖСР линии',
    })

    expect(plan.groups).toHaveLength(2)
    expect(plan.titles).toEqual(['ЖСР линии (1)', 'ЖСР линии (2)'])
  })

  it('derives period and safe xlsx file name', () => {
    expect(getWeldingJournalRowsDateRange(rows)).toEqual({ from: '2026-07-01', to: '2026-07-02' })
    expect(ensureWeldingJournalXlsxFileName('ЖСР: 400.xlsx')).toBe('ЖСР 400.xlsx')
  })
})
