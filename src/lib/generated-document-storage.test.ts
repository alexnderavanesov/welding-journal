import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getUniqueArchiveFileName,
} from '@/lib/generated-document-storage'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('archive document names', () => {
  it('keeps entries flat and resolves case-insensitive file-name collisions', () => {
    const usedNames = new Map<string, number>()

    expect(getUniqueArchiveFileName('ЗНК 7328/1024.xlsx', usedNames))
      .toBe('ЗНК 7328-1024.xlsx')
    expect(getUniqueArchiveFileName('знк 7328\\1024.xlsx', usedNames))
      .toBe('знк 7328-1024 (2).xlsx')
    expect(getUniqueArchiveFileName('ЗНК 7328-1024 (2).xlsx', usedNames))
      .toBe('ЗНК 7328-1024 (2) (2).xlsx')
  })
})
