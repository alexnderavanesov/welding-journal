import { describe, expect, it, vi } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import {
  buildPositionPreview,
  normalizeLnkDocumentStageTransferReference,
  persistPrimaryStageRows,
} from '@/server/lnk-document-stage-transfer'

describe('existing rejected stage package', () => {
  const control = { id: 8, weldJointId: 1, method: 'ВИК', result: 'ремонт',
    requestName: 'ВИК до ТО', requestDate: '2026-09-10', conclusionName: 'Брак', conclusionDate: '2026-09-11' }
  const row = { id: 1, joint: 'S1', hasVik: 'да', pstoRequired: 'нет',
    preHeatTreatmentControls: [control] } as WeldRow
  const preview = (candidate: WeldRow) => buildPositionPreview({ row: candidate, control,
    position: { rowId: 1, methodCode: 'ВИК' }, sourceStage: 'beforeHeatTreatment',
    processSettings: DEFAULT_CONTROL_PROCESS_SETTINGS })

  it('allows relocating the unchanged rejected package when the resulting stage is valid', () => {
    expect(preview(row)).toMatchObject({ disabledReason: null, source: { result: 'ремонт', conclusionName: 'Брак' } })
    expect(row.preHeatTreatmentControls).toEqual([control])
  })
  it('still checks the target and other remaining rejected pre-TO methods', () => {
    expect(preview({ ...row, vikResult: 'годен' }).disabledReason).toContain('уже заполнен')
    expect(preview({ ...row, hasUzk: 'да', preHeatTreatmentControls: [control,
      { id: 9, weldJointId: 1, method: 'УЗК', result: 'вырез' }] }).disabledReason).toBeTruthy()
  })
  it('does not remove prerequisites on a line that still requires heat treatment', () => {
    expect(preview({ ...row, pstoRequired: 'да' }).disabledReason).toBeTruthy()
  })
})

describe('LNK document stage transfer request', () => {
  const reference = {
    documentId: 12,
    type: 'lnkRequest' as const,
    title: 'Заявка ВИК-12',
    date: '2026-09-19',
  }

  it('accepts positive safe document and row identifiers', () => {
    expect(normalizeLnkDocumentStageTransferReference({
      ...reference,
      positions: [{ rowId: 41, methodCode: 'ВИК' }],
    })).toEqual(expect.objectContaining({
      documentId: 12,
      positions: [{ rowId: 41, methodCode: 'ВИК' }],
    }))
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 12.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an unsafe document identifier: %s',
    (documentId) => {
      expect(() => normalizeLnkDocumentStageTransferReference({
        ...reference,
        documentId,
      })).toThrow('Некорректный системный документ ЛНК.')
    },
  )

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 41.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an unsafe weld position identifier: %s',
    (rowId) => {
      expect(() => normalizeLnkDocumentStageTransferReference({
        ...reference,
        positions: [{ rowId, methodCode: 'ВИК' }],
      })).toThrow('Некорректная позиция для переноса этапа.')
    },
  )
})

describe('LNK document stage transfer persistence', () => {
  it('updates several document rows with one batched database write', async () => {
    const rows = [
      { id: 1, joint: 'F1', vikRequest: 'Request-1', vikResult: 'waiting' },
      { id: 2, joint: 'F2', vikRequest: 'Request-1', vikResult: 'waiting' },
    ] as WeldRow[]
    const values = vi.fn()
    const returning = vi.fn(async () => rows)
    const builder = {
      values: (batch: unknown[]) => {
        values(batch)
        return builder
      },
      onConflictDoUpdate: () => builder,
      returning,
    }
    const insert = vi.fn(() => builder)

    const saved = await persistPrimaryStageRows({ insert } as never, rows)

    expect(insert).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledTimes(1)
    expect(values.mock.calls[0]?.[0]).toHaveLength(2)
    expect(returning).toHaveBeenCalledTimes(1)
    expect(saved.map((row) => row.id)).toEqual([1, 2])
  })
})
