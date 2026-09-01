import { describe, expect, it } from 'vitest'

import {
  buildSystemNameFromPattern,
  buildSystemNameWithNumber,
  extractSystemNameNumber,
  getRequestConclusionNamingKind,
  hasSystemDocumentNumberField,
  loadRequestConclusionSettings,
  normalizeRequestConclusionSettings,
  parseRequestNamingPattern,
  REQUEST_CONCLUSION_DEFAULT_SETTINGS,
  saveRequestConclusionSettings,
  serializeRequestNamingPattern,
} from '@/lib/request-conclusion-settings'
import { formatLnkConclusionName } from '@/lib/report-conclusion-naming'
import { formatLnkRequestName } from '@/lib/report-request-naming'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('request and conclusion naming settings', () => {
  it('uses independent naming kinds for TVMT documents', () => {
    expect(getRequestConclusionNamingKind({ type: 'lnkRequest', methodCode: 'ТВМТ' })).toBe('tvmtRequest')
    expect(getRequestConclusionNamingKind({ type: 'lnkConclusion', methodCode: 'ТВМТ' })).toBe('tvmtConclusion')
    expect(getRequestConclusionNamingKind({ type: 'lnkConclusion', methodCode: 'РК' })).toBe('lnkConclusion')
  })

  it('inherits the previous shared LNK formulas when TVMT settings are missing', () => {
    const settings = normalizeRequestConclusionSettings({
      lnkRequest: {
        defaultMode: 'custom',
        systemPattern: 'Старая-заявка-{{№}}',
      },
      lnkConclusion: {
        defaultMode: 'system',
        systemPattern: 'Старое-заключение-{{№}}',
      },
    })

    expect(settings.tvmtRequest).toMatchObject({
      defaultMode: 'custom',
      systemPattern: 'Старая-заявка-{{№}}',
    })
    expect(settings.tvmtConclusion.systemPattern).toBe('Старое-заключение-{{№}}')
  })

  it('uses ZNK in the default LNK conclusion name while recognizing the previous default', () => {
    expect(REQUEST_CONCLUSION_DEFAULT_SETTINGS.lnkConclusion).toEqual({
      defaultMode: 'system',
      systemPattern: 'ЗНК-{{Метод}}-{{Дата}}-{{№}}',
      systemPatternHistory: ['Заключение-{{Метод}}-{{Дата}}-{{№}}'],
    })
    expect(formatLnkConclusionName([], '2026-08-25', 'vikRequest', REQUEST_CONCLUSION_DEFAULT_SETTINGS, 1))
      .toBe('ЗНК-ВИК-25.08.2026-001')
  })

  it('keeps the previous built-in conclusion pattern with a saved custom rule', () => {
    const settings = normalizeRequestConclusionSettings({
      lnkConclusion: {
        defaultMode: 'system',
        systemPattern: 'Акт-{{Метод}}-{{№}}',
      },
    })

    expect(settings.lnkConclusion.systemPatternHistory).toContain(
      'Заключение-{{Метод}}-{{Дата}}-{{№}}',
    )
  })

  it('numbers new system names by the current pattern without renaming old names', () => {
    const name = buildSystemNameFromPattern(
      'ЛНК-{{ДатаКороткая}}-{{№}}',
      { date: new Date('2026-07-10T00:00:00') },
      ['Заявка-10.07.2026-001', 'ЛНК-10.07.26-001'],
    )

    expect(name).toBe('ЛНК-10.07.26-002')
  })

  it('renders the exact number reserved by the shared system document counter', () => {
    expect(
      buildSystemNameWithNumber(
        'Заявка-{{Дата}}-{{№}}',
        { date: new Date('2026-08-06T00:00:00') },
        17,
      ),
    ).toBe('Заявка-06.08.2026-017')
  })

  it('requires a sequential number in every system naming rule', () => {
    expect(hasSystemDocumentNumberField('Заявка - {{Проект}} - {{№}}')).toBe(true)
    expect(hasSystemDocumentNumberField('Заявка - {{Проект}} - {{Номер}}')).toBe(true)
    expect(hasSystemDocumentNumberField('Заявка - {{Проект}}')).toBe(false)
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

  it('does not build an LNK conclusion name before a control method is selected', () => {
    expect(formatLnkConclusionName([], '2026-08-25', '', REQUEST_CONCLUSION_DEFAULT_SETTINGS, 1)).toBe('')
  })

  it('extracts the same padded sequence number from a configured system name', () => {
    expect(
      extractSystemNameNumber(
        'Закл-{{№}}-{{Метод}}-{{ДатаКороткая}}',
        { date: new Date('2026-07-10T00:00:00'), methodCode: 'РК' },
        'Закл-007-РК-10.07.26',
      ),
    ).toBe('007')
  })

  it('builds a system name from unique projects, subtitles and lines of selected rows', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      lnkRequest: {
        defaultMode: 'system' as const,
        systemPattern: '{{Проект}} - {{Шифр}} - {{Линия}} - {{№}}',
      },
    }
    const rows = [
      { id: 1, projectTitle: 'Риформинг', subtitleCode: '500', line: 'LIN-002' },
      { id: 2, projectTitle: 'Риформинг', subtitleCode: '400', line: 'LIN-001' },
      { id: 3, projectTitle: 'Киселевское', subtitleCode: '400', line: 'LIN-001' },
    ] as WeldRow[]

    expect(formatLnkRequestName(rows, settings, '2026-08-06', 7)).toBe(
      'Киселевское, Риформинг - 400, 500 - LIN-001, LIN-002 - 007',
    )
  })

  it('extracts a document number when a saved name contains row fields', () => {
    expect(
      extractSystemNameNumber(
        '{{Проект}}-{{Шифр}}-{{Линия}}-{{№}}',
        { date: new Date('2026-08-06T00:00:00') },
        'Риформинг-400-LIN-001-027',
      ),
    ).toBe('027')
  })

  it('uses the known row value when it is adjacent to the document number', () => {
    expect(
      extractSystemNameNumber(
        '{{Шифр}}{{№}}',
        { date: new Date('2026-08-06T00:00:00'), subtitleCode: '400' },
        '400027',
      ),
    ).toBe('027')
  })

  it('does not invent a sequence number for a custom document name', () => {
    expect(
      extractSystemNameNumber(
        'Заявка-{{Дата}}-{{№}}',
        { date: new Date('2026-07-10T00:00:00') },
        'Заявка №3434 от 10.07.2026',
      ),
    ).toBe('')
  })

  it('normalizes and preserves earlier system naming patterns', () => {
    const settings = normalizeRequestConclusionSettings({
      lnkRequest: {
        defaultMode: 'system',
        systemPattern: 'Заявка №{{№}}',
        systemPatternHistory: [
          'Заявка-{{Дата}}-{{№}}',
          'Заявка-{{Дата}}-{{№}}',
          'Заявка №{{№}}',
        ],
      },
    })

    expect(settings.lnkRequest.systemPatternHistory).toEqual([
      'Заявка-{{Дата}}-{{№}}',
    ])
    expect(settings.splitModes).toEqual(REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes)
  })

  it('remembers the previous formula when the system naming rule is saved', () => {
    window.localStorage.clear()
    saveRequestConclusionSettings(REQUEST_CONCLUSION_DEFAULT_SETTINGS, { syncRemote: false })
    saveRequestConclusionSettings(
      {
        ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
        lnkRequest: {
          defaultMode: 'system',
          systemPattern: 'Заявка НК №{{Шифр}}-{{№}}3333333',
        },
      },
      { syncRemote: false },
    )

    expect(loadRequestConclusionSettings().lnkRequest.systemPatternHistory).toContain(
      REQUEST_CONCLUSION_DEFAULT_SETTINGS.lnkRequest.systemPattern,
    )
    window.localStorage.clear()
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

  it('round-trips project, subtitle and line fields in the visual constructor', () => {
    const pattern = '{{Проект}}-{{Шифр}}-{{Линия}}'

    expect(serializeRequestNamingPattern(parseRequestNamingPattern(pattern))).toBe(pattern)
  })

  it('preserves unknown legacy tokens as text in the visual constructor', () => {
    const pattern = 'Документ-{{СтароеПоле}}-{{Дата}}'

    expect(serializeRequestNamingPattern(parseRequestNamingPattern(pattern))).toBe(pattern)
  })
})
