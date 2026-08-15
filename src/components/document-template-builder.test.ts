import { describe, expect, it } from 'vitest'

import {
  applyDocumentTemplateRepeatTarget,
  getDocumentTemplateRepeatTarget,
  includeTemplateCellInRepeatBlock,
  shouldShowDocumentTemplateRepeatControls,
  validateDocumentTemplateBuilderConfig,
} from '@/components/document-template-builder'
import type {
  DocumentTemplateConstructorConfig,
  DocumentTemplateWorkbookPreview,
} from '@/lib/document-template-storage'

const preview: DocumentTemplateWorkbookPreview = {
  sheetNames: ['Чек-лист'],
  sheetName: 'Чек-лист',
  startRow: 18,
  startColumn: 2,
  rowCount: 2,
  columnCount: 1,
  cells: [
    {
      address: 'B18',
      row: 18,
      column: 2,
      value: '',
      rowSpan: 2,
      columnSpan: 1,
      style: {},
    },
  ],
  hiddenCells: ['B19'],
  columnWidths: [18],
  rowHeights: [24, 24],
  truncated: false,
}

function createConfig(): DocumentTemplateConstructorConfig {
  return {
    version: 1,
    sheetName: 'Чек-лист',
    bindings: [
      {
        cell: 'B18',
        mode: 'row',
        parts: [{ field: 'joint' }],
      },
    ],
    nameConfig: {
      parts: [{ type: 'text', text: 'Чек-лист' }],
    },
  }
}

