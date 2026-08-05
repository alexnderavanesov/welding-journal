import { describe, expect, it } from 'vitest'

import {
  makeUniqueDocumentNames,
  splitWeldingJournalRecords,
} from '@/lib/welding-journal-document-splitting'
import type { WeldInput } from '@/lib/weld-fields'

function row(
  projectTitle: string,
  subtitleCode: string,
  line: string,
  joint: string,
): WeldInput {
  return { projectTitle, subtitleCode, line, joint }
}

describe('welding journal document splitting', () => {
  const records = [
    row('Проект 2', '100', 'Линия 1', 'S2'),
    row('Проект 1', '200', 'Линия 2', 'S3'),
    row('Проект 1', '100', 'Линия 1', 'S1'),
    row('Проект 1', '100', 'Линия 2', 'S2'),
  ]

  it('splits by project', () => {
    expect(splitWeldingJournalRecords(records, 'project').map((group) => group.map((item) => item.joint))).toEqual([
      ['S3', 'S1', 'S2'],
      ['S2'],
    ])
  })

  it('keeps equal subtitles from different projects in separate documents', () => {
    expect(splitWeldingJournalRecords(records, 'subtitle').map((group) => group.map((item) => item.projectTitle))).toEqual([
      ['Проект 1', 'Проект 1'],
      ['Проект 1'],
      ['Проект 2'],
    ])
  })

  it('keeps equal lines from different project and subtitle combinations separate', () => {
    expect(splitWeldingJournalRecords(records, 'line')).toHaveLength(4)
  })

  it('creates one document per joint', () => {
    expect(splitWeldingJournalRecords(records, 'joint').map((group) => group[0].joint)).toEqual(['S2', 'S3', 'S1', 'S2'])
  })

  it('numbers every duplicated document name but leaves unique names unchanged', () => {
    expect(makeUniqueDocumentNames(['ЖСР F1', 'ЖСР F1', 'ЖСР F2', 'жср f1'])).toEqual([
      'ЖСР F1 (1)',
      'ЖСР F1 (2)',
      'ЖСР F2',
      'жср f1 (3)',
    ])
  })

  it('does not add duplicate suffixes when the server sequence makes names unique', () => {
    const pattern = 'ЖСР №[[DOCUMENT_SEQUENCE_NUMBER]]'
    expect(makeUniqueDocumentNames([pattern, pattern])).toEqual([pattern, pattern])
  })
})
