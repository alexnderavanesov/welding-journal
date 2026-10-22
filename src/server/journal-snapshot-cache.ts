/** Bounded, short-lived process cache. Access/revision checks belong to callers
 * and still run for every hit. Cache loss is always a normal recompute path. */
export function createJournalSnapshotCache<T>(options: { bytes: number; entries?: number; ttlMs?: number; weigh: (value: T) => number }) {
  const entries = new Map<string, { value: T; bytes: number; expires: number }>()
  const pending = new Map<string, Promise<T>>()
  let bytes = 0
  const remove = (key: string) => { const entry = entries.get(key); if (entry) { bytes -= entry.bytes; entries.delete(key) } }
  const get = (key: string): T | undefined => {
    const entry = entries.get(key)
    if (!entry) return
    if (entry.expires <= Date.now()) { remove(key); return }
    entries.delete(key); entries.set(key, entry)
    return entry.value
  }
  const put = (key: string, value: T) => {
    remove(key)
    const size = options.weigh(value)
    if (!Number.isFinite(size) || size < 0 || size > options.bytes) return
    for (const [key, entry] of entries) if (entry.expires <= Date.now()) remove(key)
    while (entries.size && (entries.size >= (options.entries ?? 16) || bytes + size > options.bytes)) remove(entries.keys().next().value!)
    entries.set(key, { value, bytes: size, expires: Date.now() + (options.ttlMs ?? 30000) }); bytes += size
  }
  return { get, put, clear() { entries.clear(); bytes = 0 }, stats: () => ({ entries: entries.size, bytes }),
    async load(key: string, compute: () => Promise<T>) {
      const hit = get(key)
      if (hit !== undefined) return hit
      const existing = pending.get(key)
      if (existing) return existing
      const promise = compute().then(value => { put(key, value); return value })
      // Bound references to in-flight requests too. Normal callers coalesce;
      // overflow retains the prior compute behavior rather than dropping work.
      if (pending.size < 32) pending.set(key, promise)
      try { return await promise } finally { if (pending.get(key) === promise) pending.delete(key) }
    },
  }
}
