import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createCurrentGeneratedDocumentBlob } from './welding-journal-document'
import type { StoredDocumentTemplate } from './document-template-storage'
import type { WeldRow } from './dispatcher-types'
import { FIELD_BY_KEY } from './weld-fields'
import { createWeldingJournalBlobFromTemplate } from './document-template-workbook'

const fields = ['pstoRequest', 'pstoRequestDate', 'pstoDate', 'heatTreatmentDiagram', 'pstoResult', 'pstoNote',
  'tvmtRequest', 'tvmtRequestDate', 'tvmtResult', 'tvmtConclusionDate', 'tvmtConclusion'] as const
const primary = { pstoRequest: 'PSTO-1', pstoRequestDate: '2026-09-01', pstoDate: '2026-09-02',
  heatTreatmentDiagram: 'DIAGRAM-1', pstoResult: 'проведено', pstoNote: 'NOTE-1',
  tvmtRequest: 'TVMT-1', tvmtRequestDate: '2026-09-03', tvmtResult: 'не годен',
  tvmtConclusionDate: '2026-09-04', tvmtConclusion: 'CONCLUSION-1' }
const repeat = { id: 11, weldJointId: 1, sequence: 2, pstoRequest: 'PSTO-2', pstoRequestDate: '2026-09-05',
  pstoDate: '2026-09-06', heatTreatmentDiagram: 'DIAGRAM-2', pstoResult: 'проведено', pstoNote: 'NOTE-2',
  tvmtRequest: 'TVMT-2', tvmtRequestDate: '2026-09-07', tvmtResult: 'годен',
  tvmtConclusionDate: '2026-09-08', tvmtConclusion: 'CONCLUSION-2' }
const expectedPrimary = ['PSTO-1', '01.09.2026', '02.09.2026', 'DIAGRAM-1', 'проведено', 'NOTE-1',
  'TVMT-1', '03.09.2026', 'не годен', '04.09.2026', 'CONCLUSION-1']
const expectedRepeat = ['PSTO-2', '05.09.2026', '06.09.2026', 'DIAGRAM-2', 'проведено', 'NOTE-2',
  'TVMT-2', '07.09.2026', 'годен', '08.09.2026', 'CONCLUSION-2']

describe('manual document fields use the current PSTO/TVMT cycle agreed on 27 October', () => {
  for (const type of ['weldingJournal', 'checklist', 'zni'] as const) for (const mode of ['constructor', 'markers'] as const) {
    it(`${type}/${mode}: complete, partial and cancelled repeats preserve actual history and empty fields`, async () => {
      const base = { id: 1, joint: 'S1', pstoRequired: 'да', ...primary }
      const pending = { id: 12, weldJointId: 1, sequence: 3, pstoRequest: 'PSTO-3', pstoRequestDate: '2026-09-09' }
      const rows = [base, { ...base, pstoRepeatCycles: [repeat] },
        { ...base, pstoRepeatCycles: [repeat, pending] },
        { ...base, pstoRequired: 'отменен', pstoRepeatCycles: [repeat, pending] },
      ] as WeldRow[]
      const before = structuredClone(rows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        fields.map(field => mode === 'markers' ? `{{${FIELD_BY_KEY.get(field)!.label}}}` : ''),
      ]), 'Шаблон')
      const fileData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
      const template: StoredDocumentTemplate = { id: type, fileName: 'current-cycle.xlsx', fileType: 'xlsx',
        fileData, fileSize: fileData.byteLength, uploadedAt: '', fields: [], markerCount: 0, locations: [], warnings: [],
        ...(mode === 'constructor' ? { constructorConfig: { version: 1 as const, sheetName: 'Шаблон', repeatRow: 1,
          bindings: fields.map((field, column) => ({ cell: XLSX.utils.encode_cell({ r: 0, c: column }), mode: 'row' as const, field })) } } : {}) }
      const blob = await createCurrentGeneratedDocumentBlob({ type, rows, welderStamps: [], template })
      const output = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['Шаблон']
      const actual = rows.map((_, row) => fields.map((_, column) => output[XLSX.utils.encode_cell({ r: row, c: column })]?.v ?? ''))
      expect(actual).toEqual([expectedPrimary, expectedRepeat,
        ['PSTO-3', '09.09.2026', '', '', '', '', '', '', '', '', ''], expectedRepeat])
      expect(rows).toEqual(before)
    })
  }

  it('leaves a system conclusion on the historical cycle selected for that document', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['{{Диаграмма ТО}}', '{{Результат ТВМТ}}']]), 'История')
    const fileData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const template: StoredDocumentTemplate = { id: 'pstoConclusion', fileName: 'history.xlsx', fileType: 'xlsx',
      fileData, fileSize: fileData.byteLength, uploadedAt: '', fields: [], markerCount: 0, locations: [], warnings: [],
      constructorConfig: { version: 1, sheetName: 'История', repeatRow: 1, bindings: [
        { cell: 'A1', mode: 'row', field: 'heatTreatmentDiagram' }, { cell: 'B1', mode: 'row', field: 'tvmtResult' },
      ] } }
    const blob = await createWeldingJournalBlobFromTemplate(template,
      [{ id: 1, pstoRequired: 'да', ...primary, pstoRepeatCycles: [repeat] } as WeldRow])
    const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['История']
    expect([sheet.A1.v, sheet.B1.v]).toEqual(['DIAGRAM-1', 'не годен'])
  })
})
