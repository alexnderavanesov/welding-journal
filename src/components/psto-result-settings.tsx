import type { Dispatch, SetStateAction } from 'react'

import { DialogHelpNote } from '@/components/dialog-help-note'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { PSTO_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import type { PstoResultDraftState } from '@/lib/report-draft-state'

type PstoResultSettingsProps = {
  draft: PstoResultDraftState
  nextDiagramName: string
  onDraftChange: Dispatch<SetStateAction<PstoResultDraftState>>
}

export function PstoResultSettings({ draft, nextDiagramName, onDraftChange }: PstoResultSettingsProps) {
  return (
    <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">1. Результат ПСТО</h3>
        <div className="grid grid-cols-1 gap-3">
          <label className="block space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Дата ПСТО</span>
            <Input
              type="date"
              value={draft.pstoDate}
              disabled={draft.result === PSTO_EMPTY_RESULT_VALUE}
              onChange={(event) => onDraftChange((current) => ({ ...current, pstoDate: event.target.value }))}
            />
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Результат</span>
            <Select value={draft.result} onChange={(event) => onDraftChange((current) => ({ ...current, result: event.target.value }))}>
              <option value="">Выберите результат</option>
              <option value="проведено">проведено</option>
              <option value={PSTO_EMPTY_RESULT_VALUE}>аннулировать</option>
            </Select>
          </label>
        </div>
      </div>

      <div className={`rounded-md border border-slate-200 p-3 ${draft.result === PSTO_EMPTY_RESULT_VALUE ? 'bg-slate-50 opacity-60' : 'bg-white'}`}>
        <RequestNamingControls
          naming={draft.diagramNaming}
          systemName={nextDiagramName}
          label="Диаграмма термообработки"
          placeholder="Введите наименование диаграммы"
          disabled={draft.result === PSTO_EMPTY_RESULT_VALUE}
          onChange={(diagramNaming) => onDraftChange((current) => ({ ...current, diagramNaming }))}
        />
      </div>

      <DialogHelpNote>
        Результат «проведено» заполнит дату ПСТО и диаграмму термообработки. Если выбрать «аннулировать», результат,
        дата и диаграмма очистятся, заявка ПСТО останется.
      </DialogHelpNote>
    </section>
  )
}
