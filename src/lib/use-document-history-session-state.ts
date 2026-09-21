import { type SetStateAction, useEffect, useState } from 'react'

import { ALL_PAGE_SIZE, DEFAULT_PAGE_SIZE_OPTIONS } from '@/lib/use-pagination'

const DOCUMENT_HISTORY_SESSION_STORAGE_PREFIX = 'welding-journal:documents:session:v1:'

type StoredDocumentHistorySessionState = {
  selectedDocumentIds?: unknown
  pageSize?: unknown
  visibleLimit?: unknown
}

type DocumentHistorySessionState<T extends string | number> = {
  key: string
  selectedDocumentIds: Set<T>
  pageSize: number
  visibleLimit: number
}

export function useDocumentHistorySessionState<T extends string | number>(
  storageKey: string,
  parseDocumentId: (value: unknown) => T | null,
  defaultPageSize = 100,
) {
  const fullStorageKey = `${DOCUMENT_HISTORY_SESSION_STORAGE_PREFIX}${storageKey}`
  const [state, setState] = useState<DocumentHistorySessionState<T>>(() =>
    readDocumentHistorySessionState(fullStorageKey, parseDocumentId, defaultPageSize),
  )
  const currentState = state.key === fullStorageKey
    ? state
    : readDocumentHistorySessionState(fullStorageKey, parseDocumentId, defaultPageSize)

  useEffect(() => {
    setState((current) => current.key === fullStorageKey
      ? current
      : readDocumentHistorySessionState(fullStorageKey, parseDocumentId, defaultPageSize))
  }, [defaultPageSize, fullStorageKey, parseDocumentId])

  useEffect(() => {
    if (state.key !== fullStorageKey || typeof window === 'undefined') return
    try {
      window.sessionStorage.setItem(fullStorageKey, JSON.stringify({
        selectedDocumentIds: [...state.selectedDocumentIds],
        pageSize: state.pageSize,
        visibleLimit: state.visibleLimit,
      }))
    } catch {
      // The working state remains available until the current page is closed.
    }
  }, [fullStorageKey, state])

  const updateState = (
    update: (current: DocumentHistorySessionState<T>) => DocumentHistorySessionState<T>,
  ) => {
    setState((current) => update(
      current.key === fullStorageKey
        ? current
        : readDocumentHistorySessionState(fullStorageKey, parseDocumentId, defaultPageSize),
    ))
  }

  const setSelectedDocumentIds = (next: SetStateAction<Set<T>>) => {
    updateState((current) => ({
      ...current,
      selectedDocumentIds: new Set(
        typeof next === 'function' ? next(current.selectedDocumentIds) : next,
      ),
    }))
  }

  const setPageSize = (nextPageSize: number) => {
    updateState((current) => ({
      ...current,
      pageSize: normalizeDocumentHistoryPageSize(nextPageSize, defaultPageSize),
    }))
  }

  const setVisibleLimit = (next: SetStateAction<number>) => {
    updateState((current) => ({
      ...current,
      visibleLimit: normalizeDocumentHistoryVisibleLimit(
        typeof next === 'function' ? next(current.visibleLimit) : next,
        current.pageSize,
        defaultPageSize,
      ),
    }))
  }

  return {
    selectedDocumentIds: currentState.selectedDocumentIds,
    setSelectedDocumentIds,
    pageSize: currentState.pageSize,
    setPageSize,
    visibleLimit: currentState.visibleLimit,
    setVisibleLimit,
  }
}

export function useDocumentHistorySessionValue<T extends string>(
  storageKey: string,
  defaultValue: T,
  isValid: (value: unknown) => value is T,
) {
  const fullStorageKey = `${DOCUMENT_HISTORY_SESSION_STORAGE_PREFIX}${storageKey}`
  const [state, setState] = useState<{ key: string; value: T }>(() => ({
    key: fullStorageKey,
    value: readDocumentHistorySessionValue(fullStorageKey, defaultValue, isValid),
  }))
  const value = state.key === fullStorageKey
    ? state.value
    : readDocumentHistorySessionValue(fullStorageKey, defaultValue, isValid)

  useEffect(() => {
    setState((current) => current.key === fullStorageKey
      ? current
      : {
          key: fullStorageKey,
          value: readDocumentHistorySessionValue(fullStorageKey, defaultValue, isValid),
        })
  }, [defaultValue, fullStorageKey, isValid])

  useEffect(() => {
    if (state.key !== fullStorageKey || typeof window === 'undefined') return
    try {
      window.sessionStorage.setItem(fullStorageKey, JSON.stringify(state.value))
    } catch {
      // The working state remains available until the current page is closed.
    }
  }, [fullStorageKey, state])

  const setValue = (next: SetStateAction<T>) => {
    setState((current) => {
      const currentValue = current.key === fullStorageKey
        ? current.value
        : readDocumentHistorySessionValue(fullStorageKey, defaultValue, isValid)
      return {
        key: fullStorageKey,
        value: typeof next === 'function' ? next(currentValue) : next,
      }
    })
  }

  return [value, setValue] as const
}

export function parseStoredDocumentNumberId(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

export function parseStoredDocumentStringId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function readDocumentHistorySessionState<T extends string | number>(
  storageKey: string,
  parseDocumentId: (value: unknown) => T | null,
  defaultPageSize: number,
): DocumentHistorySessionState<T> {
  const fallback = {
    key: storageKey,
    selectedDocumentIds: new Set<T>(),
    pageSize: defaultPageSize,
    visibleLimit: defaultPageSize,
  }
  if (typeof window === 'undefined') return fallback

  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(storageKey) ?? '{}',
    ) as StoredDocumentHistorySessionState
    const pageSize = normalizeDocumentHistoryPageSize(parsed.pageSize, defaultPageSize)
    const usedRemovedUnlimitedPageSize = parsed.pageSize === ALL_PAGE_SIZE
    return {
      key: storageKey,
      selectedDocumentIds: new Set(
        Array.isArray(parsed.selectedDocumentIds)
          ? parsed.selectedDocumentIds.flatMap((value) => {
              const documentId = parseDocumentId(value)
              return documentId === null ? [] : [documentId]
            })
          : [],
      ),
      pageSize,
      visibleLimit: usedRemovedUnlimitedPageSize
        ? defaultPageSize
        : normalizeDocumentHistoryVisibleLimit(
            parsed.visibleLimit,
            pageSize,
            defaultPageSize,
          ),
    }
  } catch {
    return fallback
  }
}

function readDocumentHistorySessionValue<T extends string>(
  storageKey: string,
  defaultValue: T,
  isValid: (value: unknown) => value is T,
) {
  if (typeof window === 'undefined') return defaultValue
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null')
    return isValid(parsed) ? parsed : defaultValue
  } catch {
    return defaultValue
  }
}

function normalizeDocumentHistoryPageSize(value: unknown, fallback: number) {
  return typeof value === 'number' && DEFAULT_PAGE_SIZE_OPTIONS.includes(value as never)
    ? value
    : fallback
}

function normalizeDocumentHistoryVisibleLimit(value: unknown, pageSize: number, fallback: number) {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback
  return Math.max(normalized, pageSize)
}
