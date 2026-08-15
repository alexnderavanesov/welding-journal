const CHUNK_RELOAD_MARKER_PREFIX = 'welding-journal:chunk-reload:'

export function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module|loading chunk \S+ failed/i.test(message)
}

export function markChunkReloadAttempt(storage: Storage, pathname: string) {
  const key = getChunkReloadMarker(pathname)
  if (storage.getItem(key)) return false
  storage.setItem(key, '1')
  return true
}

export function clearChunkReloadAttempt(storage: Storage, pathname: string) {
  storage.removeItem(getChunkReloadMarker(pathname))
}

function getChunkReloadMarker(pathname: string) {
  return `${CHUNK_RELOAD_MARKER_PREFIX}${pathname || '/'}`
}
