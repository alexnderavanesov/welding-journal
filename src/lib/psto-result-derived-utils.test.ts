import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getPstoResultSaveBlockReason,
  getSelectedPstoResultRows,
  hasPstoResultData,
} from '@/lib/psto-result-derived-utils'
import { createDefaultPstoResultDraft } from '@/lib/report-draft-state'
import type { SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { usePstoResultDerivedState } from '@/lib/use-psto-result-derived-state'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

describe('PSTO result request identity', () => {
  it('does not treat derived waiting statuses as stored PSTO results', () => {
    expect(hasPstoResultData({ id: 1, pstoResult: 'ожидает заявку' } as WeldRow)).toBe(false)
    expect(hasPstoResultData({ id: 2, pstoResult: 'ожидает' } as WeldRow)).toBe(false)
    expect(hasPstoResultData({ id: 3, pstoResult: 'проведено' } as WeldRow)).toBe(true)
    expect(hasPstoResultData({ id: 4, pstoResult: 'ожидает', pstoDate: '2026-08-27' } as WeldRow)).toBe(true)
    expect(hasPstoResultData({ id: 5, heatTreatmentDiagram: 'ПСТО-Д-001' } as WeldRow)).toBe(true)
  })

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

  it('accepts separate custom names filled for every diagram group', () => {
    const rows = [
      {
        id: 1,
        joint: 'F16A',
        weldDate: '2026-07-31',
        pstoRequired: 'да',
        pstoRequest: 'ПСТО-001',
        pstoRequestDate: '2026-08-01',
        pstoResult: 'ожидает ПСТО',
      },
      {
        id: 2,
        joint: 'S13',
        weldDate: '2026-07-31',
        pstoRequired: 'да',
        pstoRequest: 'ПСТО-001',
        pstoRequestDate: '2026-08-01',
        pstoResult: 'ожидает ПСТО',
      },
    ] as WeldRow[]
    const draft = {
      ...createDefaultPstoResultDraft(),
      requestName: 'ПСТО-001',
      requestDate: '2026-08-01',
      rowIds: new Set([1, 2]),
      result: 'проведено',
      pstoDate: '2026-08-25',
      diagramNaming: {
        mode: 'custom' as const,
        customName: '',
        customGroupNames: {
          first: 'Диаграмма F16A',
          second: 'Диаграмма S13',
        },
      },
    }
    const systemDocumentCreationPlan: SystemDocumentCreationPlan = {
      type: 'pstoConclusion',
      mode: 'joint',
      missingSummary: '',
      error: '',
      groups: [
        {
          key: 'first',
          label: 'Стык F16A',
          rowIds: [1],
          rows: [rows[0]],
          name: 'Диаграмма F16A',
          useSystemName: false,
          isMissingValueFallback: false,
        },
        {
          key: 'second',
          label: 'Стык S13',
          rowIds: [2],
          rows: [rows[1]],
          name: 'Диаграмма S13',
          useSystemName: false,
          isMissingValueFallback: false,
        },
      ],
    }

    expect(getPstoResultSaveBlockReason({
      draft,
      isSaving: false,
      nextDiagramName: 'ПСТО-Д-25.08.2026-001',
      selectedRows: rows,
      systemDocumentCreationPlan,
    })).toBe('')
  })

  it('keeps selected rows in the save plan when the text filter hides them', () => {
    const rows = [
      {
        id: 1,
        joint: 'F1',
        weldDate: '2026-08-01',
        pstoRequired: 'да',
        pstoRequest: 'ПСТО-001',
        pstoRequestDate: '2026-08-02',
        pstoResult: 'ожидает ПСТО',
      },
      {
        id: 2,
        joint: 'F2',
        weldDate: '2026-08-01',
        pstoRequired: 'да',
        pstoRequest: 'ПСТО-001',
        pstoRequestDate: '2026-08-02',
        pstoResult: 'ожидает ПСТО',
      },
    ] as WeldRow[]
    const draft = {
      ...createDefaultPstoResultDraft(),
      requestName: 'ПСТО-001',
      requestDate: '2026-08-02',
      search: 'F2',
      rowIds: new Set([1, 2]),
    }

    const { result } = renderHook(() => usePstoResultDerivedState({
      heatTreatmentRows: rows,
      pstoResultSelectedRows: rows,
      pstoResultRequestOptions: [],
      pstoResultRequestSearch: '',
      selectedPstoResultRequestRows: rows,
      pstoResultDraft: draft,
      nextPstoDiagramName: 'ПСТО-Д-001',
      nextPstoConclusionNumber: 1,
      requestConclusionSettings: REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      isPstoResultSaving: false,
      saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
    }))

    expect(result.current.filteredPstoResultRows.map((row) => row.id)).toEqual([2])
    expect(result.current.selectedPstoResultRows.map((row) => row.id)).toEqual([1, 2])
  })
})
