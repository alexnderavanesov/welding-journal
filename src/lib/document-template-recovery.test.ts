import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { validateDocumentTemplateRecovery } from './document-template-replacement'
import type { DocumentTemplateConstructorConfig } from './document-template-model'

const config: DocumentTemplateConstructorConfig = { version: 1, sheetName: 'Бланк', repeatRow: 2, repeatRowEnd: 3, bindings: [{ cell: 'A2', mode: 'row', field: 'joint' }, { cell: 'B4', mode: 'summary', field: 'line' }] }
function workbook(name = 'Бланк', rows = 4, merges: string[] = []) {
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet(Array.from({ length: rows }, () => ['A', 'B']))
  sheet['!merges'] = merges.map(merge => XLSX.utils.decode_range(merge))
  XLSX.utils.book_append_sheet(book, sheet, name)
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
describe('missing template file recovery without changing saved settings', () => {
  it('accepts the saved addresses and never modifies the constructor', async () => {
    const before = structuredClone(config)
    expect(await validateDocumentTemplateRecovery(config, workbook())).toEqual([])
    expect(config).toEqual(before)
    expect(await validateDocumentTemplateRecovery(undefined, workbook())).toEqual([])
  })
  it('rejects missing sheets and reports all detectable address/block errors together', async () => {
    expect((await validateDocumentTemplateRecovery(config, workbook('Другой'))).join(' ')).toContain('нет листа')
    const errors = await validateDocumentTemplateRecovery(config, workbook('Бланк', 2))
    expect(errors.join(' ')).toContain('B4')
    expect(errors.join(' ')).toContain('Повторяемый блок')
  })
  it('rejects bindings hidden inside merges and merges across the repeat boundary', async () => {
    expect((await validateDocumentTemplateRecovery(config, workbook('Бланк', 4, ['A4:B4']))).join(' ')).toContain('не является его началом')
    expect((await validateDocumentTemplateRecovery(config, workbook('Бланк', 4, ['A1:A2']))).join(' ')).toContain('границу повторяемого блока')
  })
})
