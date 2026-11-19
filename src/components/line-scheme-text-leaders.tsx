import { memo, useId, useLayoutEffect, useRef } from 'react'
import type { SchemeAnnotation } from '@/lib/line-schemes'
import type { PdfCamera } from '@/lib/line-scheme-pdf-camera'
import { SCHEME_POINT_PREVIEW } from '@/lib/line-scheme-dimensions'

/** A shared SVG scales with the sheet; moving text updates only its own path. */
export const LineSchemeTextLeaders = memo(function LineSchemeTextLeaders({ items, camera }: { items: SchemeAnnotation[]; camera: PdfCamera }) {
  const root = useRef<SVGSVGElement>(null), prefix = useId().replace(/:/g, '')
  const leaders = items.filter(item => item.shape === 'text' && item.leaderX != null && item.leaderY != null)
  const { width, height } = camera.pageSize
  const path = (item: SchemeAnnotation, x = item.x, y = item.y) => `M ${x * width} ${y * height} L ${item.leaderX! * width} ${item.leaderY! * height}`
  useLayoutEffect(() => {
    const element = root.current, parent = element?.parentElement
    if (!element || !parent) return
    const byId = new Map(leaders.map(item => [`a:${item.id}`, item]))
    const paths = new Map([...element.querySelectorAll<SVGPathElement>('[data-scheme-leader]')].map(node => [`a:${node.dataset.schemeLeader}`, node]))
    const preview = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; x: number; y: number }>).detail, item = byId.get(detail.id)
      if (item) paths.get(detail.id)?.setAttribute('d', path(item, detail.x, detail.y))
    }
    parent.addEventListener(SCHEME_POINT_PREVIEW, preview)
    return () => parent.removeEventListener(SCHEME_POINT_PREVIEW, preview)
  }, [items, camera])
  return <svg ref={root} width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" opacity={0.4} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-visible">
    <defs>{[...new Set(leaders.map(item => item.color))].map(color => <marker key={color} id={`${prefix}-${color.slice(1)}`} markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 6 3 L 0 6 Z" fill={color} /></marker>)}</defs>
    {leaders.map(item => <path key={item.id} data-scheme-leader={item.id} d={path(item)} fill="none" stroke={item.color} strokeWidth="1" markerEnd={`url(#${prefix}-${item.color.slice(1)})`} />)}
  </svg>
})
