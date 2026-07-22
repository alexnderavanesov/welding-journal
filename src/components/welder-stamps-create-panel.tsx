import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Archive, Check, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WelderStampWeldTypeSelector } from '@/components/welder-stamp-weld-type-selector'
import { useDataListSettings } from '@/lib/data-list-settings'
import { splitWelderStampMaterialGroups, splitWelderStampWeldTypes } from '@/lib/welder-stamp-format'
import {
  createEmptyDlsPermit,
  createEmptyNaksPermit,
  createWelderStampPermitId,
} from '@/lib/welder-stamp-permits'
import {
  getWelderNameByNaks,
  getWelderStampFormHint,
  getWelderStampNameSyncHint,
  normalizeNaksStamp,
} from '@/lib/welder-stamp-registry'
import type { WelderStampDlsPermit, WelderStampNaksPermit, WelderStampRecord } from '@/lib/welder-stamp-types'

type WelderStampsCreatePanelProps = {
  draft: WelderStampRecord
  editingId: number | null
  initialFocusPermitId?: string | null
  records: WelderStampRecord[]
  onDraftChange: <K extends keyof WelderStampRecord>(field: K, value: WelderStampRecord[K]) => void
  onSave: () => boolean | Promise<boolean | undefined>
  onReset: () => void
}

