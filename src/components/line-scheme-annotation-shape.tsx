import { Type } from 'lucide-react'
import type { SchemeAnnotation } from '@/lib/line-schemes'

export function AnnotationShape({ item }: { item: Pick<SchemeAnnotation, 'shape' | 'color' | 'strokeWidth' | 'rotation'> }) {
  if (item.shape === 'text') return <Type size={20} color={item.color} aria-hidden="true" />
  return <svg width="100%" height="100%" viewBox="0 0 32 32" aria-hidden="true" style={{ transform: `rotate(calc(${item.rotation}deg - var(--scheme-point-rotation, 0deg)))`, overflow: 'visible' }}>
    <g stroke={item.color} strokeWidth={item.strokeWidth} fill={item.shape === 'line' ? 'none' : '#ffffffed'} strokeLinecap="round" strokeLinejoin="round">
      {item.shape === 'dot' ? <circle cx="16" cy="16" r="9" fill={item.color} /> : item.shape === 'triangle' ? <path d="M16 3 L29 27 L3 27 Z" /> : <path d="M2 16 H30" />}
    </g>
  </svg>
}
