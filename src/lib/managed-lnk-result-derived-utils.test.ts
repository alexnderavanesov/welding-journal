import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getManagedLnkResultEntries,
  getManagedLnkResultMethodRows,
  getManagedLnkResultMethods,
} from '@/lib/managed-lnk-result-derived-utils'

describe('managed LNK result derivation', () => {
  it('keeps a completed control addressable while its request identity is being repaired', () => {
    const row = {
      id: 17,
      joint: 'F17',
      hasVik: 'да',
      vikRequest: null,
      vikRequestDate: null,
      vikResult: 'годен',
      vikConclusion: 'ВИК-17',
      vikConclusionDate: '2026-08-15',
    } as WeldRow
    const forcedEntry = { rowId: row.id, methodKey: 'vikRequest' as const }

    expect(getManagedLnkResultMethods([row])).toEqual([])
    expect(getManagedLnkResultMethods([row], forcedEntry).map((method) => method.code)).toEqual(['ВИК'])

    const methodRows = getManagedLnkResultMethodRows({
      managedLnkResultRows: [row],
      managedLnkResultMethodKey: 'vikRequest',
      forcedEntry,
    })
    expect(methodRows).toEqual([row])
    expect(getManagedLnkResultEntries({
      managedLnkResultRows: [row],
      managedLnkResultMethodRows: methodRows,
      managedLnkResultMethodKey: 'vikRequest',
      forcedEntry,
    })).toMatchObject([{
      row: { id: 17 },
      method: { code: 'ВИК', requestKey: 'vikRequest' },
      changeKey: '17:vikRequest',
    }])
  })
})
