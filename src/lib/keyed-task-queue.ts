export type KeyedTaskQueue<TKey> = {
  enqueue: (key: TKey, task: () => Promise<void>) => Promise<void>
}

export function createKeyedTaskQueue<TKey>(): KeyedTaskQueue<TKey> {
  const pending = new Map<TKey, Promise<void>>()

  return {
    enqueue(key, task) {
      const previous = pending.get(key) ?? Promise.resolve()
      const current = previous.catch(() => undefined).then(task)
      pending.set(key, current)

      const cleanup = () => {
        if (pending.get(key) === current) pending.delete(key)
      }
      void current.then(cleanup, cleanup)

      return current
    },
  }
}
