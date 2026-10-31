import { lazy, Suspense, useEffect, useState } from 'react'
import { useAccess } from '@/lib/security-context'
import { DOCUMENT_SAVE_RECOVERY_EVENT, type PendingDocumentSave } from '@/lib/document-save-recovery'
import { readPendingDocumentSaves } from '@/lib/run-document-save'

const RecoveryDialog = lazy(() => import('./document-save-recovery-dialog').then(module => ({ default: module.DocumentSaveRecoveryDialog })))
export function DocumentSaveRecovery() {
  const { identity } = useAccess()
  const [pending, setPending] = useState<PendingDocumentSave[]>([])
  useEffect(() => {
    const update = () => setPending(identity ? readPendingDocumentSaves() : [])
    update()
    window.addEventListener(DOCUMENT_SAVE_RECOVERY_EVENT, update)
    return () => window.removeEventListener(DOCUMENT_SAVE_RECOVERY_EVENT, update)
  }, [identity?.id, identity?.revision])
  return identity && pending[0] ? <Suspense fallback={null}><RecoveryDialog key={pending[0].id} pending={pending[0]} /></Suspense> : null
}
