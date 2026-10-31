import { lazy, Suspense, useState } from 'react'
import { Link2 } from 'lucide-react'
import { Button } from './ui/button'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import { useAccess } from '@/lib/security-context'

const ConnectionsDialog = lazy(() => import('./document-connections-dialog').then(module => ({ default: module.DocumentConnectionsDialog })))
export function DocumentConnectionsButton({ reference, disabled = false }: { reference: SystemDocumentReference | null; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const { can } = useAccess()
  if (!reference || !can('documents.view')) return null
  return <><Button variant="ghost" size="sm" className="h-8 gap-1.5 text-sky-700" disabled={disabled} onClick={() => setOpen(true)}><Link2 className="h-3.5 w-3.5" />Связи документов</Button>{open ? <Suspense fallback={null}><ConnectionsDialog key={JSON.stringify(reference)} reference={reference} onClose={() => setOpen(false)} /></Suspense> : null}</>
}
