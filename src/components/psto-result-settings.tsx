import type { Dispatch, SetStateAction } from 'react'

import { DialogHelpNote } from '@/components/dialog-help-note'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { ResultSettingsCard } from '@/components/result-settings-card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { MIN_ALLOWED_DATE_ISO } from '@/lib/date-format'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import { SystemDocumentSplitPreview } from '@/components/system-document-split-preview'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import type { SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'

type PstoResultSettingsProps = {
  draft: PstoResultDraftState
  nextDiagramName: string
  creationPlan: SystemDocumentCreationPlan
  saveCheckSettings: SaveCheckSettings
  onDraftChange: Dispatch<SetStateAction<PstoResultDraftState>>
}

export function PstoResultSettings({
  draft,
  nextDiagramName,
  creationPlan,
  saveCheckSettings,
  onDraftChange,
}: PstoResultSettingsProps) {
  return (
    <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
      <ResultSettingsCard title="1. Результат ПСТО">
        <div className="grid grid-cols-1 gap-3">
          <label className="block space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Дата ПСТО</span>
            <Input
              type="date"
              min={MIN_ALLOWED_DATE_ISO}
              value={draft.pstoDate}
              onChange={(event) => onDraftChange((current) => ({ ...current, pstoDate: event.target.value }))}
            />
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Результат</span>
            <Select value={draft.result} onChange={(event) => onDraftChange((current) => ({ ...current, result: event.target.value }))}>
              <option value="">Выберите результат</option>
              <option value="проведено">проведено</option>
            </Select>
          </label>
        </div>
      </ResultSettingsCard>

      <ResultSettingsCard>
        <RequestNamingControls
          naming={draft.diagramNaming}
          systemName={nextDiagramName}
          systemDocumentCount={creationPlan.groups.length}
          label="Диаграмма термообработки"
          placeholder="Введите наименование диаграммы"
          hideCustomNameInput={draft.diagramNaming.mode === 'custom' && creationPlan.groups.length > 1}
          onChange={(diagramNaming) => onDraftChange((current) => ({ ...current, diagramNaming }))}
        />
        <div className="mt-3">
          <SystemDocumentSplitPreview
            plan={creationPlan}
            naming={draft.diagramNaming}
            onNamingChange={(diagramNaming) => onDraftChange((current) => ({ ...current, diagramNaming }))}
          />
        </div>
      </ResultSettingsCard>

      <DialogHelpNote>
        Результат «проведено» заполнит дату ПСТО и диаграмму термообработки. Изменение или удаление уже внесенного
        результата выполняется через «Редактировать результаты».
      </DialogHelpNote>
    </section>
  )
}
