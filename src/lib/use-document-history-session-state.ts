import { userSessionStorage } from '@/lib/user-storage'
import { type SetStateAction, useEffect, useState } from 'react'

const DOCUMENT_HISTORY_SESSION_STORAGE_PREFIX = 'welding-journal:documents:session:v1:'

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
      userSessionStorage.setItem(fullStorageKey, JSON.stringify(state.value))
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

function readDocumentHistorySessionValue<T extends string>(
  storageKey: string,
  defaultValue: T,
  isValid: (value: unknown) => value is T,
) {
  if (typeof window === 'undefined') return defaultValue
  try {
    const parsed: unknown = JSON.parse(userSessionStorage.getItem(storageKey) ?? 'null')
    return isValid(parsed) ? parsed : defaultValue
  } catch {
    return defaultValue
  }
}