export function WelderStampsCreatePanel({
  draft,
  editingId,
  initialFocusPermitId = null,
  records,
  onDraftChange,
  onSave,
  onReset,
}: WelderStampsCreatePanelProps) {
  const { weldingTypes, materialGroups } = useDataListSettings()
  const panelRef = useRef<HTMLDivElement>(null)
  const pendingFocusPermitIdRef = useRef<string | null>(null)
  const handledInitialFocusPermitIdRef = useRef<string | null>(null)
  const [focusedPermitId, setFocusedPermitId] = useState<string | null>(null)
  const naksPermits = draft.naksPermits.length > 0 ? draft.naksPermits : [createEmptyNaksPermit()]
  const dlsPermits = draft.dlsPermits
  const activeNaksPermits = naksPermits.filter((permit) => !permit.archived)
  const archivedNaksPermits = naksPermits.filter((permit) => permit.archived)
  const activeDlsPermits = dlsPermits.filter((permit) => !permit.archived)
  const archivedDlsPermits = dlsPermits.filter((permit) => permit.archived)
  const hasArchivedPermits = archivedNaksPermits.length > 0 || archivedDlsPermits.length > 0
  const formHint = getWelderStampFormHint(draft)
  const saveDisabled = formHint.kind === 'error'
  const nameSyncHint = getWelderStampNameSyncHint(records, draft, editingId)
  const naksStampOptions = Array.from(new Set(records.map((record) => normalizeNaksStamp(record.naksStamp)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, 'ru'),
  )
  const naksStampDatalistId = `welder-naks-stamps-${editingId ?? 'new'}`

  useEffect(() => {
    const permitId =
      pendingFocusPermitIdRef.current ??
      (initialFocusPermitId && handledInitialFocusPermitIdRef.current !== initialFocusPermitId ? initialFocusPermitId : null)
    if (!permitId) return
    setFocusedPermitId(permitId)

    const animationFrame = window.requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(`[data-permit-editor-id="${permitId}"]`)
      if (!target) return

      handledInitialFocusPermitIdRef.current = permitId
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.focus({ preventScroll: true })
      pendingFocusPermitIdRef.current = null
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [initialFocusPermitId, naksPermits, dlsPermits])

  useEffect(() => {
    if (!focusedPermitId) return
    const timeoutId = window.setTimeout(() => {
      setFocusedPermitId((currentId) => (currentId === focusedPermitId ? null : currentId))
    }, 1800)

    return () => window.clearTimeout(timeoutId)
  }, [focusedPermitId])

  function focusNewPermit(id: string) {
    pendingFocusPermitIdRef.current = id
    setFocusedPermitId(id)
  }

  function handleNaksStampChange(value: string) {
    const normalizedStamp = normalizeNaksStamp(value)
    onDraftChange('naksStamp', value)

    const existingName = getWelderNameByNaks(records, normalizedStamp, editingId)
    if (existingName) onDraftChange('welderName', existingName)
  }

  function updateNaksPermit(id: string, patch: Partial<WelderStampNaksPermit>) {
    onDraftChange(
      'naksPermits',
      naksPermits.map((permit) => (permit.id === id ? { ...permit, ...patch } : permit)),
    )
  }

  function updateDlsPermit(id: string, patch: Partial<WelderStampDlsPermit>) {
    onDraftChange(
      'dlsPermits',
      dlsPermits.map((permit) => (permit.id === id ? { ...permit, ...patch } : permit)),
    )
  }

  function addNaksPermit(copyFrom?: WelderStampNaksPermit) {
    const nextPermit = copyFrom ? { ...copyFrom, id: createWelderStampPermitId('naks'), note: '' } : createEmptyNaksPermit()
    focusNewPermit(nextPermit.id)
    onDraftChange('naksPermits', [...naksPermits, nextPermit])
  }

  function addDlsPermit(copyFrom?: WelderStampDlsPermit) {
    const nextPermit = copyFrom ? { ...copyFrom, id: createWelderStampPermitId('dls'), number: '', note: '' } : createEmptyDlsPermit()
    focusNewPermit(nextPermit.id)
    onDraftChange('dlsPermits', [...dlsPermits, nextPermit])
  }

  function removeNaksPermit(id: string) {
    onDraftChange('naksPermits', naksPermits.length > 1 ? naksPermits.filter((permit) => permit.id !== id) : [createEmptyNaksPermit()])
  }

  function removeDlsPermit(id: string) {
    onDraftChange('dlsPermits', dlsPermits.filter((permit) => permit.id !== id))
  }

  function archiveNaksPermit(id: string) {
    updateNaksPermit(id, { archived: true })
  }

  function restoreNaksPermit(id: string) {
    updateNaksPermit(id, { archived: false })
  }

  function archiveDlsPermit(id: string) {
    updateDlsPermit(id, { archived: true })
  }

  function restoreDlsPermit(id: string) {
    updateDlsPermit(id, { archived: false })
  }

  return (
    <div ref={panelRef} className="space-y-4">
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm shadow-slate-100 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          <span>Клеймо НАКС</span>
          <Input
            value={draft.naksStamp}
            onChange={(event) => handleNaksStampChange(event.target.value)}
            maxLength={4}
            list={naksStampDatalistId}
            placeholder="A123"
          />
          <datalist id={naksStampDatalistId}>
            {naksStampOptions.map((stamp) => (
              <option key={stamp} value={stamp} />
            ))}
          </datalist>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          <span>ФИО сварщика</span>
          <Input
            value={draft.welderName}
            onChange={(event) => onDraftChange('welderName', event.target.value)}
            placeholder="Например: Иванов И.И."
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          <span>Клеймо внутреннее</span>
          <Input
            value={draft.internalStamp}
            onChange={(event) => onDraftChange('internalStamp', event.target.value)}
            placeholder="Например: 45"
          />
        </label>
      </div>

      <PermitSection
        title="Допуски НАКС"
        description="Государственный допуск: ДЛС не сможет выйти за эти способы, группы материалов, диаметры, толщины и сроки."
        actionLabel="Добавить НАКС"
        tone="naks"
        onAdd={() => addNaksPermit()}
      >
        {activeNaksPermits.length === 0 ? (
          <div className="rounded-md border border-dashed border-sky-200 bg-white/70 px-3 py-4 text-sm text-slate-500">
            Активных НАКС нет. Добавьте новый допуск или верните нужный НАКС из архива ниже.
          </div>
        ) : activeNaksPermits.map((permit) => (
          <NaksPermitEditor
            key={permit.id}
            title={`НАКС ${naksPermits.findIndex((candidate) => candidate.id === permit.id) + 1}`}
            permit={permit}
            weldingTypes={weldingTypes}
            materialGroups={materialGroups}
            canRemove={naksPermits.length > 1}
            isFocused={focusedPermitId === permit.id}
            archived={false}
            onChange={(patch) => updateNaksPermit(permit.id, patch)}
            onArchive={() => archiveNaksPermit(permit.id)}
            onRestore={() => restoreNaksPermit(permit.id)}
            onRemove={() => removeNaksPermit(permit.id)}
          />
        ))}
      </PermitSection>

      <PermitSection
        title="ДЛС"
        description="Объектный допуск заказчика. При включенной проверке ДЛС официальное клеймо должно подходить и по НАКС, и по ДЛС."
        actionLabel="Добавить ДЛС"
        tone="dls"
        onAdd={() => addDlsPermit()}
      >
        {activeDlsPermits.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
            Активных ДЛС нет. Если в настройках включить проверку ДЛС, официальные клейма без подходящего ДЛС будут блокироваться.
          </div>
        ) : (
          activeDlsPermits.map((permit) => (
            <DlsPermitEditor
              key={permit.id}
              title={`ДЛС ${dlsPermits.findIndex((candidate) => candidate.id === permit.id) + 1}`}
              permit={permit}
              weldingTypes={weldingTypes}
              materialGroups={materialGroups}
              isFocused={focusedPermitId === permit.id}
              archived={false}
              onChange={(patch) => updateDlsPermit(permit.id, patch)}
              onArchive={() => archiveDlsPermit(permit.id)}
              onRestore={() => restoreDlsPermit(permit.id)}
              onRemove={() => removeDlsPermit(permit.id)}
            />
          ))
        )}
      </PermitSection>

      {hasArchivedPermits ? (
        <PermitSection
          title="Архив НАКС и ДЛС"
          description="Здесь хранятся старые допуски. Они не создают напоминания и не считаются обычными действующими, но могут пройти проверку для исторической даты сварки внутри срока допуска."
          actionLabel=""
          tone="archive"
          onAdd={undefined}
        >
          {archivedNaksPermits.map((permit) => (
            <NaksPermitEditor
              key={permit.id}
              title={`НАКС ${naksPermits.findIndex((candidate) => candidate.id === permit.id) + 1}`}
              permit={permit}
              weldingTypes={weldingTypes}
              materialGroups={materialGroups}
              canRemove={naksPermits.length > 1}
              isFocused={focusedPermitId === permit.id}
              archived
              onChange={(patch) => updateNaksPermit(permit.id, patch)}
              onArchive={() => archiveNaksPermit(permit.id)}
              onRestore={() => restoreNaksPermit(permit.id)}
              onRemove={() => removeNaksPermit(permit.id)}
            />
          ))}
          {archivedDlsPermits.map((permit) => (
            <DlsPermitEditor
              key={permit.id}
              title={`ДЛС ${dlsPermits.findIndex((candidate) => candidate.id === permit.id) + 1}`}
              permit={permit}
              weldingTypes={weldingTypes}
              materialGroups={materialGroups}
              isFocused={focusedPermitId === permit.id}
              archived
              onChange={(patch) => updateDlsPermit(permit.id, patch)}
              onArchive={() => archiveDlsPermit(permit.id)}
              onRestore={() => restoreDlsPermit(permit.id)}
              onRemove={() => removeDlsPermit(permit.id)}
            />
          ))}
        </PermitSection>
      ) : null}

      {nameSyncHint ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          {nameSyncHint}
        </div>
      ) : null}
      <div
        className={`rounded-md border px-3 py-2 text-xs leading-5 ${
          formHint.kind === 'error'
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : 'border-sky-100 bg-sky-50 text-sky-800'
        }`}
      >
        {formHint.text}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
        <Button type="button" variant="outline" onClick={onReset}>
          <X className="mr-2 h-4 w-4" />
          Очистить
        </Button>
        <Button type="button" onClick={onSave} disabled={saveDisabled} title={saveDisabled ? formHint.text : undefined}>
          <Check className="mr-2 h-4 w-4" />
          {editingId === null ? 'Добавить клеймо' : 'Сохранить клеймо'}
        </Button>
      </div>
    </div>
  )
}

