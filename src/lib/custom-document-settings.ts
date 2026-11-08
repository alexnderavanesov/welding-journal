import { useEffect, useState } from 'react'
import { userStorage } from '@/lib/user-storage'
import { persistProjectSettingToRemoteAndWait, PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { normalizeCustomDocumentNames, validateCustomDocumentNames, type CustomDocumentNames } from '@/lib/custom-document-types'

const STORAGE_KEY = 'welding-custom-document-names'
const EVENT = 'custom-document-names-change'

export function loadCustomDocumentNames() {
  try {
    return normalizeCustomDocumentNames(typeof window === 'undefined' ? null : JSON.parse(userStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch { return normalizeCustomDocumentNames(null) }
}

export function applyRemoteCustomDocumentNames(value: unknown) {
  if (typeof window === 'undefined') return
  userStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCustomDocumentNames(value)))
  window.dispatchEvent(new Event(EVENT))
}

export async function saveCustomDocumentNames(value: CustomDocumentNames) {
  const names = validateCustomDocumentNames(value)
  await persistProjectSettingToRemoteAndWait(PROJECT_SETTING_KEYS.customDocumentNames, names)
  applyRemoteCustomDocumentNames(names)
}

export function useCustomDocumentNames() {
  const [names, setNames] = useState(loadCustomDocumentNames)
  useEffect(() => {
    const sync = () => setNames(current => {
      const next = loadCustomDocumentNames()
      return current.custom1 === next.custom1 && current.custom2 === next.custom2 ? current : next
    })
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync) }
  }, [])
  return names
}
