import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  consumeJournalSelectionHandoff,
  createJournalSelectionHandoff,
  getJournalSelectionTokenFromUrl,
  openJournalSelectionInNewTab,
} from '@/lib/journal-selection-handoff'

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('journal selection handoff', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('passes normalized row ids once and removes the temporary payload', () => {
    const storage = createStorage()
    const token = createJournalSelectionHandoff(
      storage,
      [8, 3, 8, 0, -1, Number.NaN],
      'результата ЛНК',
      1_000,
      'selection-token',
    )

    expect(token).toBe('selection-token')
    expect(consumeJournalSelectionHandoff(storage, token!, 2_000)).toEqual({
      rowIds: [8, 3],
      sourceLabel: 'результата ЛНК',
      createdAt: 1_000,
    })
    expect(consumeJournalSelectionHandoff(storage, token!, 2_000)).toBeNull()
  })

  it('rejects an expired payload after removing it', () => {
    const storage = createStorage()
    const token = createJournalSelectionHandoff(storage, [5], 'заявки ПСТО', 1_000, 'expired-token')

    expect(consumeJournalSelectionHandoff(storage, token!, 1_000 + 10 * 60_000 + 1)).toBeNull()
    expect(consumeJournalSelectionHandoff(storage, token!, 1_001)).toBeNull()
  })

  it('reads the token without depending on an absolute browser url', () => {
    expect(getJournalSelectionTokenFromUrl('/journal?selection=abc-123')).toBe('abc-123')
    expect(getJournalSelectionTokenFromUrl('/journal')).toBe('')
  })

  it('opens the journal in a new tab and leaves an exact one-time selection behind', () => {
    const openedWindow = { opener: window } as unknown as Window
    const open = vi.spyOn(window, 'open').mockReturnValue(openedWindow)

    expect(openJournalSelectionInNewTab([9, 4, 9], 'заявки ЛНК')).toBe(true)

    const openedUrl = String(open.mock.calls[0]?.[0])
    expect(open.mock.calls[0]?.[1]).toBe('_blank')
    expect(new URL(openedUrl).pathname).toBe('/journal')
    const token = getJournalSelectionTokenFromUrl(openedUrl)
    expect(consumeJournalSelectionHandoff(window.localStorage, token)).toMatchObject({
      rowIds: [9, 4],
      sourceLabel: 'заявки ЛНК',
    })
    expect(openedWindow.opener).toBeNull()
  })

  it('fails cleanly when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    const open = vi.spyOn(window, 'open')

    expect(openJournalSelectionInNewTab([9], 'заявки ЛНК')).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})
