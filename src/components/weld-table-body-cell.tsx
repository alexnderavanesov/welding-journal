import { WeldTableValue } from '@/components/weld-table-value'
import type { WeldRow } from '@/lib/dispatcher-types'
import { bodyCellClass } from '@/lib/weld-table-utils'
import { DATE_TIME_WELD_FIELD_KEYS, getFinalStatusErrorReason, type WeldField, type WeldFieldKey } from '@/lib/weld-fields'
import { formatDateTimeWithSeconds } from '@/lib/weld-table-formatting'
import { formatFinalStatusDisplay } from '@/lib/weld-status'
import { getStickyWeldTableFieldStyle, isStickyWeldTableField } from '@/lib/weld-table-sticky-columns'
import {
  GENERATED_DOCUMENT_PROFILES,
} from '@/lib/generated-document-types'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import {
  getSystemDocumentProfile,
  getSystemDocumentTypeForField,
} from '@/lib/system-document-types'
import {
  getSystemDocumentTemplateIdForField,
  type SystemDocumentTemplateId,
} from '@/lib/system-document-template-types'

const WELDING_JOURNAL_FIELD_TOOLTIP =
  'Данные сварочного журнала. Чтобы изменить значение, откройте карточку стыка в разделе «Сварочный журнал».'
const WDI_TOOLTIP =
  'Значение WDI хранится в сварочном журнале. В пользовательском режиме оно меняется в карточке стыка, а в системном рассчитывается автоматически по текущему правилу проекта.'
const OFFICIALITY_STATUS_TOOLTIP =
  'Статус официальности стыка. Меняется действием «Сменить официальность» в разделе «ЛНК» и не редактируется напрямую.'
const FINAL_STATUS_TOOLTIP =
  'Итоговый статус рассчитывается автоматически по сварке, назначениям, заявкам, результатам контроля, ПСТО и цепочке стыка.'
const LNK_REQUEST_TOOLTIP =
  'Данные заявки ЛНК. Заполняются при создании или изменении заявки в разделе «ЛНК» и не редактируются напрямую в таблице.'
const LNK_RESULT_TOOLTIP =
  'Данные результата или заключения ЛНК. Заполняются при добавлении или редактировании результата в разделе «ЛНК».'
const PSTO_REQUEST_TOOLTIP =
  'Данные заявки ПСТО. Заполняются при создании или изменении заявки в разделе «ПСТО» и не редактируются напрямую в таблице.'
const PSTO_RESULT_TOOLTIP =
  'Данные результата ПСТО. Заполняются при добавлении или редактировании результата в разделе «ПСТО».'
const RECORD_NUMBER_TOOLTIP =
  'Системное поле: номер записи присваивается автоматически и не редактируется пользователем.'
const DISPATCHER_TASKS_TOOLTIP =
  'Системное поле: показывает активные коды задач диспетчера для этого стыка. Значение обновляется автоматически.'
const JSR_DOCUMENT_TOOLTIP =
  'Системное поле: показывает ЖСР, в который включен стык. Документы не изменяют данные, проверки, статусы или задачи диспетчера.'
const CHECKLIST_DOCUMENT_TOOLTIP =
  'Системное поле: показывает Чек-лист, в который включен стык. Документы не изменяют данные, проверки, статусы или задачи диспетчера.'
const ZNI_DOCUMENT_TOOLTIP =
  'Системное поле: показывает ЗНИ, в который включен стык. Документы не изменяют данные, проверки, статусы или задачи диспетчера.'
const PROFILE_TIMESTAMP_TOOLTIPS: Partial<Record<WeldFieldKey, string>> = {
  createdAt: 'Дата и время первого внесения стыка в сварочный журнал. Устанавливается автоматически и не изменяется.',
  weldingUpdatedAt: 'Дата и время последнего изменения данных сварочного журнала. Устанавливается автоматически.',
  lnkCreatedAt: 'Дата и время первого появления стыка в ЛНК. Устанавливается автоматически и не изменяется.',
  lnkUpdatedAt: 'Дата и время последнего изменения данных ЛНК. Устанавливается автоматически.',
  pstoCreatedAt: 'Дата и время первого появления стыка в ПСТО. Устанавливается автоматически и не изменяется.',
  pstoUpdatedAt: 'Дата и время последнего изменения данных ПСТО. Устанавливается автоматически.',
}
const LNK_REQUEST_FIELD_KEYS = new Set<WeldFieldKey>(
  LNK_METHODS.flatMap((method) => [method.requestKey, method.requestDateKey]),
)
const LNK_RESULT_FIELD_KEYS = new Set<WeldFieldKey>(
  LNK_METHODS.flatMap((method) => [method.resultKey, method.conclusionDateKey, method.conclusionKey]),
)
const PSTO_REQUEST_FIELD_KEYS = new Set<WeldFieldKey>(['pstoRequest', 'pstoRequestDate'])
const PSTO_RESULT_FIELD_KEYS = new Set<WeldFieldKey>(['pstoDate', 'pstoResult', 'heatTreatmentDiagram'])

