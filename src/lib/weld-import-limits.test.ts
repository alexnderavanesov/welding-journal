import { describe, expect, it } from 'vitest'
import {
  WELD_IMPORT_MAX_ROWS,
  assertUniqueWeldMutationTargets,
  assertWeldImportRowLimit,
  compactWeldWritePayload,
  splitWeldImportInsertBatches,
} from './weld-import-limits'

describe('weld import limits', () => {
  it('accepts up to 2000 rows and rejects the next row with a clear message', () => {
    expect(() => assertWeldImportRowLimit(WELD_IMPORT_MAX_ROWS)).not.toThrow()
    expect(() => assertWeldImportRowLimit(WELD_IMPORT_MAX_ROWS + 1)).toThrow(
      'В одном файле можно обработать не более 2000 строк. Найдено: 2001.',
    )
  })

  it('splits a large insert into safe ordered batches', () => {
    const records = Array.from({ length: WELD_IMPORT_MAX_ROWS }, (_, index) => index + 1)
    const batches = splitWeldImportInsertBatches(records)

    expect(batches).toHaveLength(20)
    expect(batches.every((batch) => batch.length === 100)).toBe(true)
    expect(batches.flat()).toEqual(records)
  })

  it('splits the reported 443-row import without losing or reordering rows', () => {
    const records = Array.from({ length: 443 }, (_, index) => index + 1)
    const batches = splitWeldImportInsertBatches(records)

    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 100, 100, 43])
    expect(batches.flat()).toEqual(records)
  })

  it('keeps a partial final batch', () => {
    expect(splitWeldImportInsertBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('rejects duplicate update IDs and update-delete overlaps', () => {
    expect(() => assertUniqueWeldMutationTargets([{ id: 7 }, { id: 7 }])).toThrow(
      'Запись с ID 7 передана на обновление несколько раз.',
    )
    expect(() => assertUniqueWeldMutationTargets([{ id: 7 }, { id: 8 }], [8, 9])).toThrow(
      'Запись с ID 8 нельзя одновременно обновить и удалить.',
    )
    expect(() => assertUniqueWeldMutationTargets([{ id: 7 }, { id: 8 }], [9])).not.toThrow()
  })

  it('removes empty transport values without losing zeroes or booleans', () => {
    expect(compactWeldWritePayload({
      id: 7,
      empty: '',
      missing: undefined,
      cleared: null,
      zero: 0,
      disabled: false,
      joint: 'S1',
    })).toEqual({ id: 7, zero: 0, disabled: false, joint: 'S1' })
  })
})
