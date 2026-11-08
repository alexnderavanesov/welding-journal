import { lazy, Suspense, useState, type Dispatch, type SetStateAction, type Ref } from 'react'
import type { WeldDraft } from '@/lib/dispatcher-types'
import type { WeldInput } from '@/lib/weld-fields'
import { isRevisionNotActual } from '@/lib/revision-actuality'
import { Select } from './ui/select'

const ChainActualityDialog = lazy(() => import('./chain-actuality-dialog').then(module => ({ default: module.ChainActualityDialog })))

/** Confirmation changes only the form draft; the journal save applies the
 * complete chain in the same transaction as the rest of the card. */
export function WeldFormActualityField({ draft, setDraft, inputRef }: { draft: WeldInput; setDraft: Dispatch<SetStateAction<WeldInput>>; inputRef?: Ref<HTMLSelectElement> }) {
  const [pending, setPending] = useState<boolean | null>(null)
  return <>
    <Select ref={inputRef} aria-label="Актуальность по ИЗМу" value={isRevisionNotActual(draft.revisionActuality) ? 'inactive' : 'active'}
      disabled={!draft.id} title={!draft.id ? 'Сначала сохраните новый стык' : undefined}
      onChange={event => setPending(event.target.value === 'active')}>
      <option value="active">Актуален</option>
      <option value="inactive">Не актуален</option>
    </Select>
    {draft.id && pending !== null ? <Suspense fallback={<p className="text-sm text-slate-500">Проверяем цепочку…</p>}>
      <ChainActualityDialog rowId={Number(draft.id)} active={pending} onClose={() => setPending(null)} onConfirm={confirmation => {
        setDraft(current => ({ ...current, revisionActuality: confirmation.active ? null : 'не актуален', chainActualityConfirmation: confirmation } as WeldDraft))
        setPending(null)
      }} />
    </Suspense> : null}
  </>
}
