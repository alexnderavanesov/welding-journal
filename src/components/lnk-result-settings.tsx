import { DialogHelpNote } from '@/components/dialog-help-note'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { ResultSettingsCard } from '@/components/result-settings-card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { MIN_ALLOWED_DATE_ISO } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getEffectiveLnkResultDraftValueForRow,
  hasNonEmptyLnkResultDraftRows,
} from '@/lib/lnk-result-draft'
import {
  getLnkResultRepairForbiddenSummary,
  isLnkRepairForbidden,
} from '@/lib/lnk-result-rules'
import {
  getLnkMethodByRequestKey,
  isFinalLnkResultValue,
} from '@/lib/lnk-status'
import { LNK_CUSTOM_RESULT_VALUE, LNK_METHODS, LNK_RESULT_OPTIONS } from '@/lib/report-config'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { SystemDocumentSplitPreview } from '@/components/system-document-split-preview'

type LnkResultMethod = (typeof LNK_METHODS)[number]

type LnkResultSettingsProps = {
  draft: LnkResultDraftState
  selectedMethods: LnkResultMethod[]
  selectedRows: WeldRow[]
  nextConclusionName: string
  creationPlan: SystemDocumentCreationPlan | null
  saveCheckSettings: SaveCheckSettings
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
  creationPlan,
  saveCheckSettings,
  onMethodChange,
  onControlDateChange,
  onDefaultResultChange,
  onConclusionNamingChange,
}: LnkResultSettingsProps) {
  const hasNonEmptyRows = hasNonEmptyLnkResultDraftRows(selectedRows, draft, saveCheckSettings)
  const hasRepairForbiddenRows = saveCheckSettings.lnkResultRepairRules && selectedRows.some(isLnkRepairForbidden)
  const vikBeforeOtherHint = getVikBeforeOtherHint(selectedRows, draft, saveCheckSettings)
  const disabledCheckHint = vikBeforeOtherHint && !vikBeforeOtherHint.blocking ? vikBeforeOtherHint.message : ''
  const selectedMethod = getLnkMethodByRequestKey(draft.methodKey)
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
              min={MIN_ALLOWED_DATE_ISO}
              value={draft.controlDate}
              disabled={!hasNonEmptyRows}
              onChange={(event) => onControlDateChange(event.target.value)}
            />
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Результат для всех выбранных</span>
            <Select value={draft.result} onChange={(event) => onDefaultResultChange(event.target.value)}>
              <option value="">Выберите результат</option>
              <option value={LNK_CUSTOM_RESULT_VALUE} disabled>
                Разные результаты
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
        {disabledCheckHint ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            <span className="font-semibold">Проверка выключена:</span> {disabledCheckHint}
          </div>
        ) : null}
      </ResultSettingsCard>

      <ResultSettingsCard title="2. Заключение" muted={!hasNonEmptyRows}>
        {selectedMethod && creationPlan ? (
          <>
            <RequestNamingControls
              naming={draft.conclusionNaming}
              systemName={nextConclusionName}
              systemDocumentCount={creationPlan.groups.length}
              label="Наименование заключения"
              placeholder="Введите наименование заключения"
              disabled={!hasNonEmptyRows}
              bufferCustomNameInput
              hideCustomNameInput={draft.conclusionNaming.mode === 'custom' && creationPlan.groups.length > 1}
              onChange={onConclusionNamingChange}
            />
            <div className="mt-3">
              <SystemDocumentSplitPreview
                plan={creationPlan}
                naming={draft.conclusionNaming}
                disabled={!hasNonEmptyRows}
                onNamingChange={onConclusionNamingChange}
              />
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-sm font-semibold text-slate-700">Сначала выберите метод контроля</div>
            <div className="mt-1 text-xs leading-5 text-slate-500">
              После выбора появятся наименование заключения, правило разделения и количество документов для этого вида НК.
            </div>
          </div>
        )}
      </ResultSettingsCard>

      <DialogHelpNote>
        Результат заменит статус «ожидает НК» в выбранном виде контроля. Наименование заключения попадет в
        соответствующий столбец раздела «Заключения». Уже внесенные результаты изменяются только через
        «Все результаты».
      </DialogHelpNote>
    </section>
  )
}

function getVikBeforeOtherHint(
  selectedRows: WeldRow[],
  draft: LnkResultDraftState,
  saveCheckSettings: SaveCheckSettings,
) {
  const method = getLnkMethodByRequestKey(draft.methodKey)
  if (!method || method.code === 'ВИК') return null

  const rowsWithoutVik = selectedRows.filter((row) => {
    const nextResult = getEffectiveLnkResultDraftValueForRow(row, draft, saveCheckSettings)
    return isFinalLnkResultValue(nextResult) && !isFinalLnkResultValue(row.vikResult)
  })
  if (rowsWithoutVik.length === 0) return null

  const jointList = rowsWithoutVik
    .slice(0, 3)
    .map((row) => String(row.joint ?? `ID ${row.id}`).trim())
    .filter(Boolean)
    .join(', ')
  const tail = rowsWithoutVik.length > 3 ? ` и еще ${rowsWithoutVik.length - 3}` : ''
  const baseMessage = `Для ${method.code} сначала нужен результат ВИК: ${jointList}${tail}.`
  if (saveCheckSettings.lnkResultVikRequiredBeforeOther) return { message: baseMessage, blocking: true }
  return {
    message: `${baseMessage} Галочка “ВИК обязателен перед другими НК” выключена в настройках, поэтому сохранение разрешено.`,
    blocking: false,
  }
}
