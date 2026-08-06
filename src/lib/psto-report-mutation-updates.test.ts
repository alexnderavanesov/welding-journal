import { describe, expect, it } from 'vitest'

import {
  buildPstoRequestManagerRows,
  buildPstoResultCorrectionRow,
} from '@/lib/psto-report-mutation-updates'
import type { RowWithId } from '@/lib/psto-report-mutation-types'

describe('buildPstoResultCorrectionRow', () => {
  it('keeps the PSTO date separate when renaming a custom diagram', () => {
    const updated = buildPstoResultCorrectionRow({
      record: {
        id: 1,
        pstoDate: '2026-07-21',
        heatTreatmentDiagram: 'Диаграмма-001',
      } as RowWithId,
      action: 'renameDiagram',
      diagramName: '  Диаграмма №77  ',
    })

    expect(updated.pstoDate).toBe('2026-07-21')
    expect(updated.heatTreatmentDiagram).toBe('Диаграмма №77')
  })

  it('renames only the PSTO request with the matching name and date', () => {
    const rows = [
      {
        id: 1,
        pstoRequest: 'Заявка пользователя',
        pstoRequestDate: '2026-07-21',
      },
      {
        id: 2,
        pstoRequest: 'Заявка пользователя',
        pstoRequestDate: '2026-08-06',
      },
    ] as RowWithId[]

    const updated = buildPstoRequestManagerRows({
      heatTreatmentRows: rows,
      requestName: 'Заявка пользователя',
      requestDate: '2026-08-06',
      nextRequestName: 'Заявка пользователя новая',
      action: 'rename',
    })

    expect(updated).toHaveLength(1)
    expect(updated[0]?.id).toBe(2)
    expect(updated[0]?.pstoRequest).toBe('Заявка пользователя новая')
    expect(updated[0]?.pstoRequestDate).toBe('2026-08-06')
  })
})
