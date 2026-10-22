/** Small, revision-scoped counts only. Never retain joint cards or selections. */
export function createJournalCountCache(limit = 64) {
  const entries = new Map<string, Promise<number>>()
  return (key: string, compute: () => Promise<number>) => {
    const cached = entries.get(key)
    if (cached) return cached
    const pending = compute()
    entries.set(key, pending)
    while (entries.size > limit) entries.delete(entries.keys().next().value!)
    void pending.catch(() => { if (entries.get(key) === pending) entries.delete(key) })
    return pending
  }
}
