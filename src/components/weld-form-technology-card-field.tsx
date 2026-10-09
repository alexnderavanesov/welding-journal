import { useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { FieldHelp } from '@/components/field-help'
import { useDataListSettings } from '@/lib/data-list-settings'
import { useTechnologyCardSnapshot } from '@/lib/technology-card-query'
import { createTechnologyCardReview } from '@/lib/technology-card-review'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export function WeldFormTechnologyCardField({ draft, setDraft, fieldRefs }: {
  draft: WeldInput; setDraft: Dispatch<SetStateAction<WeldInput>>;
  fieldRefs: MutableRefObject<Partial<Record<WeldFieldKey, HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null>>>
}) {
  const snapshot = useTechnologyCardSnapshot()
  const settings = useDataListSettings()
  const review = useMemo(() => snapshot.data ? createTechnologyCardReview(snapshot.data, settings) : null, [snapshot.data, settings])
  const state = review?.(draft)
  const summary = snapshot.isError ? 'Реестр недоступен' : !state ? 'Загрузка ТК…' : {
    valid: 'ТК подходит', unknown: 'ТК нет в реестре', mismatch: 'Проверьте ТК', incomplete: 'Не хватает данных',
    none: 'Нет подходящих ТК', single: 'Подходит 1 ТК', multiple: `Подходят: ${state.cards.length}`,
  }[state.status]
  return <div className="min-w-0 space-y-1" data-testid="technology-card-field">
    <Input aria-label="Номер технологической карты" ref={element => { fieldRefs.current.technologyCardNumber = element }}
      placeholder="Название ТК, например ТК №12" value={String(draft.technologyCardNumber ?? '')}
      onChange={event => setDraft(current => ({ ...current, technologyCardNumber: event.target.value || null, technologyCardSelection: undefined }))} />
    <div className="flex h-7 min-w-0 items-center gap-1.5">
      <span role={snapshot.isError ? 'alert' : 'status'} className={`min-w-0 flex-1 truncate text-xs ${snapshot.isError ? 'text-red-700' : state?.status === 'valid' ? 'text-emerald-700' : 'text-slate-500'}`}>{summary}</span>
      <FieldHelp label="Подбор технологической карты">
        <p>{snapshot.isError ? 'Не удалось загрузить реестр ТК. Значение поля сохранено; повторите загрузку кнопкой рядом.' : state?.message ?? 'Загружаем реестр технологических карт.'}</p>
        <p className="mt-2 text-slate-300">Автоматически — при первом сохранении ранее пустой даты сварки, если ТК не заполнена и подходит ровно одна карта. В уже заваренном стыке выберите ТК вручную и сохраните.</p>
      </FieldHelp>
      <Select aria-label="Выбрать подходящую ТК" className="h-7 w-28 shrink-0 rounded border-slate-200 px-1.5 py-0 text-xs shadow-none" disabled={!state?.cards.length || snapshot.isFetching || snapshot.isError} value="" onChange={event => {
        const card = state?.cards.find(item => item.id === Number(event.target.value))
      if (card) setDraft(current => ({ ...current, technologyCardNumber: card.name, technologyCardSelection: { id: card.id, revision: card.revision } }))
      }}><option value="">Выбрать ТК…</option>{state?.cards.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</Select>
      <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0 rounded" aria-label="Обновить список ТК" title="Обновить список ТК" disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()}><RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${snapshot.isFetching ? 'animate-spin' : ''}`} /></Button>
    </div>
  </div>
}
