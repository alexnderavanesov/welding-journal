const CHUNK_RELOAD_MARKER_PREFIX = 'welding-journal:chunk-reload:'

export function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module|loading chunk \S+ failed/i.test(message)
}

export function markChunkReloadAttempt(pathname: string, storage?: Storage) {
  try {
    // Accessing sessionStorage itself can throw in a restricted browser too.
    const target = storage ?? window.sessionStorage
    const key = getChunkReloadMarker(pathname)
    if (target.getItem(key)) return false
    target.setItem(key, '1')
    return true
  } catch {
    // Without a saved marker, another automatic attempt could reload forever.
    // Keep the error screen and its explicit retry available instead.
    return false
  }
}

export function clearChunkReloadAttempt(pathname: string, storage?: Storage) {
  try {
    (storage ?? window.sessionStorage).removeItem(getChunkReloadMarker(pathname))
  } catch { /* A stale reload marker must not break an already loaded page. */ }
}

function getChunkReloadMarker(pathname: string) {
  return `${CHUNK_RELOAD_MARKER_PREFIX}${pathname || '/'}`
}
