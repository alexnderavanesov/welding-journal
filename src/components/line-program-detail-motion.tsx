import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { GridApi, ICellRendererParams, IRowNode } from 'ag-grid-community'

const DURATION = 200
type Motion = { open: boolean; move: (open: boolean) => void; dispose: () => void }

/** Animate the measured detail, not the grid's transforms. AG's auto-height
 * observer moves following rows with it, while fixed nested headers keep the
 * window as their containing block. Cached details and their drafts survive.
 */
export function useProgramDetailMotion<T>(current: RefObject<{
  detailRenderer?: (props: ICellRendererParams<T>) => ReactNode
  isExpanded?: (row: T) => boolean
}>) {
  const handles = useRef(new Map<IRowNode<T>, Motion>())
  const opening = useRef(new Set<IRowNode<T>>())
  const [details, setDetails] = useState(new Map<string, { host: HTMLDivElement; params: ICellRendererParams<T> }>())
  const attach = useCallback((host: HTMLDivElement, params: ICellRendererParams<T>) => {
    const id = params.node.id!
    setDetails(previous => {
      const entry = previous.get(id)
      if (entry?.host === host && entry.params.node === params.node && entry.params.api === params.api && entry.params.data === params.data) return previous
      return new Map(previous).set(id, { host, params })
    })
    return () => queueMicrotask(() => {
      // React 19 replays refs/effects when AG moves a retained detail to/from
      // its cache. The DOM host survives that move; only real eviction removes
      // its portal. A replacement host for the same row must survive too.
      if (host.isConnected) return
      setDetails(previous => {
        if (previous.get(id)?.host !== host) return previous
        const next = new Map(previous); next.delete(id); return next
      })
    })
  }, [])
  const renderer = useMemo(() => function ProgramDetailHost(params: ICellRendererParams<T>) {
    const host = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => attach(host.current!, params), [params.node, params.api, params.data])
    return <div ref={host} className="program-detail-host" />
  }, [attach])
  const Content = useMemo(() => function ProgramDetailMotion(params: ICellRendererParams<T>) {
    const shell = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
      const outer = shell.current!, inner = content.current!, master = params.node.parent!
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
      let frame = 0, timer = 0, target = 0, running = false, deadline = 0
      const cancel = () => { cancelAnimationFrame(frame); window.clearTimeout(timer); frame = timer = 0 }
      const visible = () => outer.isConnected && !!outer.getClientRects().length && !outer.closest('[hidden]')
      const finish = () => {
        cancel(); running = false
        outer.style.transition = ''; delete outer.dataset.programMotion
        if (motion.open) { outer.style.height = ''; outer.inert = false }
        else {
          outer.style.height = '1px'
          if (!params.api.isDestroyed() && master.expanded) master.setExpanded(false, undefined, true)
        }
      }
      const resize = () => {
        if (!running || !motion.open || !visible()) return
        const next = Math.max(1, inner.getBoundingClientRect().height)
        if (Math.abs(next - target) < 0.5) return
        if (!deadline) return // the first animation frame establishes the target
        const remaining = deadline - performance.now()
        if (remaining <= 0) { finish(); return }
        target = next
        outer.style.transition = `height ${remaining}ms cubic-bezier(.2, .7, .2, 1)`
        outer.style.height = `${next}px`
      }
      const desiredOpen = master.data ? !!current.current.isExpanded?.(master.data) : master.expanded
      const motion: Motion = {
        open: desiredOpen,
        move(open) {
          cancel(); motion.open = open; deadline = 0
          // Freeze the current interpolated height before reversing direction.
          const height = outer.getBoundingClientRect().height
          outer.style.transition = 'none'; outer.style.height = `${Math.max(1, height)}px`
          outer.inert = !open
          running = true; outer.dataset.programMotion = open ? 'opening' : 'closing'
          frame = requestAnimationFrame(() => {
            frame = 0
            if (reduced.matches || !visible()) { finish(); return }
            // Establish the start height even for a just-mounted/cached detail.
            void outer.offsetHeight
            target = open ? Math.max(1, inner.getBoundingClientRect().height) : 1
            deadline = performance.now() + DURATION
            outer.style.transition = `height ${DURATION}ms cubic-bezier(.2, .7, .2, 1)`
            outer.style.height = `${target}px`
            timer = window.setTimeout(finish, DURATION + 40)
          })
        },
        dispose() { cancel(); observer.disconnect(); outer.removeEventListener('transitionend', onEnd); reduced.removeEventListener('change', onPreference) },
      }
      const onEnd = (event: TransitionEvent) => {
        if (event.target === outer && event.propertyName === 'height' && Math.abs(outer.getBoundingClientRect().height - target) < 1) finish()
      }
      const onPreference = () => { if (reduced.matches && running) finish() }
      const observer = new ResizeObserver(resize)
      observer.observe(inner)
      outer.addEventListener('transitionend', onEnd); reduced.addEventListener('change', onPreference)
      handles.current.set(master, motion)
      // Cached closed details can replay their effects too. Retain the actual
      // desired state, including a completed close, instead of assuming open.
      const firstOpen = opening.current.delete(master), resume = !!outer.dataset.programMotion
      if (firstOpen || resume || desiredOpen && outer.inert) {
        if (firstOpen && !resume) outer.style.height = '1px'
        motion.move(desiredOpen)
      }
      return () => { motion.dispose(); if (handles.current.get(master) === motion) handles.current.delete(master) }
    }, [params.node, params.api])
    const Detail = current.current.detailRenderer!
    return <div ref={shell} className="program-detail-motion"><div ref={content} className="program-detail-content"><Detail {...params} /></div></div>
  }, [current])

  // Each renderer owns its resources. A parent passive cleanup would run after
  // fresh child layout effects during replay and cancel their new animations.
  const synchronize = (api: GridApi<T>) => {
    if (!current.current.isExpanded || api.isDestroyed()) return
    api.forEachNode(node => {
      if (!node.data || node.group || node.detail) return
      const open = current.current.isExpanded!(node.data), motion = handles.current.get(node)
      if (!open) opening.current.delete(node)
      if (open && !node.expanded) {
        opening.current.add(node)
        node.setExpanded(true, undefined, true)
        // Attaching a cached row may replace its layout-effect handler.
        const attached = handles.current.get(node)
        if (attached) {
          opening.current.delete(node)
          if (!attached.open) attached.move(true)
        }
      } else if (motion && motion.open !== open) motion.move(open)
      else if (!open && node.expanded && !motion) node.setExpanded(false, undefined, true)
    })
  }
  // Keep the portal fibers outside AG's moving RowComp subtree. Otherwise its
  // StrictMode replay destroys and recreates every nested grid on disclosure.
  const portals = [...details].map(([id, { host, params }]) => createPortal(<Content {...params} />, host, id))
  return { renderer, synchronize, portals }
}
