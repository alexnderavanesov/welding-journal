import { describe, expect, it, vi } from 'vitest'

import {
  getLnkOfficialityChainSelectFieldKeysForTest,
  LNK_OFFICIALITY_CHAIN_SELECT,
  loadLnkOfficialityLineChainRowsForTest,
  type LnkOfficialityChainRow,
} from '@/server/lnk-officiality-workflow'

class FakeSelectQuery implements PromiseLike<LnkOfficialityChainRow[]> {
  readonly for = vi.fn(async () => [] as LnkOfficialityChainRow[])

  from() {
    return this
  }

  where() {
    return this
  }

  orderBy() {
    return this
  }

  then<TResult1 = LnkOfficialityChainRow[], TResult2 = never>(
    onfulfilled?: ((value: LnkOfficialityChainRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve([] as LnkOfficialityChainRow[]).then(onfulfilled, onrejected)
  }
}

describe('lnk officiality workflow load shape', () => {
  it('uses a compact chain projection instead of the full weld row for officiality planning', () => {
    const fieldKeys = getLnkOfficialityChainSelectFieldKeysForTest()

    expect(fieldKeys).toEqual(expect.arrayContaining([
      'id',
      'rowVersion',
      'projectTitle',
      'subtitleCode',
      'line',
      'spool',
      'joint',
      'officiality',
      'finalStatus',
      'weldDate',
      'pstoDate',
      'rkResult',
      'vikRequestDate',
      'tvmtConclusionDate',
      'vikDefectDescription',
      'lnkDefectDescription',
      'uzkDefectDescription',
      'pvkDefectDescription',
      'rkExposureConfirmedDiameter',
      'lnkNote',
    ]))
    expect(fieldKeys).not.toEqual(expect.arrayContaining([
      'materialFullName1',
      'materialCertificateNumber1',
      'weldingElectrodesCertificateNumber',
      'createdAt',
      'updatedAt',
    ]))
  })

  it('loads production-sized officiality line scopes in bounded sequential batches', async () => {
    const queries: FakeSelectQuery[] = []
    const select = vi.fn((selection) => {
      expect(selection).toBe(LNK_OFFICIALITY_CHAIN_SELECT)
      const query = new FakeSelectQuery()
      queries.push(query)
      return query
    })
    const targetRows = Array.from({ length: 401 }, (_, index) => ({
      id: index + 1,
      projectTitle: 'P',
      subtitleCode: 'S',
      line: `L${index + 1}`,
    })) as LnkOfficialityChainRow[]

    await loadLnkOfficialityLineChainRowsForTest(
      { select } as never,
      targetRows,
      true,
    )

    expect(select).toHaveBeenCalledTimes(3)
    expect(queries.every((query) => query.for.mock.calls.length === 1)).toBe(true)
  })
})
