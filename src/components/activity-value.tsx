import { useState } from 'react'
import { activityFieldLabel, activityValueLabel } from '@/lib/activity-labels'
import { isTechnicalActivityField } from '@/lib/activity-presentation'
import type { AuditValue } from '@/lib/audit-value'
import { Button } from './ui/button'

const PAGE_SIZE = 20
const TEXT_SIZE = 4000

/** Bounded DOM even for old, very large document snapshots. Nested data mounts on demand. */
export function ActivityValue({ entity, field, value, depth = 0 }: { entity: string; field: string; value?: AuditValue; depth?: number }) {
  const [page, setPage] = useState(0)
  const labelValue = (key: string, item: AuditValue | undefined) => activityValueLabel(entity, key, item)
  if (entity === 'account' && field === 'permissions') return <PagedText text={activityValueLabel(entity, field, value)} />
  if (value && typeof value === 'object') {
    const array = Array.isArray(value)
    const keys = array ? null : Object.keys(value).filter(key => !isTechnicalActivityField(key) && activityFieldLabel(entity, key) !== key)
    const length = array ? value.length : keys!.length
    const offset = Math.min(page * PAGE_SIZE, Math.max(0, length - 1))
    if (!length) return <span className="text-slate-400">{!array && Object.keys(value).length ? 'Дополнительные сведения' : 'Пусто'}</span>
    // Audit values are JSON, but cap nested expansion for malformed/legacy structures.
    if (depth >= 6) return <span className="text-slate-500">Дополнительные сведения</span>
    return <div className="space-y-2">
      <ul className="space-y-2">
        {Array.from({ length: Math.min(PAGE_SIZE, length - offset) }, (_, i) => {
          const index = offset + i, key = keys?.[index] ?? String(index)
          const item = array ? value[index] : (value as Record<string, AuditValue>)[key]
          const label = array ? field === 'cycleSequences' ? 'Цикл' : 'Позиция' : activityFieldLabel(entity, key)
          const primitive = item == null || typeof item !== 'object'
          return <li key={key} className="break-words">
            {primitive ? <>{array ? null : <span className="font-medium">{label}: </span>}<PagedText text={labelValue(array ? field : key, item)} /></>
              : <ExpandableValue label={array ? `${label} ${index + 1}${positionSummary(field, item)}` : label}>
                  <ActivityValue entity={field === 'sourcePositions' ? 'document_position' : entity} field={key} value={item} depth={depth + 1} />
                </ExpandableValue>}
          </li>
        })}
      </ul>
      {length > PAGE_SIZE ? <ValuePager page={page} length={length} size={PAGE_SIZE} onChange={setPage} /> : null}
    </div>
  }
  return <PagedText text={labelValue(field, value)} />
}
function positionSummary(field: string, value: AuditValue) {
  if (field !== 'sourcePositions' || !value || typeof value !== 'object' || Array.isArray(value)) return ''
  const parts = [typeof value.methodCode === 'string' ? value.methodCode : '',
    typeof value.sequence === 'number' ? `цикл ${value.sequence}` : ''].filter(Boolean).join(' · ')
  return parts ? ` · ${parts}` : ''
}
function ExpandableValue({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-slate-600">{label}</summary>
    {open ? <div className="mt-2 border-l border-slate-200 pl-3">{children}</div> : null}
  </details>
}
function PagedText({ text }: { text: string }) {
  const [page, setPage] = useState(0)
  if (text.length <= TEXT_SIZE) return <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</span>
  return <div className="space-y-2"><span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{text.slice(page * TEXT_SIZE, (page + 1) * TEXT_SIZE)}</span>
    <ValuePager page={page} length={text.length} size={TEXT_SIZE} onChange={setPage} text /></div>
}
function ValuePager({ page, length, size, onChange, text = false }: { page: number; length: number; size: number; onChange: (page: number) => void; text?: boolean }) {
  return <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
    <span>{text ? 'Символы' : 'Элементы'} {page * size + 1}–{Math.min((page + 1) * size, length)} из {length}</span>
    <Button variant="ghost" size="sm" disabled={!page} onClick={() => onChange(page - 1)} aria-label="Предыдущая часть значения">←</Button>
    <Button variant="ghost" size="sm" disabled={(page + 1) * size >= length} onClick={() => onChange(page + 1)} aria-label="Следующая часть значения">→</Button>
  </div>
}
