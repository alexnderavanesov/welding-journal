import { describe, expect, it } from 'vitest'
import { buildExistingRowImportUpdates } from './use-report-import-mutations'

describe('buildExistingRowImportUpdates', () => {
  it('keeps updates for IDs that are outside the currently visible table page', () => {
    const { updatedRows, changedFieldKeys, invalidRecords } = buildExistingRowImportUpdates([
      { id: 7, material1: '09Г2С' },
      { id: 900, material2: '12Х18Н10Т' },
    ])

    expect(updatedRows).toHaveLength(2)
    expect(updatedRows[0]).toMatchObject({ id: 7, material1: '09Г2С' })
    expect(updatedRows[1]).toMatchObject({ id: 900, material2: '12Х18Н10Т' })
    expect([...changedFieldKeys]).toEqual(expect.arrayContaining(['material1', 'material2']))
    expect(invalidRecords).toBe(0)
  })

  it('preserves an explicit null so replace data can clear a value', () => {
    const { updatedRows, changedFieldKeys } = buildExistingRowImportUpdates([
      { id: 7, material1: null },
    ])

    expect(updatedRows).toHaveLength(1)
    expect(updatedRows[0]).toEqual({ id: 7, material1: null })
    expect([...changedFieldKeys]).toContain('material1')
  })

  it('drops malformed rows without an ID and ignores non-field transport keys', () => {
    const { updatedRows, changedFieldKeys, invalidRecords } = buildExistingRowImportUpdates([
      { material1: 'Без ID' },
      { id: 8, material1: '09Г2С', deleteRequested: false },
    ])

    expect(updatedRows).toHaveLength(1)
    expect(updatedRows[0]).toEqual({ id: 8, material1: '09Г2С' })
    expect([...changedFieldKeys]).toEqual(['material1'])
    expect(invalidRecords).toBe(1)
  })
})
