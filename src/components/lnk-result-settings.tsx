import { DialogHelpNote } from '@/components/dialog-help-note'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { ResultSettingsCard } from '@/components/result-settings-card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { WeldRow } from '@/lib/dispatcher-types'
import { hasNonEmptyLnkResultDraftRows } from '@/lib/lnk-result-draft'
import {
  getLnkResultRepairForbiddenSummary,
  isLnkRepairForbidden,
} from '@/lib/lnk-result-rules'
import { LNK_CUSTOM_RESULT_VALUE, LNK_METHODS, LNK_RESULT_OPTIONS } from '@/lib/report-config'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { WeldFieldKey } from '@/lib/weld-fields'

type LnkResultMethod = (typeof LNK_METHODS)[number]

type LnkResultSettingsProps = {
  draft: LnkResultDraftState
  selectedMethods: LnkResultMethod[]
  selectedRows: WeldRow[]
  nextConclusionName: string
  onMethodChange: (methodKey: WeldFieldKey | '') => void
  onControlDateChange: (controlDate: string) => void
  onDefaultResultChange: (result: string) => void
  onConclusionNamingChange: (conclusionNaming: RequestNamingState) => void
}

export function LnkResultSettings({
  draft,
  selectedMethods,
  selectedRows,
  nextConclusionName,
  onMethodChange,
  onControlDateChange,
  onDefaultResultChange,
  onConclusionNamingChange,
}: LnkResultSettingsProps) {
  const hasNonEmptyRows = hasNonEmptyLnkResultDraftRows(selectedRows, draft)
  const hasRepairForbiddenRows = selectedRows.some(isLnkRepairForbidden)

  return (
    <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
      <ResultSettingsCard title="1. Метод и результат">
        <div className="grid grid-cols-1 gap-3">
          <label className="block space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Метод контроля</span>
            <Select
              value={draft.methodKey}
              onChange={(event) => onMethodChange(event.target.value as WeldFieldKey)}
              disabled={selectedMethods.length === 0}
              className={!draft.methodKey && selectedMethods.length > 0 ? 'text-slate-700' : undefined}
            >
              <option value="">Выберите метод</option>
              {selectedMethods.map((method) => (
                <option key={method.requestKey} value={method.requestKey}>
                  {method.code}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Дата контроля</span>
            <Input
              type="date"
              value={draft.controlDate}
              disabled={!hasNonEmptyRows}
              onChange={(event) => onControlDateChange(event.target.value)}
            />
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Результат по умолчанию</span>
            <Select value={draft.result} onChange={(event) => onDefaultResultChange(event.target.value)}>
              <option value="">Выберите результат</option>
              <option value={LNK_CUSTOM_RESULT_VALUE} disabled>
                пользовательский
              </option>
              {LNK_RESULT_OPTIONS.map((option) => (
                <option key={option} value={option} disabled={option === 'ремонт' && hasRepairForbiddenRows}>
                  {option}
                </option>
              ))}
            </Select>
            {hasRepairForbiddenRows ? (
              <span className="block text-xs text-slate-500">
                Ремонт недоступен: {getLnkResultRepairForbiddenSummary(selectedRows)}.
              </span>
            ) : null}
          </label>
        </div>
      </ResultSettingsCard>

      <ResultSettingsCard title="2. Заключение" muted={!hasNonEmptyRows}>
        <RequestNamingControls
          naming={draft.conclusionNaming}
          systemName={nextConclusionName}
          label="Наименование заключения"
          placeholder="Введите наименование заключения"
          disabled={!hasNonEmptyRows}
          onChange={onConclusionNamingChange}
        />
      </ResultSettingsCard>

      <DialogHelpNote>
        Результат заменит статус «ожидает НК» в выбранном виде контроля. Наименование заключения попадет в
        соответствующий столбец раздела «Заключения». Уже внесенные результаты изменяются только через
        «Редактировать результаты».
      </DialogHelpNote>
    </section>
  )
}
