import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { normalizeDocumentTemplateConstructorConfig, type DocumentTemplateConstructorConfig, type DocumentTemplateId, type StoredDocumentTemplate } from './document-template-model'
import { createWeldingJournalBlobFromTemplate } from './document-template-workbook'
import { createWeldingJournalDocumentPreview } from './document-template-preview'
import { buildPreHeatTreatmentSystemDocumentRow } from './system-document-virtual-row'
import { analyzeDocumentTemplateReplacement } from './document-template-replacement'
import type { WeldRow } from './dispatcher-types'

const pairs = [
  ['preVikDefectDescription', 'vikDefectDescription', 'Дефекты ВИК до ТО', 'ВИК'],
  ['preRkDefectDescription', 'lnkDefectDescription', 'Описание дефектов РК до ТО', 'РК'],
  ['preUzkDefectDescription', 'uzkDefectDescription', 'Дефекты УЗК до ТО', 'УЗК'],
  ['prePvkDefectDescription', 'pvkDefectDescription', 'Дефекты ПВК до ТО', 'ПВК'],
] as const
const staged = ['lnkRequest', 'lnkConclusionVik', 'lnkConclusionRk', 'lnkConclusionUzk', 'lnkConclusionPvk'] as const
const separate = ['weldingJournal', 'checklist', 'zni', 'pstoConclusion', 'tvmtConclusion', 'layeredVikEdges'] as const
const config: DocumentTemplateConstructorConfig = { version: 1, sheetName: 'Бланк', repeatRow: 2, bindings: pairs.map(([field], i) => ({
  cell: `${String.fromCharCode(65 + i)}2`, mode: 'row', parts: [{ field, prefix: 'Дефекты: ', suffix: '.', lineBreakAfter: true }], emptyMode: 'custom', emptyText: 'нет', uniqueParts: false,
})) }
const source: WeldRow = {
  id: 1, joint: 'F1', hasVik: 'да', hasRk: 'да', hasUzk: 'да', hasPvk: 'да',
  vikResult: 'ремонт', rkResult: 'ремонт', uzkResult: 'ремонт', pvkResult: 'ремонт',
  vikDefectDescription: 'основной ВИК', lnkDefectDescription: '0-100: основной РК', uzkDefectDescription: 'основной УЗК', pvkDefectDescription: 'основной ПВК',
  preVikDefectDescription: 'до ТО ВИК', preRkDefectDescription: 'до ТО РК', preUzkDefectDescription: 'до ТО УЗК', prePvkDefectDescription: 'до ТО ПВК',
  preHeatTreatmentControls: pairs.map(([, , , method], i) => ({ id: i + 1, weldJointId: 1, method, result: 'ремонт', defectDescription: `${method === 'РК' ? '0-100: ' : ''}до ТО ${method}` })),
}
function template(id: DocumentTemplateId, markers = false): StoredDocumentTemplate {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['ВИК', 'РК', 'УЗК', 'ПВК'], markers ? pairs.map(([, , label]) => `{{${label}}}`) : ['', '', '', ''],
  ]), 'Бланк')
  const fileData = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return { id, fileName: 'stage.xlsx', fileType: 'xlsx', fileSize: fileData.byteLength, uploadedAt: '', sheetNames: ['Бланк'], fields: [], locations: [], warnings: [], markerCount: markers ? 4 : 0, fileData, ...(markers ? {} : { constructorConfig: config }) }
}
async function values(blob: Blob) {
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
  const sheet = XLSX.read(bytes, { type: 'array' }).Sheets.Бланк
  return ['A2', 'B2', 'C2', 'D2'].map(cell => sheet[cell]?.v ?? '')
}

