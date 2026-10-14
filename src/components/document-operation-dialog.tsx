import { useEffect, useId, useRef, useState } from 'react'
import { CheckCheck, ChevronDown, FileText, ListTree, Merge, Search } from 'lucide-react'
import { LargeDialogShell } from './large-dialog-shell'
import { DialogHeader } from './dialog-header'
import { BufferedDocumentNameInput } from './buffered-document-name-input'
import { DocumentCompositionPanel } from './document-composition-panel'
import { DocumentSplitModeSelect } from './document-split-mode-select'
import { FieldHelp } from './field-help'
import { Button } from './ui/button'
import { getSystemDocumentSplitSettingId, type SystemDocumentSplitMode } from '@/lib/system-document-splitting'
import type { SystemDocumentSummary } from '@/lib/system-document-types'
import type { DocumentOperationRequest } from '@/lib/system-document-operation'
import type { DocumentOperationPreview, DocumentOperationResult } from '@/server/document-operation-service'
import { applyDocumentOperation, getDocumentOperationComposition, getDocumentOperationResult, planDocumentOperationBatches, previewDocumentOperation } from '@/server/document-operations'
import { getDocumentGroupingDefaults } from '@/server/document-grouping-preferences'
import { useWindowEscapeKey } from '@/lib/use-window-escape-key'
import { isContextActionMenuOpen } from '@/lib/context-action-menu-state'

