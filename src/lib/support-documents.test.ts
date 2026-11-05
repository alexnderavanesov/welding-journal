import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createCurrentGeneratedDocumentBlob } from './welding-journal-document'
import { createWeldingJournalBlobFromTemplate } from './document-template-workbook'
import type { StoredDocumentTemplate } from './document-template-storage'
import type { WeldRow } from './dispatcher-types'
import { FIELD_BY_KEY } from './weld-fields'
import { buildPrimaryPstoSystemDocumentRow, buildPstoRepeatSystemDocumentRow } from './system-document-virtual-row'

const fields = ['joint', 'weldLength', 'pstoRequest', 'heatTreatmentDiagram', 'tvmtConclusion'] as const
function template(id: StoredDocumentTemplate['id'], markers: boolean): StoredDocumentTemplate {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([fields.map(field => markers ? `{{${FIELD_BY_KEY.get(field)!.label}}}` : '')]), 'Опоры')
  const fileData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return { id, fileName: 'supports.xlsx', fileType: 'xlsx', fileData, fileSize: fileData.byteLength, uploadedAt: '', fields: [], markerCount: 0, locations: [], warnings: [],
    ...(markers ? {} : { constructorConfig: { version: 1, sheetName: 'Опоры', repeatRow: 1,
      bindings: fields.map((field, i) => ({ cell: XLSX.utils.encode_cell({ r: 0, c: i }), mode: 'row', field })) } }) }
}
async function read(blob: Blob, rowCount: number) {
  const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets.Опоры
  return Array.from({ length: rowCount }, (_, r) => fields.map((_, c) => sheet[XLSX.utils.encode_cell({ r, c })]?.v ?? ''))
}
const repeat = { id: 21, weldJointId: 1, sequence: 2, pstoRequest: 'ПСТО-2', pstoRequestDate: '2026-09-03' }
const root: WeldRow = { id: 1, joint: 'ОП44/3', connectionType: 'Т1', weldLength: '600.123456789123456789', pstoRequired: 'да',
  pstoRequest: 'ПСТО-1', pstoDate: '2026-09-02', pstoResult: 'проведено', heatTreatmentDiagram: 'Д-1', tvmtResult: 'не годен', tvmtConclusion: 'ТВМТ-1', pstoRepeatCycles: [repeat] }

describe('support length and cycle data in actual document workbooks', () => {
  for (const type of ['weldingJournal', 'checklist', 'zni'] as const) for (const markers of [false, true]) {
    it(`${type}/${markers ? 'markers' : 'constructor'}: preserves OP names, complete L and current repeat empty values`, async () => {
      const rows = [root, { ...root, id: 2, joint: 'ОП44/3R10' }, { ...root, id: 3, joint: 'ОП-45', weldLength: null }]
      const before = structuredClone(rows)
      const actual = await read(await createCurrentGeneratedDocumentBlob({ type, rows, welderStamps: [], template: template(type, markers) }), rows.length)
      expect(actual).toEqual([['ОП44/3', '600.123456789123456789', 'ПСТО-2', '', ''], ['ОП44/3R10', '600.123456789123456789', 'ПСТО-2', '', ''], ['ОП-45', '', 'ПСТО-2', '', '']])
      expect(rows).toEqual(before)
    })
  }
  it('leaves system documents attached to their selected historical cycle', async () => {
    const rows = [buildPrimaryPstoSystemDocumentRow(root), buildPstoRepeatSystemDocumentRow(root, repeat)]
    const actual = await read(await createWeldingJournalBlobFromTemplate(template('pstoConclusion', false), rows), 2)
    expect(actual).toEqual([['ОП44/3', '600.123456789123456789', 'ПСТО-1', 'Д-1', 'ТВМТ-1'], ['ОП44/3', '600.123456789123456789', 'ПСТО-2', '', '']])
  })
})
