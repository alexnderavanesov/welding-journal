import { mkdtemp, open, rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { createDeflateRaw, crc32 } from 'node:zlib'
import { formatReportFieldValue, normalizeSheetName } from '@/lib/weld-export-utils'
import { buildContentTypesXml, buildRootRelsXml, buildWorkbookXml, buildWorkbookRelsXml, buildXlsxStylesXml,
  buildWorksheetHeader, buildWorksheetRow, WORKSHEET_END, EXCEL_SHEET_DATA_ROWS } from '@/lib/weld-export-xlsx-xml'
import { getReportOutputBuilder } from '@/lib/report-output-definition'
import type { ReportOutputRequest } from './weld-contracts'
import { visitReportOutput } from './weld-read'

/** One temporary file per HTTP request, removed on failure, cancellation or
 * completed delivery. No job registry, snapshot store or browser workbook. */
export async function createReportExcelResponse(input: ReportOutputRequest, signal: AbortSignal) {
  input = (await import('./access-payload')).accessibleReportInput(input)
  const definition = getReportOutputBuilder(input)([]).exportData!
  const directory = await mkdtemp(join(tmpdir(), 'welding-report-'))
  const path = join(directory, 'report.xlsx')
  const cleanup = () => rm(directory, { recursive: true, force: true })
  const file = await open(path, 'wx').catch(async error => { await cleanup(); throw error })
  const archive = new ReportZipWriter(async bytes => { await file.writeFile(bytes) })
  try {
    const sheetNames: string[] = []
    let sheetRow = 0
    const startSheet = async () => {
      const suffix = sheetNames.length ? ` ${sheetNames.length + 1}` : ''
      sheetNames.push(normalizeSheetName(definition.sheetName).slice(0, 31 - suffix.length) + suffix)
      await archive.start(`xl/worksheets/sheet${sheetNames.length}.xml`)
      await archive.write(buildWorksheetHeader(definition.fields))
      await archive.write(buildWorksheetRow(definition.fields.map(field => field.label), definition.fields, 0))
      sheetRow = 0
    }
    await startSheet()
    const snapshot = await visitReportOutput(input, async ({ exportData }) => {
      // One source batch at a time. XML chunks and compression have bounded
      // buffers, including reports expanding one joint into several methods.
      let xml: string[] = []
      for (const row of exportData.rows) {
        if (sheetRow === EXCEL_SHEET_DATA_ROWS) {
          await archive.write(xml.join('')); xml = []
          await archive.write(WORKSHEET_END); await archive.end(); await startSheet()
        }
        xml.push(buildWorksheetRow(definition.fields.map(field => formatReportFieldValue(row, field)), definition.fields, ++sheetRow))
        if (xml.length === 100) { await archive.write(xml.join('')); xml = [] }
      }
      if (xml.length) await archive.write(xml.join(''))
    }, signal)
    await archive.write(WORKSHEET_END); await archive.end()
    for (const [name, content] of [
      ['[Content_Types].xml', buildContentTypesXml(sheetNames.length)], ['_rels/.rels', buildRootRelsXml()],
      ['xl/workbook.xml', buildWorkbookXml(sheetNames)], ['xl/_rels/workbook.xml.rels', buildWorkbookRelsXml(sheetNames.length)],
      ['xl/styles.xml', buildXlsxStylesXml()],
    ]) { await archive.start(name); await archive.write(content); await archive.end() }
    await archive.finish()
    signal.throwIfAborted()
    const { size } = await file.stat()
    await file.close()
    const stream = createReadStream(path)
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>
    const abort = () => stream.destroy(new Error('Скачивание отменено'))
    signal.addEventListener('abort', abort, { once: true })
    stream.once('close', () => { signal.removeEventListener('abort', abort); void cleanup().catch(error => console.error('Report file cleanup failed', error)) })
    if (signal.aborted) abort()
    return new Response(body, { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${definition.filename}"`,
      'Content-Length': String(size), 'Cache-Control': 'no-store', 'X-Report-Filename': definition.filename,
      'X-Report-Generated-At': snapshot.generatedAt,
    } })
  } catch (error) {
    await archive.abort(); await file.close().catch(() => {}); await cleanup(); throw error
  }
}

/** ZIP data descriptors allow compressing each member without retaining it.
 * Only central directory headers (a few hundred bytes per sheet) stay in JS. */
export class ReportZipWriter {
  private offset = 0
  private headers: Buffer[] = []
  private current?: { name: Buffer; offset: number; raw: number; compressed: number; crc: number;
    deflater: ReturnType<typeof createDeflateRaw>; pumping: Promise<void>; failure?: unknown }
  constructor(private readonly sink: (bytes: Uint8Array) => Promise<void>) {}
  private async emit(bytes: Uint8Array) {
    if (this.offset + bytes.length > 0xffffffff) throw new Error('Размер Excel превышает возможности формата ZIP. Разделите выгрузку фильтрами.')
    await this.sink(bytes); this.offset += bytes.length
  }
  async start(path: string) {
    if (this.current) throw new Error('ZIP entry is still open')
    const name = Buffer.from(path), offset = this.offset, header = Buffer.alloc(30 + name.length)
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0808, 6)
    header.writeUInt16LE(8, 8); header.writeUInt16LE(name.length, 26); name.copy(header, 30)
    await this.emit(header)
    const deflater = createDeflateRaw({ level: 1 })
    const entry = this.current = { name, offset, raw: 0, compressed: 0, crc: 0, deflater, pumping: Promise.resolve(), failure: undefined as unknown }
    entry.pumping = (async () => {
      try { for await (const chunk of deflater) { entry.compressed += chunk.length; await this.emit(chunk) } }
      catch (error) { entry.failure = error; deflater.destroy(error as Error) }
    })()
  }
  async write(text: string) {
    const entry = this.current!
    if (entry.failure) throw entry.failure
    const bytes = Buffer.from(text)
    entry.raw += bytes.length
    if (entry.raw > 0xffffffff) throw new Error('Лист Excel слишком велик. Разделите выгрузку фильтрами.')
    entry.crc = crc32(bytes, entry.crc)
    if (!entry.deflater.write(bytes)) await once(entry.deflater, 'drain')
    if (entry.failure) throw entry.failure
  }
  async end() {
    const entry = this.current!
    entry.deflater.end(); await entry.pumping
    if (entry.failure) throw entry.failure
    const crc = entry.crc, descriptor = Buffer.alloc(16)
    descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc, 4)
    descriptor.writeUInt32LE(entry.compressed, 8); descriptor.writeUInt32LE(entry.raw, 12)
    await this.emit(descriptor)
    const header = Buffer.alloc(46 + entry.name.length)
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0808, 8); header.writeUInt16LE(8, 10); header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(entry.compressed, 20); header.writeUInt32LE(entry.raw, 24)
    header.writeUInt16LE(entry.name.length, 28); header.writeUInt32LE(entry.offset, 42); entry.name.copy(header, 46)
    this.headers.push(header); this.current = undefined
  }
  async finish() {
    const offset = this.offset
    for (const header of this.headers) await this.emit(header)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(this.headers.length, 8); end.writeUInt16LE(this.headers.length, 10)
    end.writeUInt32LE(this.offset - offset, 12); end.writeUInt32LE(offset, 16)
    await this.emit(end)
  }
  async abort() { this.current?.deflater.destroy(); await this.current?.pumping }
}
