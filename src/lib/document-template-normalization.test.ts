import { describe, expect, it } from 'vitest'

import { normalizeDocumentTemplateConstructorConfig } from '@/lib/document-template-storage'

describe('document template normalization without an Excel workbook', () => {
  it('normalizes group bindings before the lazy Excel module is loaded', () => {
    expect(
      normalizeDocumentTemplateConstructorConfig({
        version: 1,
        sheetName: 'Лист1',
        repeatRow: 5,
        repeatRowEnd: 6,
        repeatMode: 'groups',
        repeatGroupBy: 'line',
        bindings: [
          {
            cell: 'B5',
            mode: 'summary',
            scope: 'group',
            parts: [{ field: 'joint' }],
          },
        ],
      }),
    ).toMatchObject({
      repeatRow: 5,
      repeatRowEnd: 6,
      repeatMode: 'groups',
      repeatGroupBy: 'line',
      bindings: [
        {
          cell: 'B5',
          mode: 'summary',
          scope: 'group',
        },
      ],
    })
  })
})
