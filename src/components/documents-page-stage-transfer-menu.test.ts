import { describe, expect, it } from 'vitest'

import { canShowSystemDocumentStageTransfer } from '@/components/documents-page'
import type { SystemDocumentSummary } from '@/lib/system-document-types'

describe('canShowSystemDocumentStageTransfer', () => {
  it('offers stage transfer for a single eligible LNK document', () => {
    expect(canShowSystemDocumentStageTransfer({
      documentRecord: summary({ methodCodes: ['ВИК', 'РК'] }),
      processEnabled: true,
      isBulkSelectionContext: false,
    })).toBe(true)
  })

  it('hides stage transfer when context menu represents multiple selected documents', () => {
    expect(canShowSystemDocumentStageTransfer({
      documentRecord: summary({ methodCodes: ['ВИК'] }),
      processEnabled: true,
      isBulkSelectionContext: true,
    })).toBe(false)
  })

  it('hides stage transfer when the process is disabled or the document is ineligible', () => {
    expect(canShowSystemDocumentStageTransfer({
      documentRecord: summary({ methodCodes: ['ПВК'] }),
      processEnabled: false,
      isBulkSelectionContext: false,
    })).toBe(false)
    expect(canShowSystemDocumentStageTransfer({
      documentRecord: summary({ sourceKind: 'pstoCycle', methodCodes: ['ТВМТ'] }),
      processEnabled: true,
      isBulkSelectionContext: false,
    })).toBe(false)
  })
})

function summary(overrides: Partial<SystemDocumentSummary>): SystemDocumentSummary {
  return {
    id: 'document-1',
    documentId: 1,
    type: 'lnkConclusion',
    label: 'Заключение ЛНК',
    title: 'Заключение ВИК-1',
    fileName: 'Заключение ВИК-1.xlsx',
    date: '2026-09-03',
    methodCodes: [],
    rowIds: [1],
    rowCount: 1,
    positionCount: 1,
    projects: ['Риформинг'],
    subtitleCodes: ['73281024/4152-330-ТКМ5'],
    lines: ['222bto'],
    periodFrom: '2026-09-03',
    periodTo: '2026-09-03',
    updatedAt: '2026-09-03T00:00:00.000Z',
    ...overrides,
  }
}
