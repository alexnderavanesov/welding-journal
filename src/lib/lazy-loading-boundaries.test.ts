import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('lazy loading boundaries', () => {
  it('keeps runtime xlsx imports asynchronous outside tests', () => {
    const sources = collectTypeScriptSources(resolve(process.cwd(), 'src'))
      .filter((filePath) => !filePath.endsWith('.test.ts'))
      .filter((filePath) => !filePath.endsWith('.test.tsx'))
      .map((filePath) => readFileSync(filePath, 'utf8'))

    expect(sources.join('\n')).not.toMatch(/import\s+(?!type\b)[^;\n]+\s+from\s+['"]xlsx['"]/)
  })

  it('keeps report dialog families behind React lazy boundaries', () => {
    const reportDialogs = readFileSync(
      resolve(process.cwd(), 'src/components/report-dialogs.tsx'),
      'utf8',
    )
    const lnkDialogs = readFileSync(
      resolve(process.cwd(), 'src/components/report-lnk-dialogs.tsx'),
      'utf8',
    )
    const pstoDialogs = readFileSync(
      resolve(process.cwd(), 'src/components/report-psto-dialogs.tsx'),
      'utf8',
    )

    expect(reportDialogs).toContain("lazy(() => import('@/components/report-lnk-dialogs')")
    expect(reportDialogs).toContain("lazy(() => import('@/components/report-psto-dialogs')")
    expect(reportDialogs).toContain("import('@/components/report-import-dialog')")
    expect(lnkDialogs.match(/lazy\(\(\) => import\(/g)?.length ?? 0).toBeGreaterThanOrEqual(8)
    expect(pstoDialogs.match(/lazy\(\(\) => import\(/g)?.length ?? 0).toBeGreaterThanOrEqual(7)
  })

  it('keeps document clients on the browser-safe template API boundary', () => {
    const storage = readFileSync(
      resolve(process.cwd(), 'src/lib/document-template-storage.ts'),
      'utf8',
    )
    const availability = readFileSync(
      resolve(process.cwd(), 'src/lib/use-system-document-template-availability.ts'),
      'utf8',
    )
    const api = readFileSync(
      resolve(process.cwd(), 'src/server/document-templates-api.ts'),
      'utf8',
    )

    expect(storage).toContain("from '@/server/document-templates-api'")
    expect(storage).not.toContain("from '@/server/document-templates'")
    expect(availability).toContain("from '@/server/document-templates-api'")
    expect(availability).not.toContain("import('@/server/document-templates')")
    expect(api).not.toMatch(/from '@\/server\/document-templates'/)
    expect(api).toContain("await import('@/server/document-templates')")
  })
})

function collectTypeScriptSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return collectTypeScriptSources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}