export function composeWeldTableCellTooltip(value: unknown, description: string) {
  const fullValue = String(value ?? '').trim()
  return fullValue ? `${fullValue}\n\n${description}` : description
}

export function getWeldTableReadOnlyFieldTooltip(fieldKey: WeldFieldKey) {
  if (fieldKey === 'id') return RECORD_NUMBER_TOOLTIP
  if (fieldKey === 'dispatcherTasks') return DISPATCHER_TASKS_TOOLTIP
  if (fieldKey === 'jsrDocument') return JSR_DOCUMENT_TOOLTIP
  if (fieldKey === 'checklistDocument') return CHECKLIST_DOCUMENT_TOOLTIP
  if (fieldKey === 'zniDocument') return ZNI_DOCUMENT_TOOLTIP
  if (fieldKey === 'wdi') return WDI_TOOLTIP
  if (fieldKey === 'status') return OFFICIALITY_STATUS_TOOLTIP
  if (fieldKey === 'finalStatus') return FINAL_STATUS_TOOLTIP
  if (LNK_REQUEST_FIELD_KEYS.has(fieldKey)) return LNK_REQUEST_TOOLTIP
  if (LNK_RESULT_FIELD_KEYS.has(fieldKey)) return LNK_RESULT_TOOLTIP
  if (PSTO_REQUEST_FIELD_KEYS.has(fieldKey)) return PSTO_REQUEST_TOOLTIP
  if (PSTO_RESULT_FIELD_KEYS.has(fieldKey)) return PSTO_RESULT_TOOLTIP
  return PROFILE_TIMESTAMP_TOOLTIPS[fieldKey] ?? WELDING_JOURNAL_FIELD_TOOLTIP
}

type WeldTableBodyCellProps = {
  row: WeldRow
  field: WeldField
  displayValue: unknown
  isEditableCell: boolean
  isBlockedEditableCell: boolean
  isHighlightedRow: boolean
  isSelectedRow: boolean
  hasDispatcherTask: boolean
  isHighlightedCell: boolean
  isResultField: boolean
  stickyLeft: number
  stickyIdentityLeadingWidth: number
  stickyIdentityColumns: boolean
  stickyBackgroundClassName: string
  isSectionEnd: boolean
  onEdit?: (row: WeldRow, fieldKey?: WeldFieldKey) => void
  onOpenDocument?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  availableSystemDocumentTypes?: ReadonlySet<SystemDocumentTemplateId>
}

