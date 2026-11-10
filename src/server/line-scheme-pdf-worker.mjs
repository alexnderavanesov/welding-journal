import { fileURLToPath } from 'node:url'

// A lazy server import gives Nitro a separate, relocatable worker chunk. Merely
// importing it in the application must never start a parser or an IPC listener.
export const pdfValidationWorkerUrl = import.meta.url

if (process.env.LINE_SCHEME_PDF_WORKER === '1' && typeof process.send === 'function' &&
    process.argv[1] === fileURLToPath(import.meta.url)) {
  process.once('disconnect', () => process.exit(1))
  process.once('message', async job => {
    let result
    try {
      result = { ok: true, pages: await validate(job) }
    } catch (error) {
      result = { ok: false, reason: error instanceof Error ? error.message : 'invalid' }
    }
    // Unlike heapUsed, kernel peak RSS includes external Buffer/Uint8Array
    // allocations. Check short-lived workers even before the first parent poll.
    process.send({ ...result, peakRssBytes: process.resourceUsage().maxRSS * 1024 }, () => process.exit(0))
  })
}

async function validate(job) {
  if (!job || typeof job.path !== 'string' || !Number.isSafeInteger(job.maxBytes) || job.maxBytes <= 0 ||
      !Number.isSafeInteger(job.maxPages) || job.maxPages <= 0) throw new Error('invalid')
  const { readFile, stat } = await import('node:fs/promises')
  const size = (await stat(job.path)).size
  if (!size || size > job.maxBytes) throw new Error('size')
  const bytes = await readFile(job.path)
  if (!bytes.length || bytes.length > job.maxBytes || !bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw new Error('size')
  const { PDFDocument, ParseSpeeds } = await import('pdf-lib')
  let doc
  try { doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, parseSpeed: ParseSpeeds.Medium, throwOnInvalidObject: true }) }
  catch { throw new Error('invalid') }
  if (doc.isEncrypted) throw new Error('encrypted')
  let pages
  try { pages = doc.getPages() } catch { throw new Error('tree') }
  if (pages.length < 1 || pages.length > job.maxPages) throw new Error('pages')
  for (const page of pages) {
    let box
    try { box = page.getCropBox() } catch { throw new Error('box') }
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) throw new Error('box')
  }
  return pages.length
}