function PermitSection({
  title,
  description,
  actionLabel,
  tone,
  onAdd,
  children,
}: {
  title: string
  description: string
  actionLabel: string
  tone: PermitTone
  onAdd?: () => void
  children: ReactNode
}) {
  const toneClassName = getPermitToneClassName(tone)

  return (
    <section className={`overflow-hidden rounded-lg border shadow-sm ${toneClassName.section}`}>
      <div className={`flex flex-wrap items-start justify-between gap-3 border-b px-3 py-3 ${toneClassName.header}`}>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        {onAdd ? (
          <Button type="button" variant="outline" size="sm" className={toneClassName.addButton} onClick={onAdd}>
            <Plus className="mr-2 h-4 w-4" />
            {actionLabel}
          </Button>
        ) : null}
      </div>
      <div className={`space-y-3 p-3 ${toneClassName.body}`}>{children}</div>
    </section>
  )
}

type PermitTone = 'naks' | 'dls' | 'archive'

function getPermitToneClassName(tone: PermitTone) {
  if (tone === 'archive') {
    return {
      section: 'border-slate-200 bg-slate-50/60 shadow-slate-100',
      header: 'border-slate-200 bg-slate-100/80',
      body: 'bg-slate-50/70',
      card: 'border-slate-200 bg-white/80 shadow-slate-100',
      focusedCard: 'ring-2 ring-slate-300 ring-offset-2 ring-offset-slate-50',
      cardHeader: 'border-slate-200 bg-slate-100/80',
      titleBadge: 'border-slate-200 bg-slate-200 text-slate-700',
      addButton: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
      archiveButton: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    }
  }

  if (tone === 'dls') {
    return {
      section: 'border-amber-200 bg-amber-50/30 shadow-amber-100',
      header: 'border-amber-200 bg-amber-50/80',
      body: 'bg-amber-50/20',
      card: 'border-amber-200 bg-white shadow-amber-100',
      focusedCard: 'ring-2 ring-amber-300 ring-offset-2 ring-offset-amber-50',
      cardHeader: 'border-amber-100 bg-amber-50/70',
      titleBadge: 'border-amber-200 bg-amber-100 text-amber-900',
      addButton: 'border-amber-200 bg-white text-amber-800 hover:bg-amber-50',
      archiveButton: 'border-amber-200 bg-white text-amber-800 hover:bg-amber-50',
    }
  }

  return {
    section: 'border-sky-200 bg-sky-50/30 shadow-sky-100',
    header: 'border-sky-200 bg-sky-50/80',
    body: 'bg-sky-50/20',
    card: 'border-sky-200 bg-white shadow-sky-100',
    focusedCard: 'ring-2 ring-sky-300 ring-offset-2 ring-offset-sky-50',
    cardHeader: 'border-sky-100 bg-sky-50/70',
    titleBadge: 'border-sky-200 bg-sky-100 text-sky-900',
    addButton: 'border-sky-200 bg-white text-sky-800 hover:bg-sky-50',
    archiveButton: 'border-sky-200 bg-white text-sky-800 hover:bg-sky-50',
  }
}

