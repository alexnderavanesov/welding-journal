import { beforeEach, expect, it, vi } from 'vitest'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { inflateRawSync } from 'node:zlib'
import * as XLSX from 'xlsx'
import { getReportOutputBuilder } from '@/lib/report-output-definition'
const mocks = vi.hoisted(() => ({ visit: vi.fn(), sheetRows: 1_048_575 }))
vi.mock('./weld-read', () => ({ visitReportOutput: mocks.visit }))
vi.mock('@/lib/weld-export-xlsx-xml', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/weld-export-xlsx-xml')>(),
  get EXCEL_SHEET_DATA_ROWS() { return mocks.sheetRows },
}))
import { createReportExcelResponse, ReportZipWriter } from './report-excel-file'

const input = { report: 'weldingJournal', fieldKeys: ['joint', 'wdi', 'weldDate'] } as const
const request = () => ({ ...input, fieldKeys: [...input.fieldKeys] })
const files = async () => (await readdir(tmpdir())).filter(name => name.startsWith('welding-report-')).sort()
beforeEach(() => { vi.resetAllMocks(); mocks.sheetRows = 1_048_575 })

it('writes every batch, preserves numbers/text/formatting and deletes the completed temporary file', async () => {
  const before = await files()
  mocks.visit.mockImplementation(async (req, consume) => {
    const build = getReportOutputBuilder(req)
    for (let start = 0; start < 3000; start += 1000) {
      const content = build(Array.from({ length: 1000 }, (_, i) => ({ joint: `00-${start + i}`, wdi: 1.25, weldDate: '2026-10-26' })))
      Object.defineProperty(content, 'report', { get: () => { throw new Error('Excel must not format a discarded preview') } })
      await consume(content)
    }
    return { sourceRows: 3000, generatedAt: '2026-10-26T12:00:00.000Z' }
  })
  const response = await createReportExcelResponse(request(), new AbortController().signal)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-report-generated-at')).toBe('2026-10-26T12:00:00.000Z')
  const bytes = Buffer.from(await response.arrayBuffer())
  expect(bytes.length).toBe(Number(response.headers.get('content-length')))
  const sheet = XLSX.read(bytes).Sheets['Текущая версия']
  expect(sheet['!ref']).toBe('A1:C3001')
  expect(sheet.A2.v).toBe('00-0'); expect(sheet.A3001.v).toBe('00-2999')
  expect(sheet.B2).toMatchObject({ t: 'n', v: 1.25 }); expect(sheet.C2.v).toBe('26.10.2026')
  await expect.poll(files).toEqual(before)
})

it.each(['failure', 'abort'] as const)('does not publish a partial workbook on %s and removes its file', async mode => {
  const before = await files(), controller = new AbortController()
  mocks.visit.mockImplementation(async (req, consume, signal: AbortSignal) => {
    await consume(getReportOutputBuilder(req)([{ joint: 'partial' }]))
    if (mode === 'abort') { controller.abort(); signal.throwIfAborted() }
    throw new Error('database failed')
  })
  await expect(createReportExcelResponse(request(), controller.signal)).rejects.toThrow()
  expect(await files()).toEqual(before)
})

it('continues on another sheet without losing boundary rows or their numeric types', async () => {
  const before = await files()
  // Exercise the actual rollover with a small sheet; production uses Excel's
  // 1,048,576 rows including the header, not an application export limit.
  mocks.sheetRows = 2
  mocks.visit.mockImplementation(async (req, consume) => {
    await consume(getReportOutputBuilder(req)([{ joint: 'A', wdi: 1 }, { joint: 'B', wdi: 2 }, { joint: 'C', wdi: 3 }]))
    await consume(getReportOutputBuilder(req)([{ joint: 'D', wdi: 4 }, { joint: 'E', wdi: 5 }]))
    return { sourceRows: 5, generatedAt: '2026-10-26T12:00:00Z' }
  })
  const response = await createReportExcelResponse(request(), new AbortController().signal)
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()))
  expect(workbook.SheetNames).toEqual(['Текущая версия', 'Текущая версия 2', 'Текущая версия 3'])
  expect(workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1 }).slice(1).map(row => row.slice(0, 2))))
    .toEqual([['A', 1], ['B', 2], ['C', 3], ['D', 4], ['E', 5]])
  await expect.poll(files).toEqual(before)
})

it('cleans up when delivery is cancelled', async () => {
  const before = await files()
  mocks.visit.mockResolvedValue({ sourceRows: 0, generatedAt: '2026-10-26T12:00:00Z' })
  const response = await createReportExcelResponse(request(), new AbortController().signal)
  await response.body!.cancel()
  await expect.poll(files).toEqual(before)
})

it('propagates disk errors instead of completing a valid-looking truncated ZIP', async () => {
  let writes = 0
  const zip = new ReportZipWriter(async () => { if (++writes === 2) throw new Error('disk full') })
  await zip.start('file.xml')
  await zip.write('<xml>data</xml>')
  await expect(zip.end()).rejects.toThrow('disk full')
  await zip.abort()
})

it.each([
  { chunks: ['123', '456', '789'], crc: 0xcbf43926 },
  { chunks: ['Стык ', 'α😀', ' / 01'], crc: 0x551f2414 },
])('keeps the independent ZIP checksum across text chunks: $chunks', async ({ chunks, crc }) => {
  const output: Buffer[] = []
  const zip = new ReportZipWriter(async bytes => { output.push(Buffer.from(bytes)) })
  await zip.start('known.txt')
  for (const chunk of chunks) await zip.write(chunk)
  await zip.end()
  await zip.finish()
  const bytes = Buffer.concat(output)
  const directory = bytes.readUInt32LE(bytes.length - 6)
  const compressedSize = bytes.readUInt32LE(directory + 20)
  const dataStart = 30 + bytes.readUInt16LE(26)
  const original = Buffer.from(chunks.join(''))
  expect(inflateRawSync(bytes.subarray(dataStart, dataStart + compressedSize))).toEqual(original)
  expect(bytes.readUInt32LE(directory + 16)).toBe(crc)
  expect(bytes.readUInt32LE(dataStart + compressedSize + 4)).toBe(crc)
  expect(bytes.readUInt32LE(directory + 24)).toBe(original.length)
})
