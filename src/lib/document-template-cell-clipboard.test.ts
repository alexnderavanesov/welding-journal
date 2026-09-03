import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_TEMPLATE_CELL_CLIPBOARD_STORAGE_KEY,
  createDocumentTemplateCellClipboardPayload,
  parseDocumentTemplateCellClipboardPayload,
  readDocumentTemplateCellClipboard,
  writeDocumentTemplateCellClipboard,
} from '@/lib/document-template-cell-clipboard'
import type { DocumentTemplateCellBinding } from '@/lib/document-template-storage'

function createBinding(): DocumentTemplateCellBinding {
  return {
    cell: 'B18',
    mode: 'summary',
    parts: [
      {
        field: 'd1',
        numericOperation: 'min',
        compareField: 'd2',
        multiplier: '3,14',
        prefix: 'D=',
        suffix: ' мм',
        lineBreakAfter: true,
      },
      { field: 'joint', prefix: 'Стык ' },
    ],
    uniqueValues: false,
    separator: 'custom',
    customSeparator: ' / ',
    emptyMode: 'custom',
    emptyText: 'нет данных',
    filledMode: 'custom',
    filledText: 'заполнено',
  }
}

describe('document template cell clipboard', () => {
  it('stores the complete cell binding and returns an independent copy', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const binding = createBinding()
    const payload = createDocumentTemplateCellClipboardPayload({
      binding,
      templateId: 'weldingJournal',
      templateFileName: 'ЖСР.xlsx',
      sheetName: 'Лист 1',
    })

    expect(writeDocumentTemplateCellClipboard(storage, payload)).toBe(true)
    const restored = readDocumentTemplateCellClipboard(storage)

    expect(restored).toEqual(payload)
    expect(restored?.binding).not.toBe(binding)
    expect(restored?.binding.parts).not.toBe(binding.parts)
    expect(restored?.source).toEqual({
      templateId: 'weldingJournal',
      templateFileName: 'ЖСР.xlsx',
      sheetName: 'Лист 1',
      cell: 'B18',
    })
  })

  it('ignores malformed or outdated clipboard data', () => {
    expect(parseDocumentTemplateCellClipboardPayload(null)).toBeNull()
    expect(parseDocumentTemplateCellClipboardPayload({ version: 2 })).toBeNull()
    expect(parseDocumentTemplateCellClipboardPayload({
      version: 1,
      binding: { cell: 'B18', mode: 'unknown' },
      source: {},
    })).toBeNull()

    const storage = {
      getItem: (key: string) => key === DOCUMENT_TEMPLATE_CELL_CLIPBOARD_STORAGE_KEY ? '{broken' : null,
    }
    expect(readDocumentTemplateCellClipboard(storage)).toBeNull()
  })

  it('does not throw when browser storage is unavailable', () => {
    const unavailableStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    const payload = createDocumentTemplateCellClipboardPayload({
      binding: createBinding(),
      templateId: 'weldingJournal',
      templateFileName: 'ЖСР.xlsx',
      sheetName: 'Лист 1',
    })

    expect(readDocumentTemplateCellClipboard(unavailableStorage)).toBeNull()
    expect(writeDocumentTemplateCellClipboard(unavailableStorage, payload)).toBe(false)
  })
})