function NaksPermitEditor({
  title,
  permit,
  weldingTypes,
  materialGroups,
  canRemove,
  isFocused,
  archived,
  onChange,
  onArchive,
  onRestore,
  onRemove,
}: {
  title: string
  permit: WelderStampNaksPermit
  weldingTypes: readonly string[]
  materialGroups: readonly string[]
  canRemove: boolean
  isFocused: boolean
  archived: boolean
  onChange: (patch: Partial<WelderStampNaksPermit>) => void
  onArchive: () => void
  onRestore: () => void
  onRemove: () => void
}) {
  return (
    <PermitEditorFrame
      title={title}
      tone={archived ? 'archive' : 'naks'}
      permitId={permit.id}
      isFocused={isFocused}
      archived={archived}
      onArchive={onArchive}
      onRestore={onRestore}
      onRemove={onRemove}
      removeDisabled={!canRemove}
    >
      <PermitFields permit={permit} weldingTypes={weldingTypes} materialGroups={materialGroups} onChange={onChange} />
    </PermitEditorFrame>
  )
}

function DlsPermitEditor({
  title,
  permit,
  weldingTypes,
  materialGroups,
  isFocused,
  archived,
  onChange,
  onArchive,
  onRestore,
  onRemove,
}: {
  title: string
  permit: WelderStampDlsPermit
  weldingTypes: readonly string[]
  materialGroups: readonly string[]
  isFocused: boolean
  archived: boolean
  onChange: (patch: Partial<WelderStampDlsPermit>) => void
  onArchive: () => void
  onRestore: () => void
  onRemove: () => void
}) {
  return (
    <PermitEditorFrame
      title={title}
      tone={archived ? 'archive' : 'dls'}
      permitId={permit.id}
      isFocused={isFocused}
      archived={archived}
      onArchive={onArchive}
      onRestore={onRestore}
      onRemove={onRemove}
    >
      <label className="space-y-1.5 text-sm font-medium text-slate-700">
        <span>Номер ДЛС</span>
        <Input value={permit.number} onChange={(event) => onChange({ number: event.target.value })} placeholder="Например: ДЛС-01" />
      </label>
      <PermitFields permit={permit} weldingTypes={weldingTypes} materialGroups={materialGroups} onChange={onChange} />
    </PermitEditorFrame>
  )
}