describe('shared LNK template fields follow the document stage', () => {
  it.each(staged)('normalizes saved bindings in %s without changing cells or formatting', id => {
    const original = structuredClone(config)
    const normalized = normalizeDocumentTemplateConstructorConfig(config, id)
    normalized.bindings.forEach((binding, i) => expect(binding).toEqual({ ...config.bindings[i], scope: undefined,
      parts: [{ ...config.bindings[i].parts![0], field: pairs[i][1] }] }))
    expect(config).toEqual(original)
    expect(normalizeDocumentTemplateConstructorConfig(normalized, id)).toEqual(normalized)
    const direct = { ...config, repeatMode: 'groups' as const, repeatGroupBy: 'preVikDefectDescription' as const, bindings: [{ cell: 'A1', mode: 'summary' as const, field: 'preVikDefectDescription' as const }, { cell: 'B1', mode: 'summary' as const, parts: [{ field: 'preUzkDefectDescription' as const, compareField: 'prePvkDefectDescription' as const }] }] }
    expect(normalizeDocumentTemplateConstructorConfig(direct, id)).toMatchObject({ repeatGroupBy: 'vikDefectDescription', bindings: [{ field: 'vikDefectDescription' }, { parts: [{ field: 'uzkDefectDescription', compareField: 'pvkDefectDescription' }] }] })
  })
  it.each(separate)('keeps explicit stage bindings in %s', id => {
    expect(normalizeDocumentTemplateConstructorConfig(config, id)).toEqual(normalizeDocumentTemplateConstructorConfig(config))
  })
  for (const markers of [false, true]) it.each(staged)(`fills old ${markers ? 'Excel markers' : 'constructor bindings'} in %s from the selected stage`, async id => {
    const original = structuredClone(source)
    const book = template(id, markers)
    for (const before of [false, true]) {
      const row = before ? buildPreHeatTreatmentSystemDocumentRow(source, source.preHeatTreatmentControls!) : source
      const expected = pairs.map(([, , , method]) => `${method === 'РК' ? '0-100: ' : ''}${before ? 'до ТО' : 'основной'} ${method}`)
      expect(await values(await createWeldingJournalBlobFromTemplate(book, [row]))).toEqual(expected.map(value => markers ? value : `Дефекты: ${value}.`))
      const preview = await createWeldingJournalDocumentPreview(book, [row])
      for (const value of expected) expect(JSON.stringify(preview)).toContain(value)
    }
    expect(source).toEqual(original)
  })
  it('does not use the other stage when the current result is missing', async () => {
    const noMain: WeldRow = { ...source, vikResult: undefined, rkResult: undefined, uzkResult: undefined, pvkResult: undefined, vikDefectDescription: undefined, lnkDefectDescription: undefined, uzkDefectDescription: undefined, pvkDefectDescription: undefined }
    const noPre = buildPreHeatTreatmentSystemDocumentRow(source, [])
    for (const row of [noMain, noPre]) expect(await values(await createWeldingJournalBlobFromTemplate(template('lnkConclusionVik'), [row]))).toEqual(['нет', 'нет', 'нет', 'нет'])
  })
  it.each(['weldingJournal', 'checklist', 'zni'] as const)('keeps both stages independent in the general document %s', async id => {
    const book = template(id)
    expect(await values(await createWeldingJournalBlobFromTemplate(book, [source]))).toEqual(['Дефекты: до ТО ВИК.', 'Дефекты: до ТО РК.', 'Дефекты: до ТО УЗК.', 'Дефекты: до ТО ПВК.'])
    book.constructorConfig = { ...config, bindings: config.bindings.map((binding, i) => ({ ...binding, parts: [{ field: pairs[i][1] }] })) }
    expect(await values(await createWeldingJournalBlobFromTemplate(book, [source]))).toEqual(['основной ВИК', '0-100: основной РК', 'основной УЗК', 'основной ПВК'])
  })
  it('retains normalized bindings when replacing the workbook', async () => {
    const old = template('lnkConclusionVik'), replacement = template('lnkConclusionVik')
    const result = await analyzeDocumentTemplateReplacement(old, replacement)
    expect(result.status).toBe('compatible')
    expect(result.constructorConfig).toEqual(normalizeDocumentTemplateConstructorConfig(config, old.id))
    expect(old.constructorConfig).toEqual(config)
  })
})
