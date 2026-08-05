import { describe, expect, it } from 'vitest'

import {
  buildSystemNameFromPattern,
  parseRequestNamingPattern,
  REQUEST_CONCLUSION_DEFAULT_SETTINGS,
  serializeRequestNamingPattern,
} from '@/lib/request-conclusion-settings'
import { formatLnkConclusionName } from '@/lib/report-conclusion-naming'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('request and conclusion naming settings', () => {
  it('numbers new system names by the current pattern without renaming old names', () => {
    const name = buildSystemNameFromPattern(
      'ЛНК-{{ДатаКороткая}}-{{№}}',
      { date: new Date('2026-07-10T00:00:00') },
      ['Заявка-10.07.2026-001', 'ЛНК-10.07.26-001'],
    )

    expect(name).toBe('ЛНК-10.07.26-002')
  })

  it('uses custom LNK conclusion pattern for newly generated names only', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      lnkConclusion: {
        defaultMode: 'system' as const,
        systemPattern: 'Закл-{{Метод}}-{{ДатаКороткая}}-{{№}}',
      },
    }
    const rows = [
      { id: 1, rkConclusion: 'Заключение-РК-10.07.2026-001' },
      { id: 2, rkConclusion: 'Закл-РК-10.07.26-001' },
    ] as WeldRow[]

    expect(formatLnkConclusionName(rows, '2026-07-10', 'rkRequest', settings)).toBe('Закл-РК-10.07.26-002')
  })

  it('round-trips a visual naming formula without changing its behavior', () => {
    const pattern = 'Заключение-{{Метод}}-{{Дата}}-{{№}}'
    const parts = parseRequestNamingPattern(pattern)

    expect(parts).toEqual([
      { type: 'text', value: 'Заключение-' },
      { type: 'field', field: 'method' },
      { type: 'text', value: '-' },
      { type: 'field', field: 'date' },
      { type: 'text', value: '-' },
      { type: 'field', field: 'number' },
    ])
    expect(serializeRequestNamingPattern(parts)).toBe(pattern)
  })

  it('preserves unknown legacy tokens as text in the visual constructor', () => {
    const pattern = 'Документ-{{СтароеПоле}}-{{Дата}}'

    expect(serializeRequestNamingPattern(parseRequestNamingPattern(pattern))).toBe(pattern)
  })
})
