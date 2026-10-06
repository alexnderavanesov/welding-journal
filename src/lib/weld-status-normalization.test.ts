import { describe, expect, it, vi } from 'vitest'
import { FINAL_STATUS_OPTIONS, RESULT_STATUS_OPTIONS, normalizeFinalStatus, normalizeResultStatus } from './weld-status'

describe('status normalization preserves canonical text without per-option normalization', () => {
  it.each(RESULT_STATUS_OPTIONS)('normalizes a control result: %s', status => {
    expect(normalizeResultStatus(`  ${status.toUpperCase()}  `)).toBe(status)
    expect(normalizeResultStatus(`${status} · назначение отменено`)).toBe(status)
  })

  it.each(FINAL_STATUS_OPTIONS)('normalizes a final status: %s', status => {
    expect(normalizeFinalStatus(`  ${status.toUpperCase()}  `)).toBe(status === 'не годен по дублю' ? 'не годен' : status)
  })

  it('keeps historical aliases and rejects unknown or absent values', () => {
    for (const value of ['да', 'проведено', 'годен (отменен)', 'проведено (отменен)']) expect(normalizeResultStatus(value)).toBe('годен')
    expect(normalizeFinalStatus('ожидает')).toBe('ожидает НК')
    for (const value of [null, undefined, '', 'постороннее значение']) {
      expect(normalizeResultStatus(value)).toBeNull()
      expect(normalizeFinalStatus(value)).toBeNull()
    }
  })

  it('normalizes only the input, not every constant label on each of many rows', () => {
    // The 200k-joint CPU profile identified repeatedly lowercasing fixed option
    // lists as a hot path. Bound operations rather than machine-dependent time.
    const lower = vi.spyOn(String.prototype, 'toLowerCase')
    let calls = 0
    try {
      for (let i = 0; i < 1000; i++) {
        normalizeResultStatus(null)
        normalizeFinalStatus('ОЖИДАЕТ НК')
      }
      calls = lower.mock.calls.length
    } finally { lower.mockRestore() }
    expect(calls).toBeLessThanOrEqual(2000)
  })
})
