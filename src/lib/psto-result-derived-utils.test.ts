import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { getSelectedPstoResultRows } from '@/lib/psto-result-derived-utils'
import { createDefaultPstoResultDraft } from '@/lib/report-draft-state'

describe('PSTO result request identity', () => {
  it('selects only rows from the matching request date', () => {
    const rows = [
      {
        id: 1,
        pstoRequired: 'да',
        pstoRequest: 'Заявка пользователя',
        pstoRequestDate: '2026-07-21',
        pstoResult: 'ожидает ПСТО',
      },
      {
        id: 2,
        pstoRequired: 'да',
        pstoRequest: 'Заявка пользователя',
        pstoRequestDate: '2026-08-06',
        pstoResult: 'ожидает ПСТО',
      },
    ] as WeldRow[]
    const draft = {
      ...createDefaultPstoResultDraft(),
      requestName: 'Заявка пользователя',
      requestDate: '2026-08-06',
      rowIds: new Set([1, 2]),
    }

    expect(getSelectedPstoResultRows(rows, draft).map((row) => row.id)).toEqual([2])
  })
})