export function WeldTableBodyCell({
  row,
  field,
  displayValue,
  isEditableCell,
  isBlockedEditableCell,
  isHighlightedRow,
  isSelectedRow,
  hasDispatcherTask,
  isHighlightedCell,
  isResultField,
  stickyLeft,
  stickyIdentityLeadingWidth,
  stickyIdentityColumns,
  stickyBackgroundClassName,
  isSectionEnd,
  onEdit,
  onOpenDocument,
  availableSystemDocumentTypes = new Set(),
}: WeldTableBodyCellProps) {
  const finalStatusErrorReason =
    field.key === 'finalStatus' && String(displayValue ?? '').trim().toLowerCase() === 'ошибка' ? getFinalStatusErrorReason(row) : null
  const visibleValue = field.key === 'finalStatus' ? formatFinalStatusDisplay(row, displayValue) : displayValue
  const fieldKey = field.key as WeldFieldKey
  const tooltipValue = DATE_TIME_WELD_FIELD_KEYS.has(fieldKey)
    ? formatDateTimeWithSeconds(visibleValue)
    : visibleValue
  const isStickyCell = stickyIdentityColumns && isStickyWeldTableField(field.key)
  const isJsrDocumentLink = field.key === 'jsrDocument' && Boolean(row.jsrDocumentId) && Boolean(visibleValue)
  const isChecklistDocumentLink =
    field.key === 'checklistDocument' && Boolean(row.checklistDocumentId) && Boolean(visibleValue)
  const isZniDocumentLink =
    field.key === 'zniDocument' && Boolean(row.zniDocumentId) && Boolean(visibleValue)
  const systemDocumentType = getSystemDocumentTypeForField(field.key as WeldFieldKey)
  const systemDocumentTemplateId = getSystemDocumentTemplateIdForField(field.key as WeldFieldKey)
  const isSystemDocumentLink =
    Boolean(systemDocumentType) &&
    Boolean(visibleValue) &&
    Boolean(
      systemDocumentTemplateId &&
      availableSystemDocumentTypes.has(systemDocumentTemplateId),
    )
  const isDocumentLink =
    isJsrDocumentLink || isChecklistDocumentLink || isZniDocumentLink || isSystemDocumentLink
  const documentLabel = systemDocumentType && isSystemDocumentLink
    ? getSystemDocumentProfile(systemDocumentType).label
    : isChecklistDocumentLink
      ? GENERATED_DOCUMENT_PROFILES.checklist.label
      : isZniDocumentLink
        ? GENERATED_DOCUMENT_PROFILES.zni.label
      : GENERATED_DOCUMENT_PROFILES.weldingJournal.label
  const documentTooltip = composeWeldTableCellTooltip(
    visibleValue,
    `Открыть актуальную версию документа «${documentLabel}» в новой вкладке`,
  )
  const readOnlyFieldTooltip = getWeldTableReadOnlyFieldTooltip(fieldKey)
  const contentClass = `block h-full min-h-10 w-full border-0 bg-transparent px-3 py-2.5 text-center text-[13px] font-normal text-slate-700 ${
    isDocumentLink
      ? 'cursor-pointer font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:bg-sky-50 hover:text-sky-900'
      : isEditableCell
        ? (isSelectedRow || hasDispatcherTask ? 'cursor-pointer' : 'cursor-pointer hover:bg-[#cfeeff]')
        : isResultField
          ? ''
          : 'text-slate-600'
  }`

  return (
    <td
      data-weld-field-key={field.key}
      className={`${bodyCellClass(
        field.key,
        !isEditableCell,
        isHighlightedRow,
        isSelectedRow,
        hasDispatcherTask,
        isHighlightedCell,
        isBlockedEditableCell,
        isSectionEnd,
      )} ${
        isStickyCell
          ? getStickyWeldTableBodyCellClass({
              isHighlightedRow,
              isSelectedRow,
              hasDispatcherTask,
              isHighlightedCell,
              isBlockedEditableCell,
              stickyBackgroundClassName,
            })
          : ''
      }`}
      style={isStickyCell ? getStickyWeldTableFieldStyle(field.key, stickyLeft, stickyIdentityLeadingWidth) : undefined}
      onClick={(event) => {
        if (isDocumentLink || !isEditableCell) return
        event.stopPropagation()
        onEdit?.(row, field.key as WeldFieldKey)
      }}
      title={
        finalStatusErrorReason
          ? finalStatusErrorReason
          : isEditableCell
          ? field.key === 'lnkDefectDescription' || field.key === 'rkExposureScheme'
            ? String(displayValue ?? '') || undefined
            : undefined
          : isDocumentLink
            ? documentTooltip
          : isBlockedEditableCell
            ? 'Недоступно: отсутствует отметка "да" в назначении соответствующего контроля'
            : composeWeldTableCellTooltip(tooltipValue, readOnlyFieldTooltip)
      }
    >
      {isDocumentLink ? (
        <button
          type="button"
          className={contentClass}
          onClick={(event) => {
            event.stopPropagation()
            onOpenDocument?.(row, field.key as WeldFieldKey)
          }}
          title={documentTooltip}
        >
          <WeldTableValue field={field} value={visibleValue} isResultField={isResultField} />
        </button>
      ) : (
        <div className={contentClass}>
          <WeldTableValue field={field} value={visibleValue} isResultField={isResultField} />
        </div>
      )}
    </td>
  )
}

function getStickyWeldTableBodyCellClass({
  isHighlightedRow,
  isSelectedRow,
  isHighlightedCell,
  hasDispatcherTask,
  isBlockedEditableCell,
  stickyBackgroundClassName,
}: {
  isHighlightedRow: boolean
  isSelectedRow: boolean
  isHighlightedCell: boolean
  hasDispatcherTask: boolean
  isBlockedEditableCell: boolean
  stickyBackgroundClassName: string
}) {
  const background = isSelectedRow
    ? stickyBackgroundClassName
    : isHighlightedCell
      ? 'bg-lime-100/95'
      : isHighlightedRow
        ? 'bg-emerald-50 group-hover:bg-emerald-50'
        : hasDispatcherTask
        ? 'bg-amber-100 group-hover:bg-amber-100'
        : isBlockedEditableCell
        ? 'bg-amber-50 group-hover:bg-[#cfeeff]'
        : stickyBackgroundClassName
  return `sticky z-[1] ${background}`
}
