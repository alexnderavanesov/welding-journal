import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  assertRegistryRevision,
  getRemovedWelderStampReferenceAliases,
} from '@/server/welder-stamps'

describe('welder stamp registry concurrency', () => {
  it('accepts the exact loaded revision', () => {
    expect(() => assertRegistryRevision('current', 'current')).not.toThrow()
  })

  it('rejects a stale revision', () => {
    expect(() => assertRegistryRevision('current', 'stale')).toThrow(/изменён другим пользователем/i)
  })

  it('does not allow callers to bypass the check with an empty revision', () => {
    expect(() => assertRegistryRevision('current', '')).toThrow(/изменён другим пользователем/i)
  })
})

describe('welder stamp registry references', () => {
  it('validates existing suspensions before replacing the stamp registry', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server/welder-stamps.ts'), 'utf8')
    const saveStart = source.indexOf('export const saveWelderStampRecords')
    const suspensionSaveStart = source.indexOf('export const saveWelderStampSuspensionRecords')
    const saveSource = source.slice(saveStart, suspensionSaveStart)
    const validationIndex = saveSource.indexOf('assertWelderStampSuspensionsReferenceRegistry(')
    const deleteIndex = saveSource.indexOf('tx.delete(welderStamps)')

    expect(validationIndex).toBeGreaterThanOrEqual(0)
    expect(deleteIndex).toBeGreaterThan(validationIndex)
  })

  it('distinguishes official and factual aliases removed from the registry', () => {
    expect(getRemovedWelderStampReferenceAliases(
      [
        { naksStamp: 'ABC1', internalStamp: 'I-1' },
        { naksStamp: 'KEEP', internalStamp: 'I-2' },
      ],
      [
        { naksStamp: 'KEEP', internalStamp: 'I-1' },
      ],
    )).toEqual({
      official: ['ABC1'],
      factual: ['ABC1', 'I-2'],
    })
  })

  it('checks weld references before replacing the stamp registry', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server/welder-stamps.ts'), 'utf8')
    const saveStart = source.indexOf('export const saveWelderStampRecords')
    const suspensionSaveStart = source.indexOf('export const saveWelderStampSuspensionRecords')
    const saveSource = source.slice(saveStart, suspensionSaveStart)
    const referenceValidationIndex = saveSource.indexOf('assertRemovedWelderStampAliasesAreUnused(')
    const deleteIndex = saveSource.indexOf('tx.delete(welderStamps)')

    expect(referenceValidationIndex).toBeGreaterThanOrEqual(0)
    expect(deleteIndex).toBeGreaterThan(referenceValidationIndex)
  })
})
