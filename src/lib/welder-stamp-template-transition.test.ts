import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { simplifyStampTemplateConfig, simplifyStampTemplateFile, simplifyStampTemplateText } from './welder-stamp-template-transition'
import { createWeldingJournalBlobFromTemplate, parseDocumentTemplateFile, type DocumentTemplateConstructorConfig, type StoredDocumentTemplate } from './document-template-storage'

const legacy = {
  version: 1, sheetName: 'Шаблон', repeatRow: 2, repeatMode: 'groups', repeatGroupBy: 'stamp2K',
  bindings: [
    { cell: 'A2', mode: 'row', field: 'stamp1K' },
    { cell: 'B2', mode: 'row', parts: [{ field: 'stamp1ZFact' }, { field: '__welderName:stamp2K', prefix: 'OLD' }] },
    { cell: 'C2', mode: 'row', field: 'stamp1O', emptyMode: 'custom', emptyText: 'OLD' },
    { cell: 'D2', mode: 'row', parts: [{ field: 'd1', compareField: 'stamp2K' }], emptyMode: 'np' },
  ], nameConfig: { version: 1, parts: [{ type: 'field', field: 'stamp1K' }, { type: 'field', field: 'stamp2K' }] },
} as unknown as DocumentTemplateConstructorConfig

const buffer = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob)
})

describe('explicit one-time stamp template conversion', () => {
  it('keeps retained bindings and clears removed fields, names, comparisons and grouping idempotently', () => {
    const next = simplifyStampTemplateConfig(legacy)
    expect(next.repeatMode).toBe('rows')
    expect(next.repeatGroupBy).toBeUndefined()
    expect(next.bindings[0].field).toBe('stamp1K')
    expect(next.bindings[1].parts).toEqual([{ field: 'stamp1ZFact' }])
    for (const binding of next.bindings.slice(2)) {
      expect(binding.field).toBeUndefined(); expect(binding.parts ?? []).toEqual([]); expect(binding.emptyMode).toBe('blank')
    }
    expect(next.nameConfig?.parts).toEqual([{ type: 'field', field: 'stamp1K' }])
    expect(simplifyStampTemplateConfig(next)).toEqual(next)
    expect(legacy.bindings[2].field).toBe('stamp1O')
  })
  it('renames retained marker labels and clears retired markers without accepting old imports', () => {
    expect(simplifyStampTemplateText('A: {{Корень_1}} / {{Заполнение_1 - факт}} {{Корень_2 ФИО сварщика}}')).toBe('A: {{Клеймо_1}} / {{Клеймо_2 - факт}} ')
    expect(simplifyStampTemplateText('{{Корень_1ФИО сварщика}}')).toBe('{{Клеймо_1ФИО сварщика}}')
    expect(simplifyStampTemplateText('Облицовка_1 - факт')).toBe('')
    expect(simplifyStampTemplateText('Послойный ВИК')).toBe('Послойный ВИК')
  })
  it.each(['Корень_2', 'Заполнение_2', 'Облицовка_1', 'Облицовка_2'])('clears %s markers with a compact fallback', label => {
    for (const suffix of ['', ' - факт', ' ФИО сварщика', 'ФИО сварщика']) {
      for (const fallback of ['"н/п"', "'нет'", '«нет»', '“нет”']) {
        expect(simplifyStampTemplateText(`До {{${label}${suffix}/${fallback}}} после`)).toBe('До  после')
      }
    }
  })
  it.each([['Корень_1', 'Клеймо_1'], ['Заполнение_1', 'Клеймо_2']])('renames only the field name of %s and preserves fallback text', (previous, current) => {
    for (const suffix of ['', ' - факт', ' ФИО сварщика', 'ФИО сварщика']) {
      for (const fallback of ['"Корень_1"', "'Заполнение_1'", '«Корень_1»', '“Заполнение_1”']) {
        const next = `{{ ${current}${suffix}/${fallback} }}`
        expect(simplifyStampTemplateText(`{{ ${previous}${suffix}/${fallback} }}`)).toBe(next)
        expect(simplifyStampTemplateText(next)).toBe(next)
      }
    }
    expect(simplifyStampTemplateText('{{Линия/"Корень_1"}}')).toBe('{{Линия/"Корень_1"}}')
  })
  it('clears compact fallback markers in the generated document and keeps retained fallback literals', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[
      '{{Корень_1/"н/п"}}', '{{Корень_2/"н/п"}}', '{{Клеймо_2/"Корень_1"}}',
    ]]), 'Шаблон')
    const original = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const converted = (await simplifyStampTemplateFile(original))!
    const info = await parseDocumentTemplateFile(new File([converted], 'fallback.xlsx'))
    expect(info.fields).toEqual(['Клеймо_1', 'Клеймо_2'])
    const output = await createWeldingJournalBlobFromTemplate({ ...info, id: 'weldingJournal' }, [{ stamp1K: 'A' }])
    const generated = XLSX.read(await buffer(output), { type: 'array' }).Sheets['Шаблон']
    expect(generated.A1.v).toBe('A')
    expect(generated.B1?.v ?? '').toBe('')
    expect(generated.C1.v).toBe('Корень_1')
  })
  it('clears removed constructor cells on download, preserves other sheets and formulas', async () => {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([['Корень_1', 'Заполнение_1 - факт', 'Облицовка_1', 'Прочее'], ['OLD', 'OLD', 'OLD', 'OLD']])
    sheet.E2 = { t: 'n', f: '1+2', v: 3 }; sheet['!ref'] = 'A1:E2'
    sheet['!merges'] = [XLSX.utils.decode_range('A1:B1')]
    XLSX.utils.book_append_sheet(workbook, sheet, 'Шаблон')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['{{Заполнение_1}}', '{{Корень_2}}', 'Сохранить']]), 'Второй')
    const original = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const converted = (await simplifyStampTemplateFile(original))!
    expect(converted).toBeTruthy()
    expect(await simplifyStampTemplateFile(converted)).toBeNull()
    const changed = XLSX.read(converted, { type: 'array' })
    expect(changed.Sheets['Второй'].A1.v).toBe('{{Клеймо_2}}')
    expect(changed.Sheets['Второй'].B1?.v ?? '').toBe('')
    expect(changed.Sheets['Второй'].C1.v).toBe('Сохранить')
    expect(changed.Sheets['Шаблон'].E2.f).toBe('1+2')
    expect(changed.Sheets['Шаблон']['!merges']).toEqual(sheet['!merges'])
    const info = await parseDocumentTemplateFile(new File([converted], 'pairs.xlsx'))
    const template = { ...info, id: 'weldingJournal', constructorConfig: simplifyStampTemplateConfig(legacy) } as StoredDocumentTemplate
    const output = await createWeldingJournalBlobFromTemplate(template, [{ joint: 'F1', stamp1K: 'A', stamp1ZFact: 'B' }])
    const generated = XLSX.read(await buffer(output), { type: 'array' }).Sheets['Шаблон']
    expect(generated.A2.v).toBe('A'); expect(generated.B2.v).toBe('B')
    expect(generated.C2?.v ?? '').toBe(''); expect(generated.D2?.v ?? '').toBe('')
    expect(generated.E2.f).toBe('1+2')
  })
})
