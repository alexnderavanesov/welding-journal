import { describe, expect, it } from 'vitest'

import {
  buildSystemDocumentSplitGroups,
  getSystemDocumentSplitMissingSummary,
  getSystemDocumentSplitSettingId,
  normalizeSystemDocumentSplitSettings,
} from '@/lib/system-document-splitting'

const rows = [
  { id: 1, projectTitle: 'А', subtitleCode: '01', line: 'L-1', joint: '1' },
  { id: 2, projectTitle: 'А', subtitleCode: '01', line: 'L-1', joint: '2' },
  { id: 3, projectTitle: 'А', subtitleCode: '02', line: 'L-1', joint: '3' },
  { id: 4, projectTitle: 'Б', subtitleCode: '01', line: 'L-1', joint: '4' },
]

describe('system document splitting', () => {
  it('keeps the current single-document behavior by default', () => {
    expect(normalizeSystemDocumentSplitSettings(undefined).lnkRequest).toBe('none')
    expect(normalizeSystemDocumentSplitSettings(undefined).tvmtRequest).toBe('none')
    expect(buildSystemDocumentSplitGroups(rows, 'none')).toHaveLength(1)
  })

  it('inherits the previous shared TVMT split rules', () => {
    const settings = normalizeSystemDocumentSplitSettings({
      lnkRequest: 'line',
      lnkConclusionOther: 'joint',
    })

    expect(settings.tvmtRequest).toBe('line')
    expect(settings.tvmtConclusion).toBe('joint')
  })

  it('uses hierarchical project, subtitle and line identities', () => {
    expect(buildSystemDocumentSplitGroups(rows, 'project')).toHaveLength(2)
    expect(buildSystemDocumentSplitGroups(rows, 'subtitle')).toHaveLength(3)
    expect(buildSystemDocumentSplitGroups(rows, 'line')).toHaveLength(3)
  })

  it('creates one document for every joint', () => {
    const groups = buildSystemDocumentSplitGroups(rows, 'joint')
    expect(groups).toHaveLength(4)
    expect(groups.map((group) => group.rowIds)).toEqual([[1], [2], [3], [4]])
  })

  it('reports every row with an incomplete grouping identity', () => {
    const groups = buildSystemDocumentSplitGroups([
      { id: 1, projectTitle: 'А', subtitleCode: '01', line: '', joint: '10' },
      { id: 2, projectTitle: 'А', subtitleCode: '01', line: '', joint: '11' },
    ], 'line')

    expect(groups).toHaveLength(2)
    expect(groups.every((group) => group.isMissingValueFallback)).toBe(true)
    expect(getSystemDocumentSplitMissingSummary(groups)).toContain('Заполните данные стыков перед сохранением документа')
  })

  it('routes every LNK conclusion form to its own setting', () => {
    expect(getSystemDocumentSplitSettingId({ type: 'lnkConclusion', methodCode: 'ВИК' })).toBe('lnkConclusionVik')
    expect(getSystemDocumentSplitSettingId({ type: 'lnkConclusion', methodCode: 'РК' })).toBe('lnkConclusionRk')
    expect(getSystemDocumentSplitSettingId({ type: 'lnkRequest', methodCode: 'ТВМТ' })).toBe('tvmtRequest')
    expect(getSystemDocumentSplitSettingId({ type: 'lnkConclusion', methodCode: 'ТВМТ' })).toBe('tvmtConclusion')
  })
})
