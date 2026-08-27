const JOURNAL_SELECTION_STORAGE_PREFIX = 'welding-journal:journal-selection:'
const JOURNAL_SELECTION_QUERY_KEY = 'selection'
const JOURNAL_SELECTION_TTL_MS = 10 * 60_000

export type JournalSelectionHandoff = {
  rowIds: number[]
  sourceLabel: string
  createdAt: number
}

type StorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

export function createJournalSelectionHandoff(
  storage: StorageLike,
  rowIds: readonly number[],
  sourceLabel: string,
  now = Date.now(),
  token = createJournalSelectionToken(),
) {
  const uniqueRowIds = normalizeRowIds(rowIds)
  if (uniqueRowIds.length === 0) return null
  storage.setItem(getJournalSelectionStorageKey(token), JSON.stringify({
    rowIds: uniqueRowIds,
    sourceLabel: sourceLabel.trim() || 'модального окна',
    createdAt: now,
  } satisfies JournalSelectionHandoff))
  return token
}

export function consumeJournalSelectionHandoff(
  storage: StorageLike,
  token: string,
  now = Date.now(),
) {
  const normalizedToken = token.trim()
  if (!normalizedToken) return null
  const storageKey = getJournalSelectionStorageKey(normalizedToken)
  const rawValue = storage.getItem(storageKey)
  storage.removeItem(storageKey)
  if (!rawValue) return null

  try {
    const parsed = JSON.parse(rawValue) as Partial<JournalSelectionHandoff>
    const rowIds = normalizeRowIds(Array.isArray(parsed.rowIds) ? parsed.rowIds : [])
    const createdAt = Number(parsed.createdAt)
    if (rowIds.length === 0 || !Number.isFinite(createdAt) || now - createdAt > JOURNAL_SELECTION_TTL_MS) return null
    return {
      rowIds,
      sourceLabel: String(parsed.sourceLabel ?? '').trim() || 'модального окна',
      createdAt,
    } satisfies JournalSelectionHandoff
  } catch {
    return null
  }
}

export function openJournalSelectionInNewTab(rowIds: readonly number[], sourceLabel: string) {
  if (typeof window === 'undefined') return false
  let token: string | null
  try {
    token = createJournalSelectionHandoff(window.localStorage, rowIds, sourceLabel)
  } catch {
    return false
  }
  if (!token) return false

  const url = new URL('/journal', window.location.origin)
  url.searchParams.set(JOURNAL_SELECTION_QUERY_KEY, token)
  let openedWindow: Window | null
  try {
    openedWindow = window.open(url.toString(), '_blank')
  } catch {
    openedWindow = null
  }
  if (!openedWindow) {
    try {
      window.localStorage.removeItem(getJournalSelectionStorageKey(token))
    } catch {
      // The transfer will expire even if browser storage cannot be cleaned immediately.
    }
    return false
  }
  try {
    openedWindow.opener = null
  } catch {
    // Some browsers already isolate newly opened tabs.
  }
  return true
}

export function getJournalSelectionTokenFromUrl(href: string) {
  try {
    return new URL(href, 'http://localhost').searchParams.get(JOURNAL_SELECTION_QUERY_KEY)?.trim() || ''
  } catch {
    return ''
  }
}

export function removeJournalSelectionTokenFromCurrentUrl() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has(JOURNAL_SELECTION_QUERY_KEY)) return
  url.searchParams.delete(JOURNAL_SELECTION_QUERY_KEY)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

function getJournalSelectionStorageKey(token: string) {
  return `${JOURNAL_SELECTION_STORAGE_PREFIX}${token}`
}

function createJournalSelectionToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizeRowIds(rowIds: readonly unknown[]) {
  return Array.from(new Set(rowIds.map(Number).filter((rowId) => Number.isInteger(rowId) && rowId > 0)))
}
