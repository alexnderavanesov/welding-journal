import { useEffect, useRef, useState } from 'react'
import { Archive, FileText, Upload, X, Trash2, ExternalLink, RefreshCw, Pencil } from 'lucide-react'
import { LargeDialogShell } from './large-dialog-shell'
import { ConfirmActionDialog } from './confirm-action-dialog'
import { LineSchemeNavigationGuard } from './line-scheme-navigation-guard'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { useContainedDialogFocus } from '@/lib/use-contained-dialog-focus'
import { useAccess } from '@/lib/security-context'
import { SCHEME_MAX_BYTES, SCHEME_CHANGE_NUMBER_MAX_LENGTH, schemeChangeNumber, type SchemeLine, type SchemeRevision } from '@/lib/line-schemes'
import { schemeError, type SchemeSession } from '@/lib/use-line-scheme-session'
import { SchemeUploadRejected, uploadSchemePdf } from '@/lib/line-scheme-upload'
import { changeLineSchemeRevision, updateLineSchemeRevisionNumber } from '@/server/line-schemes-api'

export function LineSchemeFilesDialog({ line, session, initialFile, onFileHandled, onOpen, onClose }: {
  line: SchemeLine; session: SchemeSession; initialFile?: File; onFileHandled: () => void; onOpen: (id: string) => void; onClose: () => void
}) {
  const { can } = useAccess(), { bundle, lease, opening, error, setError } = session
  const [busy, setBusy] = useState(''), [notice, setNotice] = useState(''), [progress, setProgress] = useState(0)
  const [pending, setPending] = useState<File | null>(null), [replace, setReplace] = useState<'archive' | 'delete'>('archive')
  const [changeNumber, setChangeNumber] = useState('')
  const [editingNumber, setEditingNumber] = useState<{ revisionId: string; value: string } | null>(null)
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null)
  const [confirmation, setConfirmation] = useState<{ title: string; name?: string; description: string; warning?: string; label: string; danger: boolean; run: () => void } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null), uploadAbort = useRef<AbortController | null>(null), handled = useRef(false)
  const alive = useRef(true), writeInFlight = useRef(false)
  const canWrite = !!bundle && lease.owned && !opening && !busy && !retry
  const canUpload = canWrite && !bundle.deleted && can('schemes.edit')
  const active = bundle?.revisions.find(item => item.id === bundle.activeRevisionId)
  const revisions = [...(bundle?.revisions ?? [])].sort((a, b) => Number(b.id === bundle?.activeRevisionId) - Number(a.id === bundle?.activeRevisionId) || b.createdAt.localeCompare(a.createdAt))
  function close() {
    if (busy) return
    if (retry) setConfirmation({ title: 'Закрыть окно файлов?', description: 'Ответ об операции не получен. Сервер мог уже выполнить её; закрытие окна не отменит результат.', warning: 'Рекомендуем сначала нажать «Повторить операцию».', label: 'Закрыть окно', danger: false, run: onClose })
    else onClose()
  }
  const focus = useContainedDialogFocus(close, !!busy)
  useEffect(() => { alive.current = true; return () => { alive.current = false; uploadAbort.current?.abort() } }, [])
  useEffect(() => {
    if (!initialFile || handled.current || opening) return
    handled.current = true; onFileHandled(); selectFile(initialFile)
  }, [initialFile, opening])
  async function acquire() {
    setBusy('Проверяем доступ…'); setError(''); setNotice('')
    try {
      const next = await session.read(); if (!alive.current) return
      session.apply(next)
      setNotice(next.lease.owned ? 'Доступ получен.' : `Редактирование пока занято: ${next.lease.name ?? 'другое окно'}. Закройте другое окно схемы или дождитесь освобождения доступа и повторите.`)
    } catch (reason) { if (alive.current) setError(schemeError(reason)) }
    finally { if (alive.current) setBusy('') }
  }
  function selectFile(file: File) {
    setError(''); setNotice('')
    if (!file.size || file.size > SCHEME_MAX_BYTES) { setError('Выберите PDF размером до 100 МБ.'); return }
    setPending(file); setReplace('archive'); setChangeNumber('')
  }
  async function upload(file: File, mode: 'archive' | 'delete', openAfter = false) {
    if (!canUpload || !bundle || writeInFlight.current) return
    const data = { bundleId: bundle.id, token: session.token, version: bundle.version, operationId: crypto.randomUUID(), replace: mode, changeNumber: changeNumber.trim() }
    const run = async () => {
      if (writeInFlight.current) return
      writeInFlight.current = true; setBusy('Загружаем PDF…'); setError(''); setProgress(0)
      const controller = new AbortController(); uploadAbort.current = controller
      try {
        const result = await uploadSchemePdf(file, data, setProgress, controller.signal)
        const next = await session.read(false)
        if (!alive.current) return
        session.apply(next); setError(''); setRetry(null); setPending(null); setNotice('Новый PDF стал основным. Точки на нём размещаются заново.')
        if (openAfter && next.bundle?.revisions.some(item => item.id === result.revisionId)) onOpen(result.revisionId)
      } catch (reason) { if (alive.current) { setError(schemeError(reason)); setRetry(reason instanceof SchemeUploadRejected ? null : () => run) } }
      finally { writeInFlight.current = false; uploadAbort.current = null; if (alive.current) setBusy('') }
    }
    await run()
  }
  function submitUpload() {
    if (!pending || !canUpload) return
    const run = () => void upload(pending, replace, !active)
    if (active && replace === 'delete') setConfirmation({ title: 'Заменить PDF с удалением?', name: active.fileName, description: 'Прежний основной PDF, его точки и размеры будут удалены только после успешной загрузки нового файла.', warning: 'Стыки в журнале сохранятся. Вернуть удалённую редакцию из архива будет нельзя.', label: 'Загрузить и удалить прежний', danger: true, run })
    else run()
  }
  async function saveNumber() {
    if (!editingNumber || !bundle || !canWrite || writeInFlight.current) return
    let changeNumber: string | null
    try { changeNumber = schemeChangeNumber(editingNumber.value) } catch (reason) { setError(schemeError(reason)); return }
    const data = { bundleId: bundle.id, token: session.token, version: bundle.version, operationId: crypto.randomUUID(), revisionId: editingNumber.revisionId, changeNumber }
    const run = async () => {
      if (writeInFlight.current) return
      writeInFlight.current = true; setBusy('Сохраняем номер изменения…'); setError('')
      try {
        await updateLineSchemeRevisionNumber({ data, signal: AbortSignal.timeout(15_000) })
        const next = await session.read(false)
        if (!alive.current) return
        session.apply(next); setError(''); setRetry(null); setEditingNumber(null); setNotice('Номер изменения сохранён.')
      } catch (reason) { if (alive.current) { setError(schemeError(reason)); setRetry(() => run) } }
      finally { writeInFlight.current = false; if (alive.current) setBusy('') }
    }
    await run()
  }
  function revisionAction(revision: SchemeRevision, action: 'activate' | 'delete') {
    if (!canWrite || !bundle) return
    const data = { bundleId: bundle.id, token: session.token, version: bundle.version, operationId: crypto.randomUUID(), revisionId: revision.id, action }
    const run = async () => {
      if (writeInFlight.current) return
      writeInFlight.current = true; setBusy(action === 'delete' ? 'Удаляем PDF…' : 'Меняем основную редакцию…'); setError('')
      try {
        await changeLineSchemeRevision({ data, signal: AbortSignal.timeout(15_000) })
        const next = await session.read(false)
        if (!alive.current) return
        session.apply(next); setError(''); setRetry(null); setNotice(action === 'delete' ? 'PDF и разметка этой редакции удалены. Стыки журнала сохранены.' : 'Редакция стала основной. Прежний основной PDF сохранён в архиве.')
      } catch (reason) { if (alive.current) { setError(schemeError(reason)); setRetry(() => run) } }
      finally { writeInFlight.current = false; if (alive.current) setBusy('') }
    }
    setConfirmation({ title: action === 'delete' ? 'Удалить PDF?' : 'Сделать PDF основным?', name: revision.fileName,
      description: action === 'delete' ? 'Будут удалены файл, все точки и размеры этой редакции. Стыки в журнале сохранятся.' : 'Этот PDF и его сохранённая разметка станут доступны для редактирования. Текущий основной PDF останется в архиве.',
      warning: action === 'delete' ? revision.id === bundle.activeRevisionId ? 'Это основной PDF. После удаления основная редакция будет отсутствовать; архив останется.' : 'Удаление нельзя отменить.' : undefined,
      label: action === 'delete' ? 'Удалить PDF' : 'Сделать основной', danger: action === 'delete', run: () => void run() })
  }
  return <LargeDialogShell ariaLabel={`Файлы и архив линии ${line.line}`} maxWidthClassName="max-w-3xl" panelRadiusClassName="rounded-xl" panelClassName="overflow-hidden" overlayClassName="z-[80] bg-slate-950/30">
    <LineSchemeNavigationGuard files dirty={!!pending || !!initialFile && !handled.current || !!editingNumber && editingNumber.value !== (bundle?.revisions.find(item => item.id === editingNumber.revisionId)?.changeNumber ?? '')} busy={!!busy} uncertain={!!retry} onBlocked={setError} />
    <div ref={focus} className="flex min-h-0 flex-col">
      <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4"><div className="rounded-lg bg-sky-50 p-2 text-sky-700"><Archive size={20} /></div><div className="min-w-0 flex-1"><h2 className="font-semibold text-slate-800">Файлы и архив</h2><p className="truncate text-xs text-slate-500">{bundle?.line ?? line.line} · {bundle?.projectTitle ?? line.projectTitle}</p></div><Button variant="ghost" size="icon" disabled={!!busy} aria-label="Закрыть файлы" onClick={close}><X size={18} /></Button></header>
      <div className="min-h-0 space-y-4 overflow-y-auto p-5">
        <p className="text-sm text-slate-500">Основной PDF используется для разметки. Архив хранит прежние чертежи и точки с актуальными состояниями стыков.</p>
        {!opening && !lease.owned && (can('schemes.edit') || can('schemes.delete')) && <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs leading-5 text-amber-900"><span className="flex-1">{lease.name ? `Схема открыта пользователем ${lease.name}. Доступен просмотр.` : 'Режим просмотра. Проверьте доступ, чтобы начать редактирование.'}</span><Button size="sm" variant="outline" className="shrink-0" disabled={!!busy} onClick={() => void acquire()}><RefreshCw size={14} /> Проверить доступ</Button></div>}
        {(error || busy || notice) && <div role={error ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-sky-50 text-sky-800'}`}>{error || busy || notice}{uploadAbort.current && <><span> {progress}%{progress === 100 ? ' — проверяем файл' : ''}</span><button className="ml-3 underline" onClick={() => uploadAbort.current?.abort()}>Прервать загрузку</button></>}{retry && !busy && <button className="ml-3 underline" onClick={() => void retry()}>Повторить операцию</button>}</div>}
        {opening ? <p className="text-sm text-slate-500">Загружаем список файлов…</p> : <div className="space-y-2">
          {!active && <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">{bundle?.deleted ? 'Линия удалена. Доступны просмотр и удаление сохранённых PDF.' : `Основной PDF не загружен.${revisions.length ? ' Загрузите новый файл или сделайте архивную редакцию основной.' : ''}`}</p>}
          {revisions.map(item => <div key={item.id} data-scheme-revision={item.id} className={`rounded-xl border p-3 ${item.id === bundle?.activeRevisionId ? 'border-sky-200 bg-sky-50/40' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-start gap-3"><FileText size={20} className="mt-1 shrink-0 text-slate-400" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${item.id === bundle?.activeRevisionId ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-500'}`}>{item.id === bundle?.activeRevisionId ? 'Основной PDF' : 'Архив'}</span>{item.changeNumber && <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">Изм. {item.changeNumber}</span>}<span className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString('ru-RU')} · {(item.size / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ · листов: {item.pageCount}</span></div><p className="mt-1 break-words text-sm font-medium text-slate-700">{item.fileName}</p><p className="mt-0.5 text-xs text-slate-400">{item.authorName}</p></div></div>
            <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={!!busy || !!retry || !!editingNumber} onClick={() => onOpen(item.id)}><ExternalLink size={14} /> Открыть</Button>
              {!bundle?.deleted && can('schemes.edit') && <Button size="sm" variant="ghost" disabled={!canWrite || !!pending || !!editingNumber} onClick={() => { setError(''); setNotice(''); setEditingNumber({ revisionId: item.id, value: item.changeNumber ?? '' }) }}><Pencil size={14} /> Изменить «Изм.»</Button>}
              {item.id !== bundle?.activeRevisionId && !bundle?.deleted && can('schemes.edit') && <Button size="sm" variant="ghost" disabled={!canWrite || !!pending || !!editingNumber} onClick={() => revisionAction(item, 'activate')}>Сделать основной</Button>}{can('schemes.delete') && <Button className="ml-auto text-rose-700" size="sm" variant="ghost" disabled={!canWrite || !!pending || !!editingNumber} onClick={() => revisionAction(item, 'delete')}><Trash2 size={14} /> Удалить PDF</Button>}</div>
            {editingNumber?.revisionId === item.id && <form className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3" onSubmit={event => { event.preventDefault(); void saveNumber() }}>
              <label className="grid gap-1.5 text-xs text-slate-500">Изм. · необязательно<Input autoFocus aria-label="Номер изменения загруженного PDF" className="h-8 w-44" maxLength={SCHEME_CHANGE_NUMBER_MAX_LENGTH} disabled={!canWrite} value={editingNumber.value} onChange={event => setEditingNumber({ revisionId: item.id, value: event.target.value })} /></label>
              <Button type="submit" size="sm" disabled={!canWrite}>Сохранить номер</Button><Button type="button" size="sm" variant="ghost" disabled={!!busy || !!retry} onClick={() => { setEditingNumber(null); setError('') }}>Отмена</Button>
            </form>}
          </div>)}
        </div>}
        {pending && <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/40 p-4"><p className="break-words text-sm font-medium">Новый файл: {pending.name}</p><label className="grid max-w-xs gap-1.5 text-xs text-slate-600"><span>Изм. <span className="text-slate-400">· необязательно</span></span><Input aria-label="Номер изменения PDF" placeholder="Например, 0 или 1" maxLength={SCHEME_CHANGE_NUMBER_MAX_LENGTH} value={changeNumber} disabled={!canUpload} onChange={event => setChangeNumber(event.target.value)} /></label>{active && <label className="grid gap-2 text-xs text-slate-600">Что сделать с прежним основным PDF<Select aria-label="Замена PDF" value={replace} disabled={!canUpload} onChange={event => setReplace(event.target.value as 'archive' | 'delete')}><option value="archive">Сохранить в архиве — новая редакция</option>{can('schemes.delete') && <option value="delete">Удалить — ошибочная загрузка</option>}</Select></label>}<p className="text-xs text-slate-500">Новый PDF откроется без точек. {active && replace === 'archive' ? 'Прежний файл с разметкой останется в списке архива.' : ''}</p><div className="flex flex-wrap gap-2"><Button size="sm" disabled={!canUpload} onClick={submitUpload}>{active ? 'Загрузить новую редакцию' : 'Загрузить PDF'}</Button><Button size="sm" variant="ghost" disabled={!!busy || !!retry} onClick={() => setPending(null)}>Отмена</Button></div></div>}
      </div>
      {can('schemes.edit') && !bundle?.deleted && <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-5 py-3"><span className="text-xs text-slate-400">PDF до 100 МБ и 100 листов, без пароля</span><input ref={fileInput} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Файл схемы" disabled={!canUpload || !!editingNumber} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) selectFile(file) }} /><Button size="sm" variant="outline" disabled={!canUpload || !!pending || !!editingNumber} onClick={() => fileInput.current?.click()}><Upload size={14} /> {active ? 'Выбрать новый PDF' : 'Выбрать PDF'}</Button></footer>}
      {confirmation && <ConfirmActionDialog title={confirmation.title} itemName={confirmation.name} description={confirmation.description} warning={confirmation.warning} confirmLabel={confirmation.label} tone={confirmation.danger ? 'danger' : 'neutral'} onClose={() => setConfirmation(null)} onConfirm={() => { const run = confirmation.run; setConfirmation(null); run() }} />}
    </div>
  </LargeDialogShell>
}