export function DocumentOperationDialog({ documents, action, onClose, onApplied }: {
  documents: SystemDocumentSummary[]; action: DocumentOperationRequest['action']; onClose: () => void; onApplied: () => Promise<void>
}) {
  const [mode, setMode] = useState<SystemDocumentSplitMode>('none'), [merge, setMerge] = useState(action === 'merge')
  const [names, setNames] = useState<NonNullable<DocumentOperationRequest['names']>>({})
  const [batches, setBatches] = useState<number[][]>([]), [batchIndex, setBatchIndex] = useState(0)
  const [blocked, setBlocked] = useState<Array<{ title: string; reason: string }>>([])
  const [blockedPage, setBlockedPage] = useState(0)
  const [preview, setPreview] = useState<DocumentOperationPreview | null>(null), [previewRequest, setPreviewRequest] = useState<DocumentOperationRequest | null>(null)
  const [dirty, setDirty] = useState(true), [busy, setBusy] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [saved, setSaved] = useState<DocumentOperationResult[]>([]), [batchSaved, setBatchSaved] = useState(false)
  const [page, setPage] = useState(0), [search, setSearch] = useState(''), [composition, setComposition] = useState<string | null>(null)
  const [unknownResult, setUnknownResult] = useState(false)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const pending = useRef<Parameters<typeof applyDocumentOperation>[0]['data'] | null>(null)
  const openRequest = useRef<Promise<Awaited<ReturnType<typeof getDocumentGroupingDefaults>>> | null>(null)
  const mounted = useRef(true)
  const compositionId = useId()
  const compositionTrigger = useRef<HTMLButtonElement | null>(null)
  // Popovers handle Escape in capture; never let it also clear the page selection.
  useWindowEscapeKey(true, event => {
    if (event.defaultPrevented || isContextActionMenuOpen()) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!saving) onClose()
  })
  useEffect(() => {
    mounted.current = true
    openRequest.current ??= getDocumentGroupingDefaults()
    void openRequest.current.then(settings => {
      if (!mounted.current) return
      const initial = action === 'merge' ? 'none' : settings.splitModes[getSystemDocumentSplitSettingId(documents[0])]
      setMode(initial); void refresh(initial, action === 'merge', {}, true)
    }).catch(cause => { if (mounted.current) { setError(message(cause)); setBusy(false) } })
    return () => { mounted.current = false }
  }, [])

  async function refresh(nextMode = mode, nextMerge = merge, nextNames = names, repartition = false, index = batchIndex) {
    setBusy(true); setError(''); setComposition(null)
    try {
      let packets = batches
      if (repartition || !packets.length) {
        const selection = await planDocumentOperationBatches({ data: { documentIds: documents.map(d => d.documentId), merge: nextMerge } })
        if (action === 'merge' && (selection.batches.length !== 1 || selection.blocked.length || selection.batches[0].length !== documents.length)) throw new Error('Объединить можно только весь выбор целиком. Частичное объединение не выполняется.')
        packets = selection.batches; setBatches(packets); setBlocked(selection.blocked); setBlockedPage(0); setBatchIndex(0); index = 0
      }
      if (!packets[index]) { setPreview(null); return }
      const request: DocumentOperationRequest = { documentIds: packets[index], action, mode: nextMode, merge: nextMerge, names: nextNames }
      const result = await previewDocumentOperation({ data: request })
      if (!mounted.current) return
      if (action === 'merge' && (result.groups.length !== 1 || result.selectedCount !== documents.length)) throw new Error('Объединение должно создать ровно один документ из всего выбора. Документы не изменены.')
      // A stale manual value must not keep covering the server's empty field:
      // the new membership needs an explicit name, even if the key stayed equal.
      const reviewedNames = { ...nextNames }
      for (const group of result.groups) {
        const draft = reviewedNames[group.key]
        if (draft && draft.membership !== group.membership) reviewedNames[group.key] = { ...draft, name: draft.mode === 'custom' ? '' : draft.name, membership: group.membership }
      }
      setNames(reviewedNames)
      setPreview(result); setPreviewRequest(request); setDirty(false); setPage(0); setSearch(''); setBatchSaved(false)
      pending.current = null; setUnknownResult(false)
    } catch (cause) { setError(message(cause)); setDirty(true) }
    finally { if (mounted.current) setBusy(false) }
  }
  function editName(group: DocumentOperationPreview['groups'][number], value: string, namingMode: 'custom' | 'system' = 'custom') {
    setNames(current => ({ ...current, [group.key]: { mode: namingMode, name: value, membership: group.membership } })); setDirty(true)
  }
  async function accepted(result: DocumentOperationResult) {
    pending.current = null; setUnknownResult(false); setSaved(current => [...current, result]); setBatchSaved(true)
    try { await onApplied() } catch { setError('Документы сохранены, но список не удалось обновить. Закройте окно и обновите список.') }
  }
  async function apply() {
    if (!preview || !previewRequest || dirty || busy || batchSaved) return
    setSaving(true); setError('')
    const data = pending.current ?? { ...previewRequest, fingerprint: preview.fingerprint, previewHash: preview.previewHash, operationId: crypto.randomUUID(), ...(preview.groups.some(group => group.specialistsCleared) ? { acceptSpecialistClearing: true } : {}) }
    pending.current = data
    try { await accepted(await applyDocumentOperation({ data })) }
    catch (cause) {
      try {
        const result = await getDocumentOperationResult({ data: { operationId: data.operationId } })
        if (result) await accepted(result)
        else { setUnknownResult(true); setError(`${message(cause)} Результат записи пока не подтверждён. Повторите тот же запрос или проверьте результат.`) }
      } catch { setUnknownResult(true); setError('Связь потеряна. Сохранение могло завершиться. Проверьте результат или повторите тот же запрос — повторной операции не будет.') }
    } finally { setSaving(false) }
  }
  async function checkResult() {
    if (!pending.current) return
    setSaving(true)
    try { const result = await getDocumentOperationResult({ data: { operationId: pending.current.operationId } }); if (result) await accepted(result); else { setUnknownResult(false); setError('Подтверждённый результат не найден. Нажмите «Проверить изменения» для новой проверки.'); setDirty(true) } }
    catch (cause) { setError(message(cause)) }
    finally { setSaving(false) }
  }
  const locked = busy || saving || unknownResult || batchSaved
  const groups = preview?.groups ?? [], issues = groups.filter(g => g.error)
  const structureDirty = action === 'split' && (mode !== previewRequest?.mode || merge !== previewRequest?.merge)
  const groupName = (group: DocumentOperationPreview['groups'][number]) => names[group.key]?.mode === 'custom' ? names[group.key].name : group.name
  const nameModes = new Set(groups.map(group => names[group.key]?.mode ?? group.namingMode))
  const filtered = groups.filter(group => (!errorsOnly || group.error) && `${group.label} ${groupName(group)}`.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU')))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 50) - 1))
  const visible = filtered.slice(currentPage * 50, (currentPage + 1) * 50)
  const title = action === 'split' ? 'Изменить разделение' : action === 'merge' ? 'Объединить документы' : 'Переименовать документы'
  return <LargeDialogShell ariaLabel={title} panelClassName="h-[90vh] overflow-hidden" panelRadiusClassName="rounded-xl" maxWidthClassName="max-w-[1320px]">
    <DialogHeader title={title} subtitle={`Выбрано документов: ${documents.length} · Даты, результаты и история сохраняются`} closeDisabled={saving} onClose={onClose} />
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-3">
      {action === 'split' ? <>
        <div className="flex items-center gap-2">
          <DocumentSplitModeSelect label="Разделение выбранных документов" value={mode} disabled={locked || saved.length > 0} onChange={value => { setMode(value); setDirty(true); setComposition(null) }} />
          <FieldHelp label="Как выбрать разделение">«По линии» создаёт документ на каждую линию с учётом проекта и шифра. Без объединения каждый исходный документ делится отдельно. «Без разделения» сохраняет его состав целиком.</FieldHelp>
        </div>
        {documents.length > 1 ? <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <Merge aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-600" />
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" checked={merge} disabled={locked || saved.length > 0} onChange={e => { setMerge(e.target.checked); setBatches([]); setBatchIndex(0); setDirty(true); setComposition(null) }} />Объединить перед разделением</label>
          <FieldHelp label="Что значит объединить документы"><p className="font-semibold">Сначала собрать вместе, затем разделить</p><p className="mt-1">Две заявки, в каждой две одинаковые линии: без объединения получится 4 документа, с объединением — 2. С вариантом «Без разделения» — 1 документ.</p><p className="mt-1">Виды, даты и этапы должны быть совместимы. НК до ТО и основной НК, а также разные циклы одного стыка объединять нельзя. Разные циклы разных стыков допустимы.</p></FieldHelp>
        </div> : null}
      </> : action === 'merge' ? <div className="flex items-center gap-2 text-sm text-slate-600"><Merge aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-600" /><span>Все выбранные документы → один. Проверьте итоговое название и состав.</span><FieldHelp label="Правила объединения документов"><p className="font-semibold">Объединяется весь выбор целиком</p><p className="mt-1">Например, два заключения ВИК одной даты и этапа станут одним, со всеми исходными позициями. Можно задать новое имя или взять имя одного из исходных документов.</p><p className="mt-1">ВИК и РК, разные даты, НК до ТО и основной НК, разные циклы одного стыка объединять нельзя. При несовместимости ни один документ не меняется.</p><p className="mt-1">Исходные документы заменятся одним; позиции, факты контроля, история и ссылки сохранятся. Привычный режим разделения для новых документов не меняется.</p></FieldHelp></div>
        : <div className="flex items-center gap-2 text-sm text-slate-600"><FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-600" />Меняются только названия. Состав и количество документов останутся прежними.</div>}
    </div>
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-5 py-4 lg:overflow-hidden">
        {busy ? <p role="status" className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">Проверяем состав и названия…</p> : null}
        {preview ? <>
          <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 text-xs text-slate-500" aria-label="Итог операции">
            <p className={`rounded-md px-3 py-1.5 font-semibold ${structureDirty ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800'}`}>{structureDirty ? 'Количество документов — после проверки' : `Выбрано в пакете: ${preview.selectedCount} → Получится: ${groups.length}`}</p>
            {!structureDirty ? <><span>Стыков: {preview.rowCount}</span><span>· Позиций: {preview.positionCount}</span></> : null}
            {!dirty && !busy ? <span>· Без изменений: {groups.filter(g => g.unchanged).length}</span> : null}
          </div>
          <div className="mb-3 flex shrink-0 flex-wrap items-center gap-x-3 border-b border-slate-200">
            <span className="text-xs text-slate-500">Названия всех документов</span>
            <div role="group" aria-label="Режим названий всех документов" className="flex gap-1">
              {(['system', 'custom'] as const).map(value => <button type="button" key={value} disabled={locked || structureDirty} aria-pressed={nameModes.size === 1 && nameModes.has(value)}
                className={`h-10 border-b-2 px-3 text-sm font-semibold transition-colors disabled:opacity-50 ${nameModes.size === 1 && nameModes.has(value) ? 'border-sky-600 text-sky-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                onClick={() => { setNames(current => ({ ...current, ...Object.fromEntries(groups.map(g => [g.key, { mode: value, name: groupName(g), membership: g.membership }])) })); setDirty(true) }}>{value === 'system' ? 'Системные' : 'Пользовательские'}</button>)}
            </div>
            <FieldHelp label="Как задаются названия">Переключатель относится ко всему списку, включая другие страницы. Системные названия рассчитываются по шаблону. Пользовательские можно вводить вручную в каждой строке. Отдельная правка не меняет остальные имена; тогда в списке смешанный режим.</FieldHelp>
            {nameModes.size > 1 ? <span className="text-xs text-slate-500">Смешанные</span> : null}
          </div>
          <div className="relative shrink-0"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><BufferedDocumentNameInput value={search} onCommit={value => { setSearch(value); setPage(0) }} className="pl-9" placeholder="Найти документ или группу" aria-label="Поиск по будущим документам" /></div>
          {issues.length || errorsOnly ? <label className="mt-2 text-xs text-rose-700"><input type="checkbox" checked={errorsOnly} onChange={event => { setErrorsOnly(event.target.checked); setSearch(''); setPage(0) }} /> Только проблемные группы — {issues.length} во всём списке{dirty ? ' (по предыдущей проверке)' : ''}</label> : null}
          {structureDirty ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Параметры разделения изменены. Нажмите «Проверить изменения», чтобы увидеть новый состав и названия. Ниже — предыдущий расчёт.</p> : null}
          <div className="mt-3 shrink-0 lg:min-h-0 lg:flex-1 lg:overflow-auto lg:[scrollbar-gutter:stable]">
            <div className="space-y-3">{visible.map((group, index) => {
              const namingMode = names[group.key]?.mode ?? group.namingMode
              const pendingSystemName = dirty && namingMode === 'system' && group.namingMode !== 'system'
              const sources = preview.sources.filter(source => group.sourceIds.includes(source.id))
              const prefix = `${sources[0]?.title} → `
              const groupLabel = group.label.startsWith(prefix) ? group.label.slice(prefix.length) : group.label
              return <article key={group.key} className={`rounded-xl border bg-white p-3 sm:p-4 ${composition === group.key ? 'border-sky-300 ring-1 ring-sky-100' : 'border-slate-200'} ${structureDirty ? 'opacity-60' : ''}`}>
                <div className="mb-3 flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5 font-semibold text-slate-500"><FileText aria-hidden="true" className="h-3.5 w-3.5" />Документ {currentPage * 50 + index + 1}</span>
                  {!dirty && !busy ? <span className={`rounded px-2 py-0.5 ${group.error ? 'bg-rose-50 text-rose-700' : group.unchanged ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>{group.error ? 'Нужна правка' : group.unchanged ? 'Без изменений' : 'Проверен'}</span> : <span className="text-amber-700">Не проверен</span>}
                </div>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{sources.length > 1 ? 'Исходные документы' : 'Сейчас'}</p>
                    <p className="mt-1 break-words text-sm font-medium leading-5 text-slate-700">{sources.map(source => source.title).join(' · ')}</p>
                    {action === 'split' ? <p className="mt-1 break-words text-xs leading-5 text-slate-500">Группа: {groupLabel}</p> : null}
                    <button type="button" aria-label={`Посмотреть состав: ${group.positionCount}`} aria-expanded={composition === group.key} aria-controls={composition === group.key ? compositionId : undefined} className="mt-3 inline-flex items-center gap-2 rounded-md border border-sky-100 bg-sky-50/60 px-2.5 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50" disabled={busy || structureDirty} onClick={event => { compositionTrigger.current = event.currentTarget; setComposition(current => current === group.key ? null : group.key) }}><ListTree aria-hidden="true" className="h-3.5 w-3.5" />{composition === group.key ? 'Состав документа' : 'Посмотреть состав'}<span className="rounded bg-white px-1.5 tabular-nums">{group.positionCount}</span><ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${composition === group.key ? 'rotate-180' : ''}`} /></button>
                    {group.rowCount !== group.positionCount ? <p className="mt-1 text-xs text-slate-500">Уникальных стыков: {group.rowCount}</p> : null}
                  </div>
                  <div className="min-w-0">
                    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-700">Итоговое название</span>
                      <BufferedDocumentNameInput value={pendingSystemName ? '' : groupName(group)} onCommit={value => editName(group, value)} aria-label={`Название: ${group.label}`} placeholder={pendingSystemName ? 'Рассчитается при проверке' : 'Введите название документа'} disabled={locked || structureDirty} maxLength={2000} />
                    </label>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"><span className="text-slate-500">{namingMode === 'system' ? 'По системному шаблону' : 'Введено вручную'}</span>{namingMode !== 'system' ? <button type="button" className="text-sky-700 underline-offset-4 hover:underline disabled:opacity-50" disabled={locked || structureDirty} onClick={() => editName(group, '', 'system')}>Вернуть системное имя</button> : null}</div>
                    {merge ? <label className="mt-3 block text-xs text-slate-500">Или использовать имя исходного документа<select aria-label={`Имя исходного документа: ${group.label}`} className="mt-1 block h-9 w-full min-w-0 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700" value="" disabled={locked || structureDirty} onChange={e => editName(group, e.target.value)}><option value="">Выберите исходный документ</option>{sources.map(source => <option key={source.id} value={source.title}>{source.title}</option>)}</select></label> : null}
                    {group.error ? <p className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700">{dirty ? 'Предыдущая проверка: ' : ''}{group.error}</p> : null}
                  </div>
                </div>
                {composition === group.key && previewRequest ? <div id={compositionId}><DocumentCompositionPanel inline key={`${preview.fingerprint}:${group.key}`} title={groupName(group) || 'Название ещё не задано'} cacheKey={`${preview.fingerprint}:${group.membership}`} onClose={() => { setComposition(null); compositionTrigger.current?.focus({ preventScroll: true }) }} load={(query, page) => getDocumentOperationComposition({ data: { ...previewRequest, fingerprint: preview.fingerprint, groupKey: group.key, query, page } })} /></div> : null}
              </article>
            })}</div>
            {!visible.length ? <p className="py-10 text-center text-sm text-slate-500">Документы не найдены. Измените поиск или фильтр ошибок.</p> : null}
          </div>
          <div className="mt-3 flex shrink-0 items-center justify-between gap-2 text-xs text-slate-500"><button type="button" className="rounded-md px-2 py-1.5 hover:bg-slate-100 disabled:opacity-30" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>← Предыдущие</button><span className="text-center tabular-nums">{filtered.length} документов · {currentPage + 1} / {Math.max(1, Math.ceil(filtered.length / 50))}</span><button type="button" className="rounded-md px-2 py-1.5 hover:bg-slate-100 disabled:opacity-30" disabled={(currentPage + 1) * 50 >= filtered.length} onClick={() => setPage(currentPage + 1)}>Следующие →</button></div>
        </> : null}
      </div>
    </div>
    <div className="shrink-0 border-t bg-white px-5 py-3">
      {groups.some(group => group.specialistsCleared) && !batchSaved ? <p role="alert" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">У объединяемых документов различаются специалисты или сохранённые удостоверения. После подтверждения обе роли в таких итоговых документах будут пустыми (документов: {groups.filter(group => group.specialistsCleared).length}). Назначить специалистов можно в «Документах». Отмена сохранит прежние назначения.</p> : null}
      {blocked.length ? <details className="mb-2 text-xs text-amber-800"><summary>Не будут изменены: {blocked.length}</summary><div className="max-h-28 overflow-auto">{blocked.slice(blockedPage * 50, (blockedPage + 1) * 50).map((item, index) => <p key={index}>{item.title}: {item.reason}</p>)}</div>{blocked.length > 50 ? <div className="flex justify-between"><button type="button" disabled={!blockedPage} onClick={() => setBlockedPage(value => value - 1)}>Предыдущие отказы</button><span>Страница {blockedPage + 1}</span><button type="button" disabled={(blockedPage + 1) * 50 >= blocked.length} onClick={() => setBlockedPage(value => value + 1)}>Следующие отказы</button></div> : null}</details> : null}
      {error ? <p role="alert" className="mb-2 max-h-28 overflow-auto whitespace-pre-line text-sm text-rose-700">{error}</p> : null}
      {saved.length ? <p role="status" className="mb-2 text-sm text-emerald-700">Сохранено пакетов: {saved.length}. Изменено документов: {saved.reduce((sum, result) => sum + result.changedDocumentCount, 0)}.</p> : null}
      {batches.length > 1 ? <p className="mb-2 text-xs text-amber-800">Пакет {batchIndex + 1} из {batches.length}. Каждый пакет сохраняется целиком. Ошибка следующего не откатывает уже сохранённые. Можно остановиться между пакетами.</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="outline" className="gap-2" disabled={locked} onClick={() => void refresh()}><CheckCheck aria-hidden="true" className="h-4 w-4" />Проверить изменения</Button>
          <FieldHelp label="Зачем проверять изменения"><p className="font-semibold">Проверка ничего не сохраняет</p><p className="mt-1">Рассчитывает будущие документы и системные имена, проверяет совместимость и занятые названия. Например, после выбора «По линии» покажет отдельные документы для каждой линии.</p><p className="mt-1">Проверьте получившиеся названия и состав. Только «Подтвердить и применить» сохранит изменения.</p></FieldHelp>
          <span className={`hidden text-xs sm:inline ${dirty ? 'text-amber-700' : 'text-slate-500'}`}>{dirty ? 'Черновик ещё не проверен' : batchSaved ? 'Изменения сохранены' : 'Проверьте итоговые названия перед сохранением'}</span>
        </div>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={saving} onClick={onClose}>{saved.length ? 'Остановиться / закрыть' : 'Отмена'}</Button>
        {unknownResult ? <Button variant="outline" disabled={saving} onClick={() => void checkResult()}>Проверить результат</Button> : null}
        {batchSaved && batches[batchIndex + 1] ? <Button onClick={() => { const next = batchIndex + 1; setBatchIndex(next); setNames({}); setPreview(null); setDirty(true); void refresh(mode, merge, {}, false, next) }}>Просмотреть следующий пакет</Button> : <Button disabled={busy || saving || dirty || !preview || issues.length > 0 || batchSaved} onClick={() => void apply()}>{saving ? 'Сохраняем…' : unknownResult ? 'Повторить тот же запрос' : 'Подтвердить и применить'}</Button>}
        </div>
      </div>
    </div>
  </LargeDialogShell>
}
function message(value: unknown) { return value instanceof Error && value.message && !/Failed query:|parameters:/i.test(value.message) ? value.message : 'Не удалось подтвердить сохранение пакета. Проверьте результат и повторите действие.' }
