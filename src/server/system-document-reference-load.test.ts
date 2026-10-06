import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { generatedDocuments, weldJoints } from '@/db/schema'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import { buildGeneratedDocumentReferenceWhere, buildSystemDocumentReferencesWhere } from './system-document-index'

describe('batched exact document references', () => {
  it.each([24, 200_000])('keeps SQL structure bounded for %i references', count => {
    const references: SystemDocumentReference[] = Array.from({ length: count }, (_, i) => ({
      type: 'pstoConclusion', title: `Diagram ${i}`, date: i % 2 ? '2026-09-01' : '',
    }))
    const welds = drizzle.mock().select({ id: weldJoints.id }).from(weldJoints)
      .where(buildSystemDocumentReferencesWhere(references)).toSQL()
    expect(welds.params).toHaveLength(2)
    expect(welds.sql.length).toBeLessThan(1500)
    expect(welds.params).toEqual([references.map(item => item.title), references.map(item => item.date)])
    const documents = drizzle.mock().select({ id: generatedDocuments.id }).from(generatedDocuments)
      .where(buildGeneratedDocumentReferenceWhere(references)).toSQL()
    expect(documents.params).toHaveLength(3)
    expect(documents.sql.length).toBeLessThan(1500)
    expect(documents.params).toEqual([
      references.map(() => 'system:pstoConclusion'), references.map(item => item.date), references.map(item => item.title),
    ])
  })
  it('keeps own requests separate from TVMT and keeps conclusion methods exact', () => {
    const compile = (references: SystemDocumentReference[]) => drizzle.mock().select({ id: weldJoints.id }).from(weldJoints)
      .where(buildSystemDocumentReferencesWhere(references)).toSQL()
    const own = compile([{ type: 'lnkRequest', title: 'R', date: '2026-09-01' }])
    for (const method of ['vik', 'pvk', 'rk', 'uzk']) expect(own.sql).toContain(`"${method}_request"`)
    expect(own.sql).not.toContain('"tvmt_request"')
    const tvmt = compile([{ type: 'lnkRequest', methodCode: 'ТВМТ', title: 'R', date: '2026-09-01' }])
    expect(tvmt.sql).toContain('"tvmt_request"')
    expect(tvmt.sql).not.toContain('"vik_request"')
    const rk = compile([{ type: 'lnkConclusion', methodCode: 'РК', title: 'C', date: '' }])
    expect(rk.sql).toContain('"rk_conclusion"')
    expect(rk.sql).not.toContain('"uzk_conclusion"')
    expect(compile([{ type: 'lnkConclusion', methodCode: 'unknown', title: 'C', date: '' }]).sql).toContain('false')
    expect(compile([]).sql).toContain('false')
  })
})
