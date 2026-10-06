import assert from 'node:assert/strict'
import { constants } from 'node:buffer'
import { buildExportXlsxBytes } from '../src/lib/weld-export-xlsx-xml'
import { getReportExportOptions } from '../src/lib/report-export-state'
import type { WeldInput } from '../src/lib/weld-fields'
import { buildTabularReport } from '../src/lib/tabular-report'
import { buildPrintableReportHtml } from '../src/lib/printable-report'

// Pure in-memory fixture. No database, files, browser, or remote service is used.
// Run separately from unit/build/E2E workloads, with a bounded Node heap.
const journalFields = getReportExportOptions('weldingJournal', 'Аудит').fields
const compactKeys = new Set(['joint', 'line', 'weldDate', 'stamp1K', 'hasVik', 'vikResult', 'wdi'])
const compactFields = journalFields.filter(field => compactKeys.has(field.key))
const sizes = [500, 10_000, 200_000]
const shortestEmptyTextCell = '<c r="A2" t="inlineStr" s="0"><is><t></t></is></c>'
function worksheet(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0, 'Current export uses stored ZIP entries')
    const length = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
    const start = offset + 30 + nameLength + extraLength
    if (name === 'xl/worksheets/sheet1.xml') return decoder.decode(bytes.subarray(start, start + length))
    offset = start + length
  }
  throw new Error('Worksheet not found in generated workbook')
}
function measure<T>(label: string, run: () => T) {
  const started = performance.now()
  const result = run()
  console.log(JSON.stringify({ label, milliseconds: Math.round(performance.now() - started),
    rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) }))
  return result
}
for (const count of sizes) {
  const fields = count <= 10_000 ? journalFields : compactFields
  const rows: WeldInput[] = Array.from({ length: count }, (_, index) => ({
    joint: `S${index + 1}`, line: 'Л1 <&>', weldDate: '2026-09-01',
    stamp1K: 'A001', hasVik: 'да', vikResult: 'годен', wdi: 1.25,
  }))
  const preview = measure(`${count}x${fields.length}: preview model`, () => buildTabularReport({
    rows, fields, title: 'Аудит', sheetName: 'Аудит', filename: 'audit.xlsx', emptyMessage: '',
  }).report)
  assert.equal(preview.tables?.[0].rows.length, count)
  const html = measure(`${count}x${fields.length}: preview HTML (no DOM)`, () => buildPrintableReportHtml(preview, { embedded: true }))
  assert.ok(html.includes(`S${count}`))
  assert.ok(html.includes('Л1 &lt;&amp;&gt;'))
  const bytes = measure(`${count}x${fields.length}: XLSX`, () => buildExportXlsxBytes(rows, { fields }))
  const xml = worksheet(bytes)
  let rowCount = 0
  for (const _ of xml.matchAll(/<row r="/g)) rowCount++
  assert.equal(rowCount, count + 1)
  assert.ok(xml.includes(`<row r="${count + 1}">`))
  assert.ok(xml.includes(`>S${count}</t>`))
  assert.ok(xml.includes('Л1 &lt;&amp;&gt;'))
  assert.ok(xml.includes('<v>1.25</v>'))
  if (count === 500) assert.ok(xml.includes(shortestEmptyTextCell), 'Confirm the lower-bound cell markup in the real wide export')
  console.log(JSON.stringify({ count, columns: fields.length, htmlBytes: Buffer.byteLength(html),
    xlsxBytes: bytes.byteLength, worksheetCharacters: xml.length }))
}

// Independently compute a strict LOWER bound for the default wide worksheet.
// Even empty cells emit this markup; use the shortest reference A2 for every
// cell and omit row wrappers, headers, values and the longer real references.
// WDI is numeric and can be shorter, so exclude that column entirely.
const textColumns = journalFields.filter(field => field.key !== 'wdi').length
const minimumCharacters = 200_000 * textColumns * shortestEmptyTextCell.length
assert.ok(minimumCharacters > constants.MAX_STRING_LENGTH)
console.log(JSON.stringify({ limitation: 'Direct 200k-row export cannot fit its single worksheet XML string; current UI rejects over 10000 rows first',
  columns: journalFields.length, minimumCharacters, maxStringCharacters: constants.MAX_STRING_LENGTH,
  fullWideExportExecuted: false, reason: 'Guaranteed string-limit violation; avoid multi-GB allocation on the working computer' }))
