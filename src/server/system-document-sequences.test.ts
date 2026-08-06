import { describe, expect, it } from 'vitest'

import { normalizeSystemDocumentSequenceUpdate } from '@/server/system-document-sequences'

describe('system document sequence update', () => {
  it('accepts several LNK request fields in one system request', () => {
    expect(
      normalizeSystemDocumentSequenceUpdate({
        type: 'lnkRequest',
        date: '2026-08-06',
        fieldKeys: ['vikRequest', 'rkRequest'],
        provisionalName: 'Заявка-06.08.2026-001',
      }),
    ).toEqual({
      type: 'lnkRequest',
      date: '2026-08-06',
      fieldKeys: ['vikRequest', 'rkRequest'],
      provisionalName: 'Заявка-06.08.2026-001',
    })
  })

  it('requires the matching conclusion field for the selected LNK method', () => {
    expect(() =>
      normalizeSystemDocumentSequenceUpdate({
        type: 'lnkConclusion',
        date: '2026-08-06',
        methodCode: 'РК',
        fieldKeys: ['uzkConclusion'],
        provisionalName: 'Заключение-РК-06.08.2026-001',
      }),
    ).toThrow('Не указан вид контроля заключения ЛНК.')
  })

  it('rejects an empty provisional system name', () => {
    expect(() =>
      normalizeSystemDocumentSequenceUpdate({
        type: 'pstoRequest',
        date: '2026-08-06',
        fieldKeys: ['pstoRequest'],
        provisionalName: '',
      }),
    ).toThrow('Не указано предварительное имя системного документа.')
  })
})
