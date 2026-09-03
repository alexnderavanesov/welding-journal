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

  it('omits disabled process sections from the current LNK export', () => {
    const fieldKeys = getReportExportOptions('lnk', 'ЛНК', {
      layeredControlEnabled: false,
      preHeatTreatmentLnkEnabled: false,
    }).fields.map((field) => field.key)

    expect(fieldKeys).not.toEqual(expect.arrayContaining([
      'layeredVikDocuments',
      'layeredPvkDocuments',
      'preVikRequest',
      'preRkResult',
    ]))
    expect(fieldKeys).toContain('vikRequest')
  })

  it('exports PSTO and TVMT fields in the same operational order as the report', () => {
    const pstoFieldKeys = new Set([
      'pstoRequired',
      'pstoCycleSummary',
      'pstoRequest',
      'pstoRequestDate',
      'heatTreatmentDiagram',
      'pstoDate',
      'pstoResult',
      'tvmtRequest',
      'tvmtRequestDate',
      'tvmtConclusion',
      'tvmtConclusionDate',
      'tvmtResult',
      'pstoNote',
      'pstoCancellationDate',
      'pstoControlBasis',
    ])
    const exportedPstoFields = getReportExportOptions('heatTreatment', 'Термообработка')
      .fields
      .map((field) => field.key)
      .filter((fieldKey) => pstoFieldKeys.has(fieldKey))

    expect(exportedPstoFields).toEqual([...pstoFieldKeys])
  })
})
