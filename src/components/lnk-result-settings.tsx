import { LnkResultControlBar } from '@/components/lnk-result-control-bar'
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
  getLnkResultRepairForbiddenSummary,
  isLnkRepairForbidden,
} from '@/lib/lnk-result-rules'
import {
  getLnkMethodByRequestKey,
  isFinalLnkResultValue,
} from '@/lib/lnk-status'
import { LNK_CUSTOM_RESULT_VALUE, LNK_METHODS, LNK_RESULT_OPTIONS } from '@/lib/report-config'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'
import type { WeldFieldKey } from '@/lib/weld-fields'

type LnkResultMethod = (typeof LNK_METHODS)[number]

type LnkResultSettingsProps = {
  draft: LnkResultDraftState
  selectedMethods: LnkResultMethod[]
  selectedRows: WeldRow[]
  requestKey: string
  requestOptions: RequestDocumentIdentity[]
  requestLabel?: string
  saveCheckSettings: SaveCheckSettings
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
  onMethodChange,
  onControlDateChange,
  onDefaultResultChange,
  onRequestChange,
}: LnkResultSettingsProps) {
  const hasNonEmptyRows = hasNonEmptyLnkResultDraftRows(selectedRows, draft, saveCheckSettings)
  const hasRepairForbiddenRows = saveCheckSettings.lnkResultRepairRules && selectedRows.some(isLnkRepairForbidden)
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
        <label className="block space-y-1.5 text-sm">
          <span className="text-[13px] font-medium leading-none text-slate-700">Результат для всех выбранных</span>
          <Select
            aria-label="Результат для всех выбранных"
            value={draft.result}
            onChange={(event) => onDefaultResultChange(event.target.value)}
            className="h-9 bg-white"
          >
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
        </label>
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
          {hasRepairForbiddenRows ? (
            <>Ремонт недоступен: {getLnkResultRepairForbiddenSummary(selectedRows)}.</>
          ) : disabledCheckHint ? (
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
