import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(resolve('src/lib', `document-template-${name}.ts`), 'utf8')

describe('document template module boundaries', () => {
  it('keeps workbook processing and preview independent of persistence and RPC', () => {
    for (const name of ['model', 'xlsx', 'workbook', 'preview', 'replacement']) {
      const source = read(name)
      expect(source, name).not.toMatch(/from ['"]@\/server\//)
      expect(source, name).not.toMatch(/from ['"].*document-template-storage['"]/)
      expect(source, name).not.toContain('notifyDocumentTemplateStorageChanged')
    }
    expect(read('storage')).not.toContain('XLSX.read(')
    expect(read('storage')).not.toContain('XLSX.write(')
  })

  it('keeps one lazy XLSX loader and an acyclic processing hierarchy', () => {
    expect(read('xlsx')).toContain("xlsxModulePromise ??= import('xlsx')")
    expect(read('xlsx')).not.toMatch(/from ['"].*document-template-(?:preview|workbook|model|replacement|storage)['"]/)
    expect(read('model')).not.toMatch(/from ['"].*document-template-(?:preview|workbook|replacement|storage)['"]/)
    expect(read('workbook')).not.toMatch(/from ['"].*document-template-(?:preview|replacement|storage)['"]/)
  })
})
