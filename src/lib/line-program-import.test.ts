import { describe, expect, it } from 'vitest'
import { addLineProgramImportErrors } from './line-program-import'
import type { ReportImportPreview } from './report-import-preview'

const program = { projectTitle: 'P', subtitleCode: 'S', line: 'L', category: 'II', groupName: 'A', weldControlPercent: 30, pvkControlPercent: 10 }
const row = { ...program, id: 7, joint: 'F1', category: 'III', groupName: 'B', weldControlPercent: 10 }
const preview = (records = [row]): ReportImportPreview => ({ fileName: 'test.csv', fields: [], records, validRecords: records, errors: [], skippedRows: 0 })

describe('line-program import final-record validation', () => {
  it('collects all three program conflicts together with another field error on the same row', () => {
    const input = preview()
    input.recordRowNumbers = [15]
    input.errors = [{ id: 7, rowNumber: 15, title: 'F1', message: 'Некорректная дата сварки.', fieldKeys: ['weldDate'] }]
    const result = addLineProgramImportErrors(input, [program])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].fieldKeys).toEqual(['weldDate', 'category', 'groupName', 'weldControlPercent'])
    expect(result.errors[0].message).toContain('Некорректная дата сварки')
    expect(result.errors[0].rowNumber).toBe(15)
    expect(result.validRecords).toEqual([])
    expect(input.errors[0].fieldKeys).toEqual(['weldDate'])
  })
  it('rejects inconsistent new-line metadata on every affected row, not an arbitrary winner', () => {
    const result = addLineProgramImportErrors(preview([row, { ...row, id: 8, category: 'II', weldControlPercent: 20 }]), [])
    expect(result.errors).toHaveLength(2)
    expect(result.errors.every((error) => error.fieldKeys?.join(',') === 'category,weldControlPercent')).toBe(true)
    expect(result.validRecords).toHaveLength(0)
  })
  it('accepts matching metadata and decimal text, and does not treat deletion as a metadata write', () => {
    const record = { ...row, ...program }
    const input = preview([record])
    expect(addLineProgramImportErrors(input, [program]).errors).toEqual([])
    input.records = [{ ...row, deleteRequested: true }]
    expect(addLineProgramImportErrors(input, [program]).errors).toEqual([])
  })
})
