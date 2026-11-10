import { useCallback, useEffect, useRef, useState } from 'react'
import type { SchemeBundle, SchemeLease } from './line-schemes'
import { keepLineSchemeLease, openLineScheme } from '@/server/line-schemes-api'

const emptyLease: SchemeLease = { owned: false, name: null, expiresAt: null }
export const schemeError = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие.'
export type SchemeSession = ReturnType<typeof useLineSchemeSession>

/** One lease for both file management and the drawing. Serialize lifecycle
 * requests so a delayed cleanup cannot release a subsequently reacquired lease. */
export function useLineSchemeSession(lineId: number) {
  const [token] = useState(() => crypto.randomUUID())
  const [bundle, setBundle] = useState<SchemeBundle | null>(null), [lease, setLease] = useState(emptyLease)
  const [opening, setOpening] = useState(true), [error, setError] = useState('')
  const tail = useRef<Promise<unknown>>(Promise.resolve()), bundleRef = useRef(bundle)
  bundleRef.current = bundle
  const enqueue = useCallback(<T,>(task: () => Promise<T>) => {
    const result = tail.current.then(task, task); tail.current = result.catch(() => {}); return result
  }, [])
  const read = useCallback((acquire = true) => enqueue(() => openLineScheme({ data: { lineId, token, acquire }, signal: AbortSignal.timeout(15_000) })), [enqueue, lineId, token])
  const apply = useCallback((next: Awaited<ReturnType<typeof openLineScheme>>) => { bundleRef.current = next.bundle; setBundle(next.bundle); setLease(next.lease) }, [])
  useEffect(() => {
    let disposed = false, openedId: number | undefined
    setOpening(true)
    void read().then(next => { openedId = next.bundle?.id; if (!disposed) apply(next) })
      .catch(reason => { if (!disposed) setError(schemeError(reason)) }).finally(() => { if (!disposed) setOpening(false) })
    const release = () => {
      const id = openedId ?? bundleRef.current?.id
      if (id) return keepLineSchemeLease({ data: { bundleId: id, token, release: true }, fetch: (input, init) => fetch(input, { ...init, keepalive: true }) })
      return Promise.resolve(emptyLease)
    }
    const pageHide = () => { void enqueue(release).catch(() => {}) }
    // Preserve the editor's original versions on bfcache restore. Replacing
    // them here could let an old draft overwrite newer points after reacquire.
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) { setLease(emptyLease); void read(false).then(next => { if (!disposed) setLease({ ...next.lease, owned: false }) }).catch(() => {}) } }
    window.addEventListener('pagehide', pageHide); window.addEventListener('pageshow', pageShow)
    return () => { disposed = true; window.removeEventListener('pagehide', pageHide); window.removeEventListener('pageshow', pageShow); void enqueue(release).catch(() => {}) }
  }, [read, apply, enqueue, token])
  useEffect(() => {
    if (!bundle || !lease.owned) return
    let disposed = false
    const timer = setInterval(() => {
      void enqueue(() => keepLineSchemeLease({ data: { bundleId: bundle.id, token }, signal: AbortSignal.timeout(15_000) })).then(next => { if (!disposed) setLease(next) })
        .catch(() => { if (!disposed) { setLease(emptyLease); setError('Не удалось продлить доступ. Несохранённые точки остаются в окне. Нажмите «Проверить доступ» перед сохранением.') } })
    }, 30_000)
    return () => { disposed = true; clearInterval(timer) }
  }, [bundle?.id, lease.owned, enqueue, token])
  useEffect(() => {
    if (!lease.expiresAt) return
    const delay = Date.parse(lease.expiresAt) - Date.now()
    if (delay <= 0) return
    const timer = setTimeout(() => setLease(emptyLease), delay)
    return () => clearTimeout(timer)
  }, [lease])
  return { token, bundle, setBundle, lease, setLease, opening, error, setError, read, apply }
}
