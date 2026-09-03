import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import type { StoredDocumentTemplate } from '@/lib/document-template-storage'
import { createCurrentGeneratedDocumentBlob } from '@/lib/welding-journal-document'

describe('layered control document preview', () => {
  it('uses the existing missing-template error instead of generating a fallback workbook', async () => {
    await expect(createCurrentGeneratedDocumentBlob({
      type: 'layeredVikEdges',
      rows: [],
      welderStamps: [],
      template: null,
    })).rejects.toThrow('Файл шаблона не найден в общем хранилище.')
  })

  it.each([
    {
      type: 'layeredVikEdges' as const,
      resultField: 'vikResult' as const,
      conclusionDateField: 'vikConclusionDate' as const,
      conclusionField: 'vikConclusion' as const,
      requestField: 'vikRequest' as const,
    },
    {
      type: 'layeredPvkLayers' as const,
      resultField: 'pvkResult' as const,
      conclusionDateField: 'pvkConclusionDate' as const,
      conclusionField: 'pvkConclusion' as const,
      requestField: 'pvkRequest' as const,
    },
  ])('fills $type with its own automatic conclusion values', async ({
    type,
    resultField,
    conclusionDateField,
    conclusionField,
    requestField,
  }) => {
    const template = createLayeredTemplate(type, {
      resultField,
      conclusionDateField,
      conclusionField,
      requestField,
    })
    const title = type === 'layeredVikEdges' ? 'ВИК-К-17' : 'ПВК-С-17'
    const blob = await createCurrentGeneratedDocumentBlob({
      type,
      rows: [{
        id: 10,
        joint: 'F2',
        weldDate: '2026-09-02',
        [resultField]: 'ремонт',
        [conclusionDateField]: '2026-09-01',
        [conclusionField]: 'Основное заключение',
        [requestField]: 'Основная заявка',
      }],
      welderStamps: [],
      template,
      documentRecord: {
        title,
        documentNumber: 17,
        periodFrom: '2026-09-02',
      },
    })

    const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]
    const [values] = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1 })

    expect(values).toEqual([
      title,
      '02.09.2026',
      '17',
      'годен',
      'годен',
      '02.09.2026',
      title,
      '',
    ])
  })
})

function createLayeredTemplate(
  id: 'layeredVikEdges' | 'layeredPvkLayers',
  fields: {
    resultField: 'vikResult' | 'pvkResult'
    conclusionDateField: 'vikConclusionDate' | 'pvkConclusionDate'
    conclusionField: 'vikConclusion' | 'pvkConclusion'
    requestField: 'vikRequest' | 'pvkRequest'
  },
): StoredDocumentTemplate {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([new Array(8).fill('')]), 'Шаблон')
  const fileData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return {
    id,
    fileName: 'template.xlsx',
    fileType: 'xlsx',
    fileSize: fileData.byteLength,
    uploadedAt: '02.09.2026',
    fields: [],
    markerCount: 0,
    locations: [],
    warnings: [],
    fileData,
    constructorConfig: {
      version: 1,
      sheetName: 'Шаблон',
      repeatRow: 1,
      bindings: [
        { cell: 'A1', mode: 'row', field: '__systemDocumentTitle' },
        { cell: 'B1', mode: 'row', field: '__systemDocumentDate' },
        { cell: 'C1', mode: 'row', field: '__systemDocumentNumber' },
        { cell: 'D1', mode: 'row', field: '__systemDocumentResult' },
        { cell: 'E1', mode: 'row', field: fields.resultField },
        { cell: 'F1', mode: 'row', field: fields.conclusionDateField },
        { cell: 'G1', mode: 'row', field: fields.conclusionField },
        { cell: 'H1', mode: 'row', field: fields.requestField },
      ],
    },
  }
}
