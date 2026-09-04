import { describe, expect, it } from 'vitest'
import {
  assertCurrentInteractiveWeldRowVersions,
  assertCurrentWeldRowVersions,
} from './weld-row-version'

describe('replace data row versions', () => {
  it('accepts an exact version for every updated or deleted row', () => {
    expect(() => assertCurrentWeldRowVersions({
      targetIds: [7, 9],
      expectedVersions: [
        { id: 7, version: '101' },
        { id: 9, version: '102' },
      ],
      currentVersions: [
        { id: 7, version: '101', line: 'Линия', joint: 'F1' },
        { id: 9, version: '102', line: 'Линия', joint: 'F2' },
      ],
    })).not.toThrow()
  })

  it('rejects missing, duplicate, malformed, and unrelated expected versions', () => {
    for (const expectedVersions of [
      [],
      [{ id: 7, version: '' }],
      [{ id: 7, version: '101' }, { id: 7, version: '101' }],
      [{ id: 8, version: '101' }],
    ]) {
      expect(() => assertCurrentWeldRowVersions({
        targetIds: [7],
        expectedVersions,
        currentVersions: [{ id: 7, version: '101' }],
      })).toThrow('свежий шаблон')
    }
  })

  it('rejects a stale row and identifies the affected weld joint', () => {
    expect(() => assertCurrentWeldRowVersions({
      targetIds: [7],
      expectedVersions: [{ id: 7, version: '100' }],
      currentVersions: [{ id: 7, version: '101', line: '330-001', joint: 'F1' }],
    })).toThrow('Стык 330-001 · F1 был изменен после скачивания Excel')
  })

  it('rejects a row deleted after the workbook was downloaded', () => {
    expect(() => assertCurrentWeldRowVersions({
      targetIds: [7],
      expectedVersions: [{ id: 7, version: '100' }],
      currentVersions: [],
    })).toThrow('больше не существуют')
  })
})

describe('interactive row versions', () => {
  it('accepts one exact version per affected weld joint', () => {
    expect(() => assertCurrentInteractiveWeldRowVersions({
      targetIds: [7, 9],
      expectedVersions: [
        { id: 7, version: '101' },
        { id: 9, version: '102' },
      ],
      currentVersions: [
        { id: 7, version: '101' },
        { id: 9, version: '102' },
      ],
    })).not.toThrow()
  })

  it('rejects a stale screen without partially saving a batch', () => {
    expect(() => assertCurrentInteractiveWeldRowVersions({
      targetIds: [7, 9],
      expectedVersions: [
        { id: 7, version: 'old' },
        { id: 9, version: '102' },
      ],
      currentVersions: [
        { id: 7, version: 'new', line: '330-001', joint: 'F1' },
        { id: 9, version: '102', line: '330-001', joint: 'F2' },
      ],
    })).toThrow('Стык 330-001 · F1 уже изменен другим пользователем')
  })

  it('rejects requests without a complete version set', () => {
    expect(() => assertCurrentInteractiveWeldRowVersions({
      targetIds: [7],
      expectedVersions: [],
      currentVersions: [{ id: 7, version: '101' }],
    })).toThrow('Открытые данные устарели')
  })
})
