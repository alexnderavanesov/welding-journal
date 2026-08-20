import { describe, expect, it } from 'vitest'

import {
  analyzeLnkRequestExtensionTargets,
  buildLnkRequestExtensionRows,
  getLnkRequestExtensionOptions,
  normalizeLnkRequestExtensionRequest,
} from '@/lib/lnk-request-extension'
import type { WeldRow } from '@/lib/dispatcher-types'

function weld(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    joint: 'F1',
    weldDate: '2026-08-10',
    hasVik: 'да',
    ...overrides,
  } as WeldRow
}

describe('lnk request extension', () => {
  it('keeps a request open while all of its positions are pending', () => {
    const options = getLnkRequestExtensionOptions([
      weld({ vikRequest: 'Заявка-001', vikRequestDate: '2026-08-14', vikResult: 'ожидает НК' }),
      weld({ id: 2, joint: 'F2', hasRk: 'да', rkRequest: 'Заявка-001', rkRequestDate: '2026-08-14', rkResult: 'ожидает' }),
    ])

    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({
      rowCount: 2,
      positionCount: 2,
      methodCodes: ['ВИК', 'РК'],
      disabledReason: null,
    })
    expect(options[0].searchText).toContain('f1')
  })

  it('locks the entire request after a result or conclusion appears in any position', () => {
    const [withResult] = getLnkRequestExtensionOptions([
      weld({ vikRequest: 'Заявка-001', vikRequestDate: '2026-08-14', vikResult: 'годен' }),
      weld({ id: 2, joint: 'F2', hasRk: 'да', rkRequest: 'Заявка-001', rkRequestDate: '2026-08-14', rkResult: 'ожидает НК' }),
    ])
    const [withConclusion] = getLnkRequestExtensionOptions([
      weld({ vikRequest: 'Заявка-002', vikRequestDate: '2026-08-15', vikResult: 'ожидает НК', vikConclusion: 'Заключение-1' }),
    ])

    expect(withResult.disabledReason).toContain('Заявка закрыта для дополнения')
    expect(withConclusion.disabledReason).toContain('результат или заключение')
  })

  it('accepts assigned and additional methods, and reports every ineligible position', () => {
    const analysis = analyzeLnkRequestExtensionTargets({
      rows: [
        weld(),
        weld({ id: 2, joint: 'F2', hasVik: 'дополнительный' }),
        weld({ id: 3, joint: 'F3', hasVik: 'нет' }),
        weld({ id: 4, joint: 'F4', vikRequest: 'Другая', vikRequestDate: '2026-08-12' }),
        weld({ id: 5, joint: 'F5', weldDate: '2026-08-15' }),
        weld({ id: 6, joint: 'F6', vikResult: 'годен' }),
      ],
      methodKeys: ['vikRequest'],
      requestName: 'Заявка-001',
      requestDate: '2026-08-14',
    })

    expect(analysis.targets).toEqual([
      { rowId: 1, methodKey: 'vikRequest' },
      { rowId: 2, methodKey: 'vikRequest' },
    ])
    expect(analysis.issues).toHaveLength(4)
    expect(analysis.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining([
      expect.stringContaining('«да» или «дополнительный»'),
      expect.stringContaining('другой заявке'),
      expect.stringContaining('позднее даты'),
      expect.stringContaining('результат или заключение'),
    ]))
  })

  it('distinguishes a repeated position from a position in another request', () => {
    const analysis = analyzeLnkRequestExtensionTargets({
      rows: [
        weld({ vikRequest: 'Заявка-001', vikRequestDate: '2026-08-14' }),
        weld({ id: 2, joint: 'F2', vikRequest: 'Заявка-002', vikRequestDate: '2026-08-14' }),
      ],
      methodKeys: ['vikRequest'],
      requestName: 'Заявка-001',
      requestDate: '2026-08-14',
    })

    expect(analysis.targets).toEqual([])
    expect(analysis.issues[0]?.reason).toContain('выбранную заявку')
    expect(analysis.issues[1]?.reason).toContain('другой заявке')
  })

  it('applies the existing identity and pending result without changing other fields', () => {
    const original = weld({ projectTitle: 'Проект-1' })
    const [updated] = buildLnkRequestExtensionRows({
      rows: [original],
      targets: [{ rowId: 1, methodKey: 'vikRequest' }],
      requestName: '  Заявка-001  ',
      requestDate: '14.08.2026',
    })

    expect(updated).toMatchObject({
      id: 1,
      projectTitle: 'Проект-1',
      vikRequest: 'Заявка-001',
      vikRequestDate: '2026-08-14',
      vikResult: 'ожидает НК',
    })
    expect(original.vikRequest).toBeUndefined()
  })

  it('prepares the whole set before any database update can start', () => {
    const first = weld()
    const second = weld({ id: 2, joint: 'F2', vikRequest: 'Другая', vikRequestDate: '2026-08-12' })

    expect(() => buildLnkRequestExtensionRows({
      rows: [first, second],
      targets: [
        { rowId: 1, methodKey: 'vikRequest' },
        { rowId: 2, methodKey: 'vikRequest' },
      ],
      requestName: 'Заявка-001',
      requestDate: '2026-08-14',
    })).toThrow('другой заявке')

    expect(first.vikRequest).toBeUndefined()
    expect(second.vikRequest).toBe('Другая')
  })

  it('rejects duplicate and unknown targets before the transaction starts', () => {
    expect(() => normalizeLnkRequestExtensionRequest({
      requestName: 'Заявка-001',
      requestDate: '2026-08-14',
      targets: [
        { rowId: 1, methodKey: 'vikRequest' },
        { rowId: 1, methodKey: 'vikRequest' },
      ],
    })).toThrow('повторный или некорректный')

    expect(() => normalizeLnkRequestExtensionRequest({
      requestName: 'Заявка-001',
      requestDate: '2026-08-14',
      targets: [{ rowId: 1, methodKey: 'joint' }],
    })).toThrow('повторный или некорректный')
  })
})
