import { LnkResultControlBar } from '@/components/lnk-result-control-bar'
import { getLnkSelectionResultRestrictionReason } from '@/components/lnk-result-selection-restrictions'
import { WorkflowResultOptionPicker } from '@/components/workflow-result-option-picker'
import { RequestDocumentCombobox } from '@/components/request-document-combobox'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { MIN_ALLOWED_DATE_ISO } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getEffectiveLnkResultDraftValueForRow,
  hasNonEmptyLnkResultDraftRows,
} from '@/lib/lnk-result-draft'
import {
  getLnkMethodByRequestKey,
  isFinalLnkResultValue,
} from '@/lib/lnk-status'
import { LNK_CUSTOM_RESULT_VALUE, LNK_METHODS, LNK_RESULT_OPTIONS } from '@/lib/report-config'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { Ref } from 'react'
import { useControlProcessSettings } from '@/lib/control-process-settings'
import { useSystemIndexSettings } from '@/lib/system-index-settings'
import { getSystemRuleSettingsHref } from '@/lib/system-rule-catalog'

type LnkResultMethod = (typeof LNK_METHODS)[number]

type LnkResultSettingsProps = {
  draft: LnkResultDraftState
  selectedMethods: LnkResultMethod[]
  selectedRows: WeldRow[]
  requestKey: string
  requestOptions: RequestDocumentIdentity[]
  requestLabel?: string
  saveCheckSettings: SaveCheckSettings
  controlDateInputRef?: Ref<HTMLInputElement>
  onMethodChange: (methodKey: WeldFieldKey | '') => void
  onControlDateChange: (controlDate: string) => void
  onDefaultResultChange: (result: string) => void
  onRequestChange: (request: RequestDocumentIdentity | null) => void
}

export function LnkResultSettings({
  draft,
  selectedMethods,
  selectedRows,
  requestKey,
  requestOptions,
  requestLabel = 'Заявка ЛНК',
  saveCheckSettings,
  controlDateInputRef,
  onMethodChange,
  onControlDateChange,
  onDefaultResultChange,
  onRequestChange,
}: LnkResultSettingsProps) {
  const processSettings = useControlProcessSettings()
  const systemIndexSettings = useSystemIndexSettings()
  const methodCode = getLnkMethodByRequestKey(draft.methodKey)?.code ?? ''
  const getDisabledReason = (result: string) => getLnkSelectionResultRestrictionReason(selectedRows, [methodCode], result, {
    systemIndexSettings,
    pvkGoodOnly: processSettings.pvkGoodOnly,
    layeredControlRowIds: draft.layeredControlRowIds,
  }) || (!methodCode ? 'Выберите метод контроля.' : selectedRows.length === 0 ? 'Выберите стыки.' : undefined)
  const hasNonEmptyRows = hasNonEmptyLnkResultDraftRows(selectedRows, draft)
  const vikBeforeOtherHint = getVikBeforeOtherHint(selectedRows, draft, saveCheckSettings)
  const disabledCheckHint = vikBeforeOtherHint && !vikBeforeOtherHint.blocking ? vikBeforeOtherHint.message : ''
  return (
    <LnkResultControlBar
      methodControl={(
        <label className="block space-y-1.5 text-sm">
          <span className="text-[13px] font-medium leading-none text-slate-700">Метод контроля</span>
          <Select
            aria-label="Метод контроля"
            value={draft.methodKey}
            onChange={(event) => onMethodChange(event.target.value as WeldFieldKey)}
            disabled={selectedMethods.length === 0}
            className={`h-9 bg-white ${!draft.methodKey && selectedMethods.length > 0 ? 'text-slate-700' : ''}`}
          >
            <option value="">Выберите метод</option>
            {selectedMethods.map((method) => (
              <option key={method.requestKey} value={method.requestKey}>
                {method.code}
              </option>
            ))}
          </Select>
        </label>
      )}
      dateControl={(
        <label className="block space-y-1.5 text-sm">
          <span className="text-[13px] font-medium leading-none text-slate-700">Дата контроля</span>
          <Input
            ref={controlDateInputRef}
            type="date"
            min={MIN_ALLOWED_DATE_ISO}
            value={draft.controlDate}
            disabled={!hasNonEmptyRows}
            onChange={(event) => onControlDateChange(event.target.value)}
            className="h-9 bg-white"
          />
        </label>
      )}
      resultControl={(
        <div className="space-y-1.5 text-sm">
          <WorkflowResultOptionPicker
            label="Результат для всех выбранных"
            compact
            reserveHelpSpace
            restrictionHelpLabel="Правило СП-07"
            helperText={!draft.result || draft.result === LNK_CUSTOM_RESULT_VALUE ? draft.result ? 'Разные результаты' : 'Выберите результат' : undefined}
            value={draft.result}
            options={LNK_RESULT_OPTIONS}
            restrictionHelpHref={methodCode && selectedRows.length ? getSystemRuleSettingsHref('СП-07') : undefined}
            getDisabledReason={getDisabledReason}
            onChange={onDefaultResultChange}
          />
        </div>
      )}
      requestControl={(
        <label className="block min-w-0 space-y-1.5 text-sm">
          <span className="text-[13px] font-medium leading-none text-slate-700">{requestLabel}</span>
          <RequestDocumentCombobox
            ariaLabel={requestLabel}
            value={requestKey}
            options={requestOptions}
            onChange={onRequestChange}
          />
        </label>
      )}
      hint={(
        <span title={disabledCheckHint || undefined}>
          {disabledCheckHint ? (
            <><span className="font-semibold text-amber-800">Проверка выключена:</span> {disabledCheckHint}</>
          ) : null}
        </span>
      )}
    />
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
    const nextResult = getEffectiveLnkResultDraftValueForRow(row, draft)
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
