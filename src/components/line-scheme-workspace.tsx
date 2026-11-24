import { lazy, Suspense, useState } from 'react'
import type { SchemeLine } from '@/lib/line-schemes'
import { useLineSchemeSession } from '@/lib/use-line-scheme-session'
import { LineSchemeOpening } from './line-scheme-navigation-guard'
import { prepareSchemeDrawing } from './line-scheme-drawing-load'

const Files = lazy(() => import('./line-scheme-files-dialog').then(module => ({ default: module.LineSchemeFilesDialog })))
const Drawing = lazy(() => import('./line-scheme-dialog').then(module => ({ default: module.LineSchemeDialog })))
export function LineSchemeWorkspace({ line, initialMode, initialFile, onClose, onOpenJoint }: {
  line: SchemeLine; initialMode: 'drawing' | 'files'; initialFile?: File; onClose: () => void; onOpenJoint?: (id: number) => void
}) {
  const session = useLineSchemeSession(line.lineId)
  const [mode, setMode] = useState(initialMode), [revisionId, setRevisionId] = useState<string | undefined>()
  const [file, setFile] = useState(initialFile)
  // Begin the access/metadata request as soon as the user opens a line, while
  // the chosen dialog loads. Suspense must stay below the session owner.
  return <Suspense fallback={<LineSchemeOpening hasSelectedFile={!!file} />}>{mode === 'files'
    ? <Files line={line} session={session} initialFile={file} onFileHandled={() => setFile(undefined)} onClose={onClose}
        onOpen={id => { prepareSchemeDrawing(); setRevisionId(id); setMode('drawing') }} />
    : <Drawing line={line} session={session} initialRevisionId={revisionId} onClose={onClose} onOpenJoint={onOpenJoint}
        onManageFiles={() => setMode('files')} />}</Suspense>
}
