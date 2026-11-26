import { fileURLToPath } from 'node:url'

export const templateInspectionWorkerUrl = import.meta.url

if (process.env.DOCUMENT_TEMPLATE_WORKER === '1' && typeof process.send === 'function' &&
    process.argv[1] === fileURLToPath(import.meta.url)) {
  process.once('disconnect', () => process.exit(1))
  process.once('message', async ({ bytes, fileType, bindingConfig }) => {
    let result = { ok: false }
    try {
      const { readDocumentTemplateWorkbook } = await import('../lib/document-template-workbook.ts')
      const { workbook, metadata } = await readDocumentTemplateWorkbook(bytes, fileType, Boolean(bindingConfig))
      const issues = bindingConfig
        ? await (await import('../lib/document-template-replacement.ts')).validateDocumentTemplateRecovery(bindingConfig, workbook)
        : []
      if (Buffer.byteLength(JSON.stringify({ metadata, issues })) <= 4 * 1024 * 1024) {
        result = { ok: true, metadata, issues }
      }
    } catch { /* The parent returns a fixed public error. */ }
    process.send({ ...result, peakRssBytes: process.resourceUsage().maxRSS * 1024 }, () => process.exit(0))
  })
}
