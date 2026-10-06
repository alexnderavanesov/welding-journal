import type { ProgramApprovalOption } from '@/lib/program-approval-actions'

export function ProgramApprovalActions({ approve, revoke, disabled, draft, onAction }: {
  approve: ProgramApprovalOption[]; revoke: ProgramApprovalOption[]; disabled: boolean; draft: boolean
  onAction: (action: 'approve' | 'revoke', entries: ProgramApprovalOption[]) => void
}) {
  if (!approve.length && !revoke.length) return null
  const count = (items: ProgramApprovalOption[]) => new Set(items.map(item => item.rowId)).size
  const groups = (['approve', 'revoke'] as const).flatMap(action => {
    const entries = action === 'approve' ? approve : revoke
    return ['combination', 'common', 'pvk'].flatMap(kind => {
      const items = entries.filter(item => kind === 'combination' ? item.duplicate : !item.duplicate && item.kind === kind)
      if (!items.length) return []
      const label = action === 'approve' ? kind === 'combination' ? 'Согласовать сочетание' : `Согласовать превышение ${kind === 'pvk' ? 'ПВК' : 'РК - УЗК'}`
        : kind === 'combination' ? 'Снять согласование сочетания' : `Снять согласование ${kind === 'pvk' ? 'ПВК' : 'РК - УЗК'}`
      return [{ id: `${action}:${kind}`, action, items, label }]
    })
  })
  const style = 'h-6 max-w-full rounded-md border border-sky-200 bg-white px-2 py-0 text-xs text-sky-800 disabled:opacity-40'
  const title = draft ? 'Сначала сохраните или отмените черновик назначений. Согласование применяется к сохранённому контролю.' : 'Меняет только согласование. Назначения и документы остаются без изменений.'
  return groups.length > 1 ? <select aria-label="Согласование выбранных стыков" title={title} disabled={disabled || draft} value="" className={style} onChange={event => { const group = groups.find(item => item.id === event.target.value); if (group) onAction(group.action, group.items) }}>
    <option value="" disabled>Согласование · {count([...approve, ...revoke])}</option>
    {groups.map(group => <option key={group.id} value={group.id}>{group.label} · {count(group.items)}</option>)}
  </select> : <button type="button" title={title} disabled={disabled || draft} className={style} onClick={() => onAction(groups[0].action, groups[0].items)}>{groups[0].label} · {count(groups[0].items)}</button>
}
