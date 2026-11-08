import { describe, expect, it } from 'vitest'
import { createSupportLengthSum, formatSupportLengthDecimal, getSupportWeldLengthError, isPositiveSupportWeldLength, normalizeSupportWeldLength, SUPPORT_LENGTH_STORAGE_LIMIT_REASON } from './support-length-value'
import { getSupportJointRuleIssues } from './support-joint-rules'
import { parseCell, parseImportCell } from './weld-import-parsers'
import { FIELD_BY_KEY } from './weld-fields'
import { normalizeWeldInput } from './weld-record-transforms'
import { buildRepeatedJointDraft } from './repeated-joint-draft'
import { journalClipboardValue, journalFilterValueLabel } from './welding-journal-grid-state'
import { buildWorksheetRow } from './weld-export-xlsx-xml'
import { recordsToVisibleExportMatrix } from './weld-export-utils'

const precise = '600.123456789123456789'
const field = FIELD_BY_KEY.get('weldLength')!

describe('exact decimal support length', () => {
  it('preserves every significant digit through form/import normalization, repair draft and exported/clipboard text', () => {
    const row = { id: 1, joint: 'ОП-1', connectionType: 'Т1', weldLength: precise }
    expect(parseCell(field, precise)).toBe(precise)
    expect(parseImportCell(field, precise.replace('.', ','))).toBe(precise)
    expect(normalizeWeldInput(row).weldLength).toBe(precise)
    expect(buildRepeatedJointDraft(row, 'ОП-1R1').weldLength).toBe(precise)
    expect(journalClipboardValue(row, 'weldLength', precise)).toBe(precise)
    expect(journalFilterValueLabel('weldLength', precise)).toBe(precise)
    const matrix = recordsToVisibleExportMatrix([row], [field])
    expect(matrix[1]).toEqual([precise])
    expect(buildWorksheetRow(matrix[1], [field], 1)).toContain(`<t>${precise}</t>`)
  })
  it('normalizes notation without rounding or imposing JavaScript floating-point magnitude limits', () => {
    expect(normalizeSupportWeldLength('+00600,123456789123456789000')).toBe(precise)
    expect(normalizeSupportWeldLength('6.00123456789123456789e2')).toBe(precise)
    expect(normalizeSupportWeldLength('-0.0000')).toBe('0')
    expect(normalizeSupportWeldLength('')).toBeNull()
    for (const value of ['1e-400', '1e309', precise]) expect(isPositiveSupportWeldLength(value)).toBe(true)
    for (const value of ['0', '-0.001', 'NaN', 'Infinity', 'invalid']) expect(isPositiveSupportWeldLength(value)).toBe(false)
    expect(() => parseImportCell(field, 'Infinity')).toThrow()
  })
  it('sums different scales exactly including cancellation and values too small for Number', () => {
    const sum = createSupportLengthSum()
    for (const value of [precise, '0.000000000000000001', '399.87654321087654321']) expect(sum.add(value)).toBe(true)
    expect(sum.value()).toBe('1000')
    sum.add('-999.999999999999999999')
    expect(sum.value()).toBe('0.000000000000000001')
    expect(sum.add('invalid')).toBe(false)
    expect(formatSupportLengthDecimal(precise)).toBe('600,123456789123456789')
    expect(formatSupportLengthDecimal('1234567.123456789123456789')).toBe('1\u00a0234\u00a0567,123456789123456789')
  })
  it('accepts the PostgreSQL NUMERIC boundaries and reports an unrepresentable L together with independent row errors', () => {
    for (const value of ['1e131071', '1e-16383']) {
      expect(getSupportWeldLengthError(value)).toBeNull()
      expect(isPositiveSupportWeldLength(value)).toBe(true)
    }
    for (const value of ['1e131072', '1e-16384']) {
      expect(getSupportWeldLengthError(value)).toBe(SUPPORT_LENGTH_STORAGE_LIMIT_REASON)
      expect(isPositiveSupportWeldLength(value)).toBe(false)
      const issues = getSupportJointRuleIssues({ joint: 'ОП-1', connectionType: 'Т1', weldLength: value, stamp1ZFact: 'SECOND' })
      expect(issues.map(issue => issue.message).join(' ')).toContain(SUPPORT_LENGTH_STORAGE_LIMIT_REASON)
      expect(issues.flatMap(issue => issue.fieldKeys)).toEqual(expect.arrayContaining(['weldLength', 'stamp1ZFact']))
    }
  })
})
