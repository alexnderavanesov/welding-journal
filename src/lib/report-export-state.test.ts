import { beforeEach, describe, expect, it } from 'vitest'

import { getReportExportOptions } from '@/lib/report-export-state'

describe('getReportExportOptions', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('exports every pre-heat-treatment RK detail and keeps TVMT outside LNK', () => {
    const fieldKeys = getReportExportOptions('lnk', 'ЛНК').fields.map((field) => field.key)

    expect(fieldKeys).toEqual(expect.arrayContaining([
      'preRkRequest',
      'preRkRequestDate',
      'preRkResult',
      'preRkExposureScheme',
      'preRkDefectDescription',
      'preRkConclusionDate',
      'preRkConclusion',
    ]))
    expect(fieldKeys).not.toEqual(expect.arrayContaining([
      'tvmtRequest',
      'tvmtRequestDate',
      'tvmtResult',
      'tvmtConclusionDate',
      'tvmtConclusion',
    ]))
  })
})
