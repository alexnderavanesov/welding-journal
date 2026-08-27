import type { Dispatch, SetStateAction } from 'react'

import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { MIN_ALLOWED_DATE_ISO } from '@/lib/date-format'
import type { PstoResultDraftState } from '@/lib/report-draft-state'

type PstoResultSettingsProps = {
  draft: PstoResultDraftState
  onDraftChange: Dispatch<SetStateAction<PstoResultDraftState>>
}

export function PstoResultSettings({ draft, onDraftChange }: PstoResultSettingsProps) {
  return (
    <section className="shrink-0 border-b border-slate-200 bg-slate-50/40 px-5 py-2.5">
      <div className="grid gap-3 xl:grid-cols-[190px_minmax(260px,420px)] xl:items-start">
        <label className="block space-y-1.5 text-sm">
          <span className="text-[13px] font-medium leading-none text-slate-700">Дата ПСТО</span>
          <Input
            type="date"
            min={MIN_ALLOWED_DATE_ISO}
            value={draft.pstoDate}
            onChange={(event) => onDraftChange((current) => ({ ...current, pstoDate: event.target.value }))}
            className="h-9 bg-white"
          />
        </label>

        <label className="block space-y-1.5 text-sm">
          <span className="text-[13px] font-medium leading-none text-slate-700">Результат</span>
          <Select
            value={draft.result}
            onChange={(event) => onDraftChange((current) => ({ ...current, result: event.target.value }))}
            className="h-9 bg-white"
          >
            <option value="">Выберите результат</option>
            <option value="проведено">проведено</option>
          </Select>
        </label>
      </div>
    </section>
  )
}