describe('document template builder repeat block', () => {
  it('uses the full height of a vertically merged row cell', () => {
    const config = includeTemplateCellInRepeatBlock(createConfig(), preview, 'B18')

    expect(config.repeatRow).toBe(18)
    expect(config.repeatRowEnd).toBe(19)
    expect(shouldShowDocumentTemplateRepeatControls(config, preview, 'B18')).toBe(true)
    expect(validateDocumentTemplateBuilderConfig(config, preview)).toBeNull()
  })

  it('hides repeat controls for a document summary outside the repeat block', () => {
    const config = {
      ...createConfig(),
      repeatRow: 18,
      repeatRowEnd: 19,
      bindings: [
        ...createConfig().bindings,
        { cell: 'B10', mode: 'summary' as const, parts: [{ field: 'projectTitle' as const }] },
      ],
    }

    expect(shouldShowDocumentTemplateRepeatControls(config, preview, 'B10')).toBe(false)
  })

  it('allows a document summary below the repeat block', () => {
    const config = {
      ...createConfig(),
      repeatRow: 18,
      repeatRowEnd: 19,
      bindings: [
        ...createConfig().bindings,
        { cell: 'B20', mode: 'summary' as const, parts: [{ field: 'projectTitle' as const }] },
      ],
    }

    expect(validateDocumentTemplateBuilderConfig(config, preview)).toBeNull()
  })

  it('rejects a document summary that intersects the repeat block', () => {
    const config = {
      ...createConfig(),
      repeatRow: 18,
      repeatRowEnd: 19,
      bindings: [
        ...createConfig().bindings,
        { cell: 'B19', mode: 'summary' as const, parts: [{ field: 'projectTitle' as const }] },
      ],
    }

    expect(validateDocumentTemplateBuilderConfig(config, preview)).toBe(
      'Сводные ячейки должны находиться вне повторяемого блока строк.',
    )
  })

  it('names a row cell that is outside the selected repeat block', () => {
    const config = {
      ...createConfig(),
      repeatRow: 19,
      repeatRowEnd: 19,
    }

    expect(validateDocumentTemplateBuilderConfig(config, preview)).toBe(
      'Ячейки B18 находятся вне повторяемого блока строк 19–19.',
    )
  })

  it('uses the current group for every cell in the repeated block without manual links', () => {
    const config: DocumentTemplateConstructorConfig = {
      version: 1,
      sheetName: 'Чек-лист',
      repeatRow: 18,
      repeatRowEnd: 19,
      repeatMode: 'groups',
      repeatGroupBy: 'line',
      bindings: [
        { cell: 'A18', mode: 'row', parts: [{ field: 'line' }] },
        {
          cell: 'B18',
          mode: 'summary',
          scope: 'group',
          parts: [{ field: 'joint' }],
        },
        {
          cell: 'C18',
          mode: 'summary',
          scope: 'group',
          parts: [{ field: 'checklistDocument' }],
        },
      ],
      nameConfig: {
        parts: [{ type: 'text', text: 'Чек-лист' }],
      },
    }

    expect(validateDocumentTemplateBuilderConfig(config, null)).toBeNull()
  })

  it('makes existing summary cells inside the repeat block group-aware', () => {
    const config: DocumentTemplateConstructorConfig = {
      version: 1,
      sheetName: 'Чек-лист',
      repeatRow: 18,
      repeatRowEnd: 19,
      repeatMode: 'rows',
      bindings: [
        { cell: 'A18', mode: 'row', parts: [{ field: 'line' }] },
        { cell: 'B18', mode: 'summary', parts: [{ field: 'joint' }] },
        { cell: 'A10', mode: 'summary', parts: [{ field: 'projectTitle' }] },
      ],
      nameConfig: {
        parts: [{ type: 'text', text: 'Чек-лист' }],
      },
    }

    const grouped = applyDocumentTemplateRepeatTarget(config, preview, 'line')

    expect(grouped.repeatGroupBy).toBe('line')
    expect(getDocumentTemplateRepeatTarget(grouped)).toBe('line')
    expect(grouped.bindings.find((binding) => binding.cell === 'A18')).toMatchObject({
      mode: 'summary',
      scope: 'group',
      uniqueValues: true,
      parts: [{ field: 'line' }],
    })
    expect(grouped.bindings.find((binding) => binding.cell === 'B18')).toMatchObject({
      mode: 'summary',
      scope: 'group',
    })
    expect(grouped.bindings.find((binding) => binding.cell === 'A10')).toMatchObject({
      mode: 'summary',
      scope: undefined,
    })
  })

  it('does not expose grouping by joint because it duplicates per-joint rows', () => {
    const config: DocumentTemplateConstructorConfig = {
      version: 1,
      sheetName: 'Чек-лист',
      repeatRow: 18,
      repeatRowEnd: 19,
      repeatMode: 'groups',
      repeatGroupBy: 'line',
      bindings: [
        { cell: 'A18', mode: 'row', parts: [{ field: 'line' }] },
        {
          cell: 'B18',
          mode: 'summary',
          scope: 'group',
          parts: [{ field: 'joint' }],
        },
      ],
      nameConfig: {
        parts: [{ type: 'text', text: 'Чек-лист' }],
      },
    }

    const perJoint = applyDocumentTemplateRepeatTarget(config, preview, 'joint')

    expect(perJoint.repeatMode).toBe('rows')
    expect(perJoint.repeatGroupBy).toBeUndefined()
    expect(getDocumentTemplateRepeatTarget(perJoint)).toBe('joint')
    expect(perJoint.bindings.find((binding) => binding.cell === 'B18')).toMatchObject({
      mode: 'row',
      scope: undefined,
    })
  })

  it('uses a dedicated group index and restores the ordinary index for per-joint rows', () => {
    const config: DocumentTemplateConstructorConfig = {
      version: 1,
      sheetName: 'Чек-лист',
      repeatRow: 18,
      repeatRowEnd: 19,
      repeatMode: 'rows',
      bindings: [{ cell: 'A18', mode: 'row', parts: [{ field: '__index' }] }],
    }

    const grouped = applyDocumentTemplateRepeatTarget(config, preview, 'line')
    expect(grouped.bindings[0]).toMatchObject({
      mode: 'summary',
      scope: 'group',
      parts: [{ field: '__groupIndex' }],
    })

    const perJoint = applyDocumentTemplateRepeatTarget(grouped, preview, 'joint')
    expect(perJoint.bindings[0]).toMatchObject({
      mode: 'row',
      scope: undefined,
      parts: [{ field: '__index' }],
    })
  })

  it('does not require a file-name formula for system documents', () => {
    const config = {
      ...createConfig(),
      repeatRow: 18,
      repeatRowEnd: 19,
      nameConfig: undefined,
    }

    expect(
      validateDocumentTemplateBuilderConfig(config, preview, { requireNameConfig: false }),
    ).toBeNull()
  })

  it('accepts a numeric min formula with a decimal-comma multiplier', () => {
    const config: DocumentTemplateConstructorConfig = {
      ...createConfig(),
      repeatRow: 18,
      repeatRowEnd: 19,
      bindings: [
        {
          cell: 'B18',
          mode: 'row',
          parts: [{ field: 'd1', numericOperation: 'min', compareField: 'd2', multiplier: '3,14' }],
        },
      ],
    }

    expect(validateDocumentTemplateBuilderConfig(config, preview)).toBeNull()
  })

  it('rejects an incomplete numeric formula', () => {
    const config: DocumentTemplateConstructorConfig = {
      ...createConfig(),
      repeatRow: 18,
      repeatRowEnd: 19,
      bindings: [
        {
          cell: 'B18',
          mode: 'row',
          parts: [{ field: 'd1', numericOperation: 'min', multiplier: 'три' }],
        },
      ],
    }

    expect(validateDocumentTemplateBuilderConfig(config, preview)).toBe(
      'В ячейке B18, часть 1: выберите второе числовое поле.',
    )
  })
})
