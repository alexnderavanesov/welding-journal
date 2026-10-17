import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, ChevronDown, FileText, Pencil, UserRound, UsersRound } from 'lucide-react'
import { assignDocumentSpecialists } from '@/server/specialists'
import { getSpecialistDocumentProfile, type DocumentSpecialists, type SpecialistSelection } from '@/lib/document-specialists'
import { useSecurityGuard } from '@/lib/security-context'
import { GENERATED_DOCUMENT_HISTORY_QUERY_KEY } from '@/lib/weld-query-utils'
import { DialogHeader } from './dialog-header'
import { FieldHelp } from './field-help'
import { SpecialistDialogShell } from './specialist-dialog-shell'
import { SpecialistSelect, useSpecialistOptions } from './specialist-select'
import { Button } from './ui/button'

export type SpecialistDocument = {
  id: number | string; documentId?: number; type: string; methodCode?: string; title: string; updatedAt: string
  specialists?: DocumentSpecialists | null; specialistsRevision?: number
  documentVersion?: string
}

export function DocumentSpecialistCell({ document, role, onEdit }: { document: SpecialistDocument; role: keyof SpecialistSelection; onEdit?: (document: SpecialistDocument, role: keyof SpecialistSelection) => void }) {
  const [editing, setEditing] = useState<SpecialistDocument | null>(null)
  const snapshot = document.specialists?.[role]
  const label = getSpecialistDocumentProfile(document.type, document.methodCode)?.labels[role === 'first' ? 0 : 1]
  return <div className="min-w-0 text-xs">
    <button type="button" className="group flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-slate-600 transition-colors hover:bg-sky-50 hover:text-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
      aria-label={`${label}: ${document.title}`} title={snapshot ? `${snapshot.name} · № ${snapshot.certificate}` : 'Назначить специалиста'} onClick={() => onEdit ? onEdit({ ...document }, role) : setEditing({ ...document })}>
      <UserRound aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{snapshot?.name || 'Не назначен'}</span><Pencil aria-hidden="true" className="ml-auto h-3 w-3 shrink-0 text-slate-300 group-hover:text-sky-600" />
    </button>
    {editing ? <SpecialistAssignmentEditor documents={[editing]} onlyRole={role} onClose={() => setEditing(null)} /> : null}
  </div>
}

export function DocumentSpecialistAssignmentDialog({ documents, onClose, onlyRole }: { documents: SpecialistDocument[]; onClose: () => void; onlyRole?: keyof SpecialistSelection }) {
  const [openedDocuments] = useState(() => documents.map(document => ({ ...document })))
  return <SpecialistAssignmentEditor documents={openedDocuments} onClose={onClose} onlyRole={onlyRole} />
}

