let identity: string | null = null
export function setStorageIdentity(value: string | null, permissionsChanged = false) {
  if (identity && (identity !== value || permissionsChanged) && typeof window !== 'undefined') {
    try {
      const prefix = `welding-user:${identity}:`
      for (const key of Object.keys(window.localStorage)) if (key.startsWith(prefix) && !isPresentationKey(key.slice(prefix.length))) window.localStorage.removeItem(key)
      for (const key of Object.keys(window.sessionStorage)) if (key.startsWith(prefix)) window.sessionStorage.removeItem(key)
    } catch { /* Blocked storage must still permit logout. */ }
  }
  identity = value
}
// Enumerate actual presentation stores; name fragments such as "grid" or
// "state" must not accidentally preserve a future cache or draft.
const presentationKeys = new Set([
  'welding-journal-ag-grid:v1', 'lnk-ag-grid:v1', 'psto-ag-grid:v1',
  'welding-report-sort:v1', 'welding:line-program:appearance:v1',
  ...['lines', 'stamps', 'joints', 'assignments'].map(kind => `welding:line-program:grid:${kind}:v2`),
  'welding-journal:documents:history-columns', 'welding-journal:documents:parameters-collapsed',
])
const presentationPrefixes = ['welding-report-view:v1:', 'welding-tracker-collapsed-sections:', 'welding-journal:documents:grid:v1:']
const isPresentationKey = (key: string) => presentationKeys.has(key) || presentationPrefixes.some(prefix => key.startsWith(prefix))
export function scopedStorageKey(key: string) { return `welding-user:${identity ?? 'signed-out'}:${key}` }
function readLocal(key: string) {
  const saved = window.localStorage.getItem(scopedStorageKey(key))
  if (saved !== null || !identity || !isPresentationKey(key)) return saved
  // Preserve pre-account presentation preferences only; never copy selections or data caches.
  const legacy = window.localStorage.getItem(key)
  if (legacy !== null) window.localStorage.setItem(scopedStorageKey(key), legacy)
  return legacy
}
export const userStorage = {
  getItem: readLocal,
  setItem: (key: string, value: string) => window.localStorage.setItem(scopedStorageKey(key), value),
  removeItem: (key: string) => window.localStorage.removeItem(scopedStorageKey(key)),
}
export const userSessionStorage = {
  getItem: (key: string) => window.sessionStorage.getItem(scopedStorageKey(key)),
  setItem: (key: string, value: string) => window.sessionStorage.setItem(scopedStorageKey(key), value),
  removeItem: (key: string) => window.sessionStorage.removeItem(scopedStorageKey(key)),
}
