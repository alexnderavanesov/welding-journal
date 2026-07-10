import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx-js-style'

import { createWeldingJournalBlobFromTemplate, type StoredDocumentTemplate } from '@/lib/document-template-storage'
import type { WeldInput } from '@/lib/weld-fields'

describe('document template storage', () => {
  it('uses н/п for existing template fields that are empty in the weld row', async () => {
    const template = createXlsxTemplate([['{{ID материала 1}}']])
    const blob = createWeldingJournalBlobFromTemplate(template, [
      { joint: 'S1', materialId1: '' },
      { joint: 'S2', materialId1: 'MAT-2' },
    ] as WeldInput[])

    const workbook = XLSX.read(await readBlobAsArrayBuffer(blob), { type: 'array' })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]

    expect(worksheet.A1?.v).toBe('н/п')
    expect(worksheet.A2?.v).toBe('MAT-2')
  })

  it('keeps template sheet name, borders, wrap text and generated rows on automatic height', async () => {
    const template = createXlsxTemplate([['{{Линия}}']], {
      sheetName: 'Журнал шаблон',
      style: {
        border: {
          top: { style: 'thin', color: { rgb: 'FF000000' } },
          bottom: { style: 'thin', color: { rgb: 'FF000000' } },
        },
        alignment: {
          horizontal: 'center',
          vertical: 'top',
          wrapText: true,
        },
      },
      rowInfo: { hpt: 42 },
    })
    const blob = createWeldingJournalBlobFromTemplate(template, [{ line: 'LIN-1\nLIN-2' }] as WeldInput[])

    const generatedData = await readBlobAsArrayBuffer(blob)
    const workbook = XLSX.read(generatedData, { type: 'array', cellStyles: true })
    const sheetXml = readXlsxFileText(generatedData, 'xl/worksheets/sheet1.xml')
    const stylesXml = readXlsxFileText(generatedData, 'xl/styles.xml')

    expect(workbook.SheetNames[0]).toBe('Журнал шаблон')
    expect(sheetXml).toContain('<c r="A1" s="3"')
    expect(sheetXml).not.toMatch(/<row\b[^>]*\bht=/)
    expect(sheetXml).not.toMatch(/<row\b[^>]*\bcustomHeight=/)
    expect(stylesXml).toContain('<top style="thin">')
    expect(stylesXml).toMatch(/wrapText="(?:1|true)"/)
  })
})

function readBlobAsArrayBuffer(blob: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(blob)
  })
}

function readXlsxFileText(fileData: ArrayBuffer, path: string) {
  const cfb = XLSX.CFB.read(new Uint8Array(fileData), { type: 'array' })
  const index = cfb.FullPaths.findIndex((fullPath) => fullPath.replace(/^Root Entry\//, '') === path)
  if (index < 0) return ''
  return new TextDecoder().decode(cfb.FileIndex[index].content)
}

function createXlsxTemplate(
  rows: unknown[][],
  options: {
    sheetName?: string
    style?: Record<string, unknown>
    rowInfo?: Record<string, unknown>
  } = {},
): StoredDocumentTemplate {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  if (options.style && worksheet.A1) worksheet.A1.s = options.style
  if (options.rowInfo) worksheet['!rows'] = [options.rowInfo]
  XLSX.utils.book_append_sheet(workbook, worksheet, options.sheetName ?? 'Шаблон')
  const fileData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer
  return {
    id: 'weldingJournal',
    fileName: 'template.xlsx',
    fileType: 'xlsx',
    fileSize: fileData.byteLength,
    uploadedAt: '10.07.2026',
    fields: ['ID материала 1'],
    markerCount: 1,
    locations: [],
    warnings: [],
    fileData,
  }
}