function PermitEditorFrame({
  title,
  tone,
  permitId,
  isFocused,
  archived,
  onArchive,
  onRestore,
  onRemove,
  removeDisabled = false,
  children,
}: {
  title: string
  tone: PermitTone
  permitId: string
  isFocused: boolean
  archived: boolean
  onArchive: () => void
  onRestore: () => void
  onRemove: () => void
  removeDisabled?: boolean
  children: ReactNode
}) {
  const toneClassName = getPermitToneClassName(tone)

  return (
    <div
      tabIndex={-1}
      data-permit-editor-id={permitId}
      className={`overflow-hidden rounded-lg border shadow-sm outline-none transition-shadow duration-300 ${toneClassName.card} ${
        isFocused ? toneClassName.focusedCard : ''
      }`}
    >
      <div className={`flex items-center justify-between gap-3 border-b px-3 py-2.5 ${toneClassName.cardHeader}`}>
        <div className={`rounded-md border px-2 py-1 text-sm font-semibold ${toneClassName.titleBadge}`}>{title}</div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className={toneClassName.archiveButton} onClick={archived ? onRestore : onArchive}>
            {archived ? <RotateCcw className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
            {archived ? 'Из архива' : 'В архив'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRemove}
            disabled={removeDisabled}
            className="border-rose-200 text-rose-700 hover:bg-rose-50"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Удалить
          </Button>
        </div>
      </div>
      <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-4">{children}</div>
    </div>
  )
}

function PermitFields<T extends WelderStampNaksPermit | WelderStampDlsPermit>({
  permit,
  weldingTypes,
  materialGroups,
  onChange,
}: {
  permit: T
  weldingTypes: readonly string[]
  materialGroups: readonly string[]
  onChange: (patch: Partial<T>) => void
}) {
  const selectedWeldTypes = splitWelderStampWeldTypes(permit.weldType, weldingTypes)
  const selectedMaterialGroups = splitWelderStampMaterialGroups(permit.materialGroups, materialGroups)

  function toggleWeldType(type: string) {
    const nextTypes = selectedWeldTypes.includes(type)
      ? selectedWeldTypes.filter((value) => value !== type)
      : [...selectedWeldTypes, type]
    onChange({ weldType: nextTypes.join(', ') } as Partial<T>)
  }

  function toggleMaterialGroup(group: string) {
    const nextGroups = selectedMaterialGroups.includes(group)
      ? selectedMaterialGroups.filter((value) => value !== group)
      : [...selectedMaterialGroups, group]
    onChange({ materialGroups: nextGroups.join(', ') } as Partial<T>)
  }

  return (
    <>
      <div className="space-y-1.5 text-sm font-medium text-slate-700 md:col-span-2">
        <span>Способ сварки</span>
        <WelderStampWeldTypeSelector options={weldingTypes} selectedWeldTypes={selectedWeldTypes} onToggleWeldType={toggleWeldType} />
      </div>
      <div className="space-y-1.5 text-sm font-medium text-slate-700 md:col-span-2">
        <span>Группа материалов</span>
        <WelderStampWeldTypeSelector
          options={materialGroups}
          selectedWeldTypes={selectedMaterialGroups}
          onToggleWeldType={toggleMaterialGroup}
          emptyText="Добавьте группы в Настройки → Данные"
        />
      </div>
      <RangeField
        label="Диаметр"
        from={permit.diameterFrom}
        to={permit.diameterTo}
        fromPlaceholder="от"
        toPlaceholder="без ограничения"
        onChange={(patch) => onChange(patch as Partial<T>)}
        fromKey="diameterFrom"
        toKey="diameterTo"
      />
      <RangeField
        label="Толщина"
        from={permit.thicknessFrom}
        to={permit.thicknessTo}
        fromPlaceholder="от"
        toPlaceholder="без ограничения"
        onChange={(patch) => onChange(patch as Partial<T>)}
        fromKey="thicknessFrom"
        toKey="thicknessTo"
      />
      <DateField label="Срок от" value={permit.validFrom} onChange={(value) => onChange({ validFrom: value } as Partial<T>)} />
      <DateField label="Срок до" value={permit.validTo} onChange={(value) => onChange({ validTo: value } as Partial<T>)} />
      <label className="space-y-1.5 text-sm font-medium text-slate-700 xl:col-span-4">
        <span>Примечание</span>
        <Input value={permit.note} onChange={(event) => onChange({ note: event.target.value } as Partial<T>)} placeholder="Необязательно" />
      </label>
    </>
  )
}

function RangeField({
  label,
  from,
  to,
  fromPlaceholder,
  toPlaceholder,
  fromKey,
  toKey,
  onChange,
}: {
  label: string
  from: string
  to: string
  fromPlaceholder: string
  toPlaceholder: string
  fromKey: 'diameterFrom' | 'thicknessFrom'
  toKey: 'diameterTo' | 'thicknessTo'
  onChange: (patch: Partial<Pick<WelderStampNaksPermit, 'diameterFrom' | 'diameterTo' | 'thicknessFrom' | 'thicknessTo'>>) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1.5 text-sm font-medium text-slate-700">
        <span>{label} от</span>
        <Input type="text" inputMode="decimal" value={from} onChange={(event) => onChange({ [fromKey]: event.target.value })} placeholder={fromPlaceholder} />
      </label>
      <label className="space-y-1.5 text-sm font-medium text-slate-700">
        <span>{label} до</span>
        <Input type="text" inputMode="decimal" value={to} onChange={(event) => onChange({ [toKey]: event.target.value })} placeholder={toPlaceholder} />
      </label>
    </div>
  )
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1.5 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <Input type="date" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}
