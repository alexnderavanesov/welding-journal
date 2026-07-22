import { describe, expect, it } from 'vitest'

import { getLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { buildLnkRequestDraftRows, buildLnkRequestManagerRows } from '@/lib/lnk-request-mutation-updates'
import type { RowWithId } from '@/lib/lnk-report-mutation-types'

describe('lnk request mutation updates', () => {
  it('builds draft rows that can be checked before saving a request', () => {
    const records = [
      {
        id: 1,
        joint: 'F4',
        weldDate: '2026-07-04',
        hasVik: 'да',
      },
    ] as RowWithId[]

    const proposedRows = buildLnkRequestDraftRows({
      records,
      methodKeys: ['vikRequest'],
      requestName: 'Заявка-01.07.2026-001',
      requestDate: '2026-07-01',
    })
    const [issue] = getLnkChronologyIssues(proposedRows)

    expect(proposedRows[0]?.vikRequestDate).toBe('2026-07-01')
    expect(issue?.message).toBe('Стык F4: дата заявки ВИК 01.07.2026 раньше даты сварки 04.07.2026.')
  })

  it('renames an LNK request without changing its request date', () => {
    const records = [
      {
        id: 1,
        vikRequest: 'Заявка №3434 от 21.07.2026',
        vikRequestDate: '2026-07-21',
        vikResult: 'ожидает НК',
      },
    ] as RowWithId[]

    const [updated] = buildLnkRequestManagerRows({
      records,
      requestName: 'Заявка №3434 от 21.07.2026',
      nextRequestName: 'Заявка №3434-А от 21.07.2026',
      action: 'rename',
    })

    expect(updated.vikRequest).toBe('Заявка №3434-А от 21.07.2026')
    expect(updated.vikRequestDate).toBe('2026-07-21')
  })

  it('deletes an LNK request even when remaining LNK data needs dispatcher review', () => {
    const records = [
      {
        id: 1,
        joint: 'F7',
        vikRequest: 'Заявка-ВИК',
        vikRequestDate: '2026-07-21',
        vikResult: 'годен',
        vikConclusionDate: '2026-07-21',
        vikConclusion: 'Заключение-ВИК',
        rkRequest: 'Заявка-РК',
        rkRequestDate: '2026-07-21',
        rkResult: 'годен',
        rkConclusionDate: '2026-07-21',
        rkConclusion: 'Заключение-РК',
      },
    ] as RowWithId[]

    const [updated] = buildLnkRequestManagerRows({
      records,
      requestName: 'Заявка-ВИК',
      nextRequestName: '',
      action: 'delete',
    })

    expect(updated.vikRequest).toBeNull()
    expect(updated.vikRequestDate).toBeNull()
    expect(updated.vikResult).toBeNull()
    expect(updated.vikConclusionDate).toBeNull()
    expect(updated.vikConclusion).toBeNull()
    expect(updated.rkRequest).toBe('Заявка-РК')
    expect(updated.rkResult).toBe('годен')
  })
})
