import { describe, expect, it } from 'vitest'
import { assertCreationGrouping, normalizeDocumentGroupingCommand } from './document-grouping-command'

const rows = [
  { id: 1, projectTitle: 'P1', subtitleCode: 'S', line: 'L' },
  { id: 2, projectTitle: 'P2', subtitleCode: 'S', line: 'L' },
]
describe('server creation grouping command', () => {
  it.each(['project', 'subtitle', 'line'] as const)('%s never merges equal line/code labels across projects', mode => {
    expect(() => assertCreationGrouping([{ name: 'A', rows }], mode)).toThrow('не соответствует')
    expect(() => assertCreationGrouping(rows.map(row => ({ name: String(row.id), rows: [row] })), mode)).not.toThrow()
  })
  it('rejects duplicate names and positions independently of browser checks', () => {
    expect(() => assertCreationGrouping(rows.map(row => ({ name: ' Same ', rows: [row] })), 'joint')).toThrow('должны различаться')
    expect(() => assertCreationGrouping([{ name: 'A', rows }, { name: 'B', rows: [rows[0]] }], 'joint')).toThrow('несколько')
  })
  it('rejects empty and whitespace names in every group', () => {
    expect(() => assertCreationGrouping(rows.map(row => ({ name: '', rows: [row] })), 'line')).toThrow('название')
    expect(() => assertCreationGrouping(rows.map(row => ({ name: '  ', rows: [row] })), 'line')).toThrow('название')
  })
  it('does not accept missing grouping metadata as arbitrary singletons', () => {
    expect(() => assertCreationGrouping([{ name: 'A', rows: [{ id: 1, projectTitle: '', line: '' }] }], 'line')).toThrow('Заполните поля')
  })
  it('accepts only known operation modes and setting keys', () => {
    expect(normalizeDocumentGroupingCommand(undefined)).toBeUndefined()
    expect(normalizeDocumentGroupingCommand({ settingId: 'tvmtRequest', mode: 'line' })).toEqual({ settingId: 'tvmtRequest', mode: 'line' })
    expect(() => normalizeDocumentGroupingCommand({ settingId: 'injected', mode: 'line' } as never)).toThrow('Некорректный')
  })
})
