import { lazy, Suspense, useState } from 'react'
import type { SchemeLine } from '@/lib/line-schemes'
import { useLineSchemeSession } from '@/lib/use-line-scheme-session'
import { LineSchemeFilesDialog } from './line-scheme-files-dialog'

const Drawing = lazy(() => import('./line-scheme-dialog').then(module => ({ default: module.LineSchemeDialog })))
export function LineSchemeWorkspace({ line, initialMode, initialFile, onClose, onOpenJoint }: {
  line: SchemeLine; initialMode: 'drawing' | 'files'; initialFile?: File; onClose: () => void; onOpenJoint?: (id: number) => void
}) {
  const session = useLineSchemeSession(line.lineId)
  const [mode, setMode] = useState(initialMode), [revisionId, setRevisionId] = useState<string | undefined>()
  const [file, setFile] = useState(initialFile)
  return mode === 'files'
    ? <LineSchemeFilesDialog line={line} session={session} initialFile={file} onFileHandled={() => setFile(undefined)} onClose={onClose}
        onOpen={id => { setRevisionId(id); setMode('drawing') }} />
    : <Suspense fallback={<p role="status">Открываем окно схемы…</p>}><Drawing line={line} session={session} initialRevisionId={revisionId} onClose={onClose} onOpenJoint={onOpenJoint}
        onManageFiles={() => setMode('files')} /></Suspense>
}
