import { describe, expect, it } from 'vitest'

import { getLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { buildLnkFieldRow } from '@/lib/lnk-field-mutation-updates'
import {
  buildLnkRequestCorrectionRow,
  buildLnkRequestDraftRows,
  buildLnkRequestManagerRows,
} from '@/lib/lnk-request-mutation-updates'
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
      requestDate: '2026-07-21',
      nextRequestName: 'Заявка №3434-А от 21.07.2026',
      action: 'rename',
    })

    expect(updated.vikRequest).toBe('Заявка №3434-А от 21.07.2026')
    expect(updated.vikRequestDate).toBe('2026-07-21')
  })

  it('blocks deleting an LNK request when one of its positions has a completed control', () => {
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

    expect(() => buildLnkRequestManagerRows({
      records,
      requestName: 'Заявка-ВИК',
      requestDate: '2026-07-21',
      nextRequestName: '',
      action: 'delete',
    })).toThrow('Нельзя исключить ВИК стыка F7 из заявки')
  })

  it('deletes a wholly pending request without touching unrelated methods', () => {
    const records = [
      {
        id: 1,
        joint: 'F7',
        hasVik: 'да',
        vikRequest: 'Заявка-001',
        vikRequestDate: '2026-07-21',
        vikResult: 'ожидает НК',
        hasRk: 'да',
        rkRequest: 'Другая заявка',
        rkRequestDate: '2026-07-22',
        rkResult: 'ожидает НК',
      },
      {
        id: 2,
        joint: 'F8',
        hasVik: 'да',
        vikRequest: 'Заявка-001',
        vikRequestDate: '2026-07-21',
        vikResult: 'ожидает НК',
      },
    ] as RowWithId[]

    const updated = buildLnkRequestManagerRows({
      records,
      requestName: 'Заявка-001',
      requestDate: '2026-07-21',
      nextRequestName: '',
      action: 'delete',
    })

    expect(updated).toHaveLength(2)
    expect(updated.every((row) => row.vikRequest === null && row.vikResult === null)).toBe(true)
    expect(updated[0]?.rkRequest).toBe('Другая заявка')
    expect(updated[0]?.rkResult).toBe('ожидает НК')
  })

  it('removes only the selected pending method from a joint', () => {
    const record = {
      id: 1,
      joint: 'F7',
      hasVik: 'да',
      vikRequest: 'Заявка-001',
      vikRequestDate: '2026-07-21',
      vikResult: 'ожидает НК',
      hasRk: 'да',
      rkRequest: 'Заявка-001',
      rkRequestDate: '2026-07-21',
      rkResult: 'ожидает НК',
    } as RowWithId

    const updated = buildLnkRequestCorrectionRow({
      record,
      methodKey: 'vikRequest',
      requestName: null,
    })

    expect(updated.hasVik).toBe('да')
    expect(updated.vikRequest).toBeNull()
    expect(updated.vikRequestDate).toBeNull()
    expect(updated.vikResult).toBeNull()
    expect(updated.rkRequest).toBe('Заявка-001')
    expect(updated.rkResult).toBe('ожидает НК')
  })

  it('blocks removing one position when it already has a result or conclusion', () => {
    const withResult = {
      id: 1,
      joint: 'F7',
      vikRequest: 'Заявка-001',
      vikRequestDate: '2026-07-21',
      vikResult: 'годен',
    } as RowWithId
    const withConclusion = {
      ...withResult,
      vikResult: 'ожидает НК',
      vikConclusion: 'Заключение-001',
    } as RowWithId

    for (const record of [withResult, withConclusion]) {
      expect(() => buildLnkRequestCorrectionRow({
        record,
        methodKey: 'vikRequest',
        requestName: null,
      })).toThrow('Сначала удалите результат в отчете ЛНК')
    }
  })

  it('keeps the same protection in the legacy inline request editor', () => {
    const record = {
      id: 1,
      joint: 'F7',
      hasVik: 'да',
      vikRequest: 'Заявка-001',
      vikRequestDate: '2026-07-21',
      vikResult: 'годен',
    } as RowWithId

    expect(() => buildLnkFieldRow({
      record,
      fieldKey: 'vikRequest',
      value: null,
      lnkRequestOptions: [],
    })).toThrow('Нельзя исключить ВИК стыка F7 из заявки')
  })

  it('renames only the LNK request with the matching name and date', () => {
    const records = [
      {
        id: 1,
        vikRequest: 'Заявка пользователя',
        vikRequestDate: '2026-07-21',
      },
      {
        id: 2,
        vikRequest: 'Заявка пользователя',
        vikRequestDate: '2026-08-06',
      },
    ] as RowWithId[]

    const updated = buildLnkRequestManagerRows({
      records,
      requestName: 'Заявка пользователя',
      requestDate: '2026-08-06',
      nextRequestName: 'Заявка пользователя новая',
      action: 'rename',
    })

    expect(updated).toHaveLength(1)
    expect(updated[0]?.id).toBe(2)
    expect(updated[0]?.vikRequest).toBe('Заявка пользователя новая')
    expect(updated[0]?.vikRequestDate).toBe('2026-08-06')
  })
})
