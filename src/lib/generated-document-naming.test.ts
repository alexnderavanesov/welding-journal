import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_FORMATION_DATE_TOKEN,
  DOCUMENT_SEQUENCE_NUMBER_TOKEN,
  previewGeneratedDocumentNamePattern,
  resolveGeneratedDocumentNamePattern,
} from '@/lib/generated-document-naming'

describe('generated document system name fields', () => {
  const formedAt = new Date('2026-08-03T09:00:00.000Z')

  it('resolves the formation date and assigned document number', () => {
    expect(
      resolveGeneratedDocumentNamePattern(
        `ЖСР №${DOCUMENT_SEQUENCE_NUMBER_TOKEN} от ${DOCUMENT_FORMATION_DATE_TOKEN}`,
        { documentNumber: 17, formedAt },
      ),
    ).toBe('ЖСР №17 от 03.08.26')
  })

  it('shows a readable preview before the server assigns the final number', () => {
    expect(
      previewGeneratedDocumentNamePattern(
        `ЖСР №${DOCUMENT_SEQUENCE_NUMBER_TOKEN} от ${DOCUMENT_FORMATION_DATE_TOKEN}`,
        formedAt,
      ),
    ).toBe('ЖСР №[Порядковый номер] от 03.08.26')
  })
})