function SpecialistAssignmentEditor({ documents, onClose, onlyRole }: { documents: SpecialistDocument[]; onClose: () => void; onlyRole?: keyof SpecialistSelection }) {
  const [selection, setSelection] = useState<SpecialistSelection>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [previewPage, setPreviewPage] = useState(0)
  const client = useQueryClient()
  const { requireEditPassword } = useSecurityGuard()
  const profile = getSpecialistDocumentProfile(documents[0]?.type ?? '', documents[0]?.methodCode)
  const profiles = documents.map(document => getSpecialistDocumentProfile(document.type, document.methodCode))
  const compatible = !!profile && profiles.every(candidate => candidate?.kind === profile.kind)
  const requiredProfile = profile ? { ...profile, methods: [...new Set(profiles.flatMap(candidate => candidate?.methods ?? []))] } : null
  const options = useSpecialistOptions(requiredProfile)
  const roles = (['first', 'second'] as const).filter(role => !onlyRole || role === onlyRole)
  const counts = { assign: 0, replace: 0, clear: 0 }
  for (const document of documents) for (const role of roles) {
    if (selection[role] === undefined) continue
    if (selection[role] === null) { if (document.specialists?.[role]) counts.clear++ }
    else if (document.specialists?.[role]) counts.replace++
    else counts.assign++
  }
  const close = () => { if (!saving.current) onClose() }
  async function apply() {
    if (saving.current || !compatible) return
    saving.current = true; setBusy(true); setError('')
    try {
      if (!await requireEditPassword('назначение специалистов')) return
      await assignDocumentSpecialists({ data: { documents: documents.map(document => ({ id: Number(document.documentId ?? document.id), revision: document.specialistsRevision ?? 0, updatedAt: document.updatedAt, documentVersion: document.documentVersion ?? '' })), selection } })
      void client.invalidateQueries({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY, refetchType: 'active' })
      onClose()
    } catch (error) { setError((error as Error).message) }
    finally { saving.current = false; setBusy(false) }
  }
  const person = (document: SpecialistDocument, role: keyof SpecialistSelection) => {
    const snapshot = document.specialists?.[role]
    return snapshot ? `${snapshot.name} · № ${snapshot.certificate}` : 'Не назначен'
  }
  const nextPerson = (document: SpecialistDocument, role: keyof SpecialistSelection) => {
    const id = selection[role]
    if (id === undefined) return 'Без изменений'
    if (id === null) return 'Не назначен'
    const record = options.known.get(id)
    return record ? `${record.name} · № ${record.certificate}` : `Специалист №${id}`
  }
  return <SpecialistDialogShell label="Назначить специалистов" wide={!onlyRole} busy={busy} onClose={close}>
    <DialogHeader title={<span className="flex items-center gap-2"><UsersRound aria-hidden="true" className="h-5 w-5 text-sky-600" />{onlyRole ? 'Назначение специалиста' : 'Назначить специалистов'}</span>}
      subtitle={onlyRole ? documents[0].title : `Отмечено документов: ${documents.length}`} onClose={close} closeDisabled={busy} />
    <div className="min-h-0 space-y-4 overflow-y-auto p-5">
      {!compatible ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Выберите заключения НК/ТВМТ либо ПСТО отдельно.</p> : <>
        <div className="flex items-center gap-2 text-xs leading-5 text-slate-500">
          <span>{onlyRole ? 'Изменение коснётся только этой роли документа.' : 'Выбранные роли изменятся во всех отмеченных документах.'}</span>
          <FieldHelp label="Как назначить, заменить или очистить специалистов">«Не изменять» сохраняет прежние ФИО и удостоверение. Выбор специалиста назначает или заменяет его. Крестик очищает только выбранную роль. Изменения сохраняются после «Применить».</FieldHelp>
        </div>
        {onlyRole ? <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">Сейчас: <span className="font-medium text-slate-700">{person(documents[0], onlyRole)}</span></div> : null}
        <div className={onlyRole ? '' : 'grid gap-3 sm:grid-cols-2'}>{roles.map(role => <SpecialistSelect key={role} label={profile!.labels[role === 'first' ? 0 : 1]} profile={requiredProfile!} options={options} value={selection[role]} allowKeep disabled={busy} onChange={value => setSelection(current => ({ ...current, [role]: value }))} />)}</div>
        {!onlyRole ? <details className="group rounded-xl border border-slate-200 bg-slate-50/50">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-slate-600 [&::-webkit-details-marker]:hidden">
            <FileText aria-hidden="true" className="h-4 w-4 text-slate-400" />Изменения по документам<span className="rounded-md bg-white px-2 py-0.5 text-xs text-slate-500">{documents.length}</span><ChevronDown aria-hidden="true" className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="max-h-60 space-y-2 overflow-auto border-t border-slate-200 p-3">{documents.slice(previewPage * 50, previewPage * 50 + 50).map(document => <li key={document.id} className="rounded-lg border border-slate-100 bg-white p-3">
            <p className="mb-2 break-words text-xs font-semibold text-slate-800">{document.title}</p>
            {roles.map(role => <div key={role} className="mt-2 text-xs"><p className="mb-1 text-slate-400">{profile!.labels[role === 'first' ? 0 : 1]}</p><div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2"><span className="break-words text-slate-500">{person(document, role)}</span><ArrowRight aria-hidden="true" className="mt-0.5 h-3 w-3 text-slate-300" /><span className={`break-words ${selection[role] === null ? 'text-rose-700' : 'text-slate-700'}`}>{nextPerson(document, role)}</span></div></div>)}
          </li>)}</ul>
          {documents.length > 50 ? <div className="flex items-center justify-between border-t border-slate-100 p-2 text-xs text-slate-500"><Button size="sm" variant="ghost" disabled={!previewPage} onClick={() => setPreviewPage(value => value - 1)}>Назад</Button><span>{previewPage + 1} / {Math.ceil(documents.length / 50)}</span><Button size="sm" variant="ghost" disabled={(previewPage + 1) * 50 >= documents.length} onClick={() => setPreviewPage(value => value + 1)}>Далее</Button></div> : null}
        </details> : null}
      </>}
      {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4">
      <div className="flex flex-wrap gap-1.5 text-xs" aria-live="polite">
        {counts.assign ? <span className="rounded-md bg-sky-50 px-2 py-1 text-sky-700">Назначить: {counts.assign}</span> : null}
        {counts.replace ? <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">Заменить: {counts.replace}</span> : null}
        {counts.clear ? <span className="rounded-md bg-rose-50 px-2 py-1 text-rose-700">Очистить: {counts.clear}</span> : null}
        {!counts.assign && !counts.replace && !counts.clear ? <span className="text-slate-400">Нет изменений</span> : null}
      </div>
      <div className="ml-auto flex gap-2"><Button variant="outline" disabled={busy} onClick={close}>Отмена</Button><Button disabled={busy || !compatible || !roles.some(role => selection[role] !== undefined)} onClick={() => void apply()}><Check aria-hidden="true" className="h-4 w-4" />{busy ? 'Сохраняем…' : 'Применить'}</Button></div>
    </div>
  </SpecialistDialogShell>
}
