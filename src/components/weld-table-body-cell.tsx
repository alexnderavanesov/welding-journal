import { WeldTableValue } from '@/components/weld-table-value'
import type { WeldRow } from '@/lib/dispatcher-types'
import { bodyCellClass } from '@/lib/weld-table-utils'
import { DATE_TIME_WELD_FIELD_KEYS, getFinalStatusErrorReason, type WeldField, type WeldFieldKey } from '@/lib/weld-fields'
import { formatDateTimeWithSeconds } from '@/lib/weld-table-formatting'
import { formatFinalStatusDisplay } from '@/lib/weld-status'
import { getStickyWeldTableFieldStyle, isStickyWeldTableField } from '@/lib/weld-table-sticky-columns'
import { CONTROL_BASIS_SUMMARY_FIELD_KEY } from '@/lib/control-assignment-basis'
import {
  GENERATED_DOCUMENT_PROFILES,
} from '@/lib/generated-document-types'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { getLnkResultMethodForField } from '@/lib/lnk-result-navigation'
import {
  getSystemDocumentProfile,
  getSystemDocumentTypeForField,
} from '@/lib/system-document-types'
import {
  getSystemDocumentTemplateIdForField,
  type SystemDocumentTemplateId,
} from '@/lib/system-document-template-types'
import { memo } from 'react'

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
const CONTROL_BASIS_SUMMARY_TOOLTIP =
  'Сводное поле формируется из оснований, указанных рядом с видами контроля в карточке стыка. В сварочном журнале показаны все основания, в ЛНК — только основания НК, в ПСТО — только основание ПСТО.'
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
const LNK_REQUEST_NAME_FIELD_KEYS = new Set<WeldFieldKey>(LNK_METHODS.map((method) => method.requestKey))
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
  if (fieldKey === 'controlBasisSummary') return CONTROL_BASIS_SUMMARY_TOOLTIP
  if (fieldKey === 'wdi') return WDI_TOOLTIP
  if (fieldKey === 'status') return OFFICIALITY_STATUS_TOOLTIP
  if (fieldKey === 'finalStatus') return FINAL_STATUS_TOOLTIP
  if (LNK_REQUEST_FIELD_KEYS.has(fieldKey)) return LNK_REQUEST_TOOLTIP
  if (LNK_RESULT_FIELD_KEYS.has(fieldKey)) return LNK_RESULT_TOOLTIP
  if (PSTO_REQUEST_FIELD_KEYS.has(fieldKey)) return PSTO_REQUEST_TOOLTIP
  if (PSTO_RESULT_FIELD_KEYS.has(fieldKey)) return PSTO_RESULT_TOOLTIP
  return PROFILE_TIMESTAMP_TOOLTIPS[fieldKey] ?? WELDING_JOURNAL_FIELD_TOOLTIP
}

export function getWeldTableBodyCellTooltip({
  row,
  fieldKey,
  displayValue,
  isEditableCell,
  isBlockedEditableCell,
  canOpenDocument,
  canOpenLnkRequest,
  canOpenLnkResult,
  canOpenWeldEditor,
  availableSystemDocumentTypes,
}: {
  row: WeldRow
  fieldKey: WeldFieldKey
  displayValue: unknown
  isEditableCell: boolean
  isBlockedEditableCell: boolean
  canOpenDocument: boolean
  canOpenLnkRequest: boolean
  canOpenLnkResult: boolean
  canOpenWeldEditor: boolean
  availableSystemDocumentTypes: ReadonlySet<SystemDocumentTemplateId>
}) {
  const visibleValue = fieldKey === 'finalStatus' ? formatFinalStatusDisplay(row, displayValue) : displayValue
  const finalStatusErrorReason =
    fieldKey === 'finalStatus' && String(displayValue ?? '').trim().toLowerCase() === 'ошибка'
      ? getFinalStatusErrorReason(row)
      : null
  if (finalStatusErrorReason) return finalStatusErrorReason
  if (isEditableCell) {
    return fieldKey === 'lnkDefectDescription' || fieldKey === 'rkExposureScheme'
      ? String(displayValue ?? '') || undefined
      : undefined
  }

  const linkState = getWeldTableCellLinkState({
    row,
    fieldKey,
    visibleValue,
    canOpenDocument,
    canOpenLnkRequest,
    canOpenLnkResult,
    availableSystemDocumentTypes,
  })
  if (linkState.isLnkRequestCardLink) {
    return composeWeldTableCellTooltip(visibleValue, 'Открыть карточку этой заявки ЛНК')
  }
  if (linkState.isLnkResultCardLink) {
    return composeWeldTableCellTooltip(visibleValue, 'Открыть карточку этого результата ЛНК')
  }
  if (linkState.isDocumentLink) {
    return composeWeldTableCellTooltip(
      visibleValue,
      `Открыть актуальную версию документа «${getDocumentLabel({
        systemDocumentType: linkState.systemDocumentType,
        isSystemDocumentLink: linkState.isSystemDocumentLink,
        isChecklistDocumentLink: linkState.isChecklistDocumentLink,
        isZniDocumentLink: linkState.isZniDocumentLink,
      })}» в новой вкладке`,
    )
  }
  if (fieldKey === CONTROL_BASIS_SUMMARY_FIELD_KEY && canOpenWeldEditor) {
    return composeWeldTableCellTooltip(visibleValue, 'Открыть карточку стыка на вкладке «Назначение контроля»')
  }
  if (isBlockedEditableCell) {
    return 'Недоступно: отсутствует отметка "да" в назначении соответствующего контроля'
  }
  const tooltipValue = DATE_TIME_WELD_FIELD_KEYS.has(fieldKey)
    ? formatDateTimeWithSeconds(visibleValue)
    : visibleValue
  return composeWeldTableCellTooltip(tooltipValue, getWeldTableReadOnlyFieldTooltip(fieldKey))
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
  onOpenLnkRequest?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenLnkResult?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  availableSystemDocumentTypes?: ReadonlySet<SystemDocumentTemplateId>
}

export const WeldTableBodyCell = memo(function WeldTableBodyCell({
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
  onOpenLnkRequest,
  onOpenLnkResult,
  availableSystemDocumentTypes = new Set(),
}: WeldTableBodyCellProps) {
  const visibleValue = field.key === 'finalStatus' ? formatFinalStatusDisplay(row, displayValue) : displayValue
  const fieldKey = field.key as WeldFieldKey
  const isStickyCell = stickyIdentityColumns && isStickyWeldTableField(field.key)
  const isControlBasisEditorLink = fieldKey === CONTROL_BASIS_SUMMARY_FIELD_KEY && Boolean(onEdit)
  const {
    isDocumentLink,
    isLnkRequestCardLink,
    isLnkResultCardLink,
  } = getWeldTableCellLinkState({
    row,
    fieldKey,
    visibleValue,
    canOpenDocument: Boolean(onOpenDocument),
    canOpenLnkRequest: Boolean(onOpenLnkRequest),
    canOpenLnkResult: Boolean(onOpenLnkResult),
    availableSystemDocumentTypes,
  })
  const contentClass = `block h-[52px] w-full overflow-hidden border-0 bg-transparent px-3 py-2.5 text-center text-[13px] font-normal text-slate-700 ${
    isDocumentLink || isLnkRequestCardLink || isLnkResultCardLink || isControlBasisEditorLink
      ? 'cursor-pointer font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900'
      : isEditableCell
        ? 'cursor-pointer'
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
        if (isDocumentLink || isLnkRequestCardLink || isLnkResultCardLink || isControlBasisEditorLink || !isEditableCell) return
        event.stopPropagation()
        onEdit?.(row, field.key as WeldFieldKey)
      }}
    >
      {isLnkRequestCardLink ? (
        <button
          type="button"
          className={contentClass}
          onClick={(event) => {
            event.stopPropagation()
            onOpenLnkRequest?.(row, fieldKey)
          }}
        >
          <WeldTableValue field={field} value={visibleValue} isResultField={isResultField} />
        </button>
      ) : isLnkResultCardLink ? (
        <button
          type="button"
          className={contentClass}
          onClick={(event) => {
            event.stopPropagation()
            onOpenLnkResult?.(row, fieldKey)
          }}
        >
          <WeldTableValue field={field} value={visibleValue} isResultField={isResultField} />
        </button>
      ) : isDocumentLink ? (
        <button
          type="button"
          className={contentClass}
          onClick={(event) => {
            event.stopPropagation()
            onOpenDocument?.(row, field.key as WeldFieldKey)
          }}
        >
          <WeldTableValue field={field} value={visibleValue} isResultField={isResultField} />
        </button>
      ) : isControlBasisEditorLink ? (
        <button
          type="button"
          className={contentClass}
          aria-label={`Открыть назначения контроля для стыка ${String(row.joint ?? row.id)}`}
          onClick={(event) => {
            event.stopPropagation()
            onEdit?.(row, fieldKey)
          }}
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
})

function getWeldTableCellLinkState({
  row,
  fieldKey,
  visibleValue,
  canOpenDocument,
  canOpenLnkRequest,
  canOpenLnkResult,
  availableSystemDocumentTypes,
}: {
  row: WeldRow
  fieldKey: WeldFieldKey
  visibleValue: unknown
  canOpenDocument: boolean
  canOpenLnkRequest: boolean
  canOpenLnkResult: boolean
  availableSystemDocumentTypes: ReadonlySet<SystemDocumentTemplateId>
}) {
  const hasVisibleValue = Boolean(visibleValue)
  const isJsrDocumentLink = fieldKey === 'jsrDocument' && Boolean(row.jsrDocumentId) && hasVisibleValue
  const isChecklistDocumentLink =
    fieldKey === 'checklistDocument' && Boolean(row.checklistDocumentId) && hasVisibleValue
  const isZniDocumentLink =
    fieldKey === 'zniDocument' && Boolean(row.zniDocumentId) && hasVisibleValue
  const systemDocumentType = hasVisibleValue ? getSystemDocumentTypeForField(fieldKey) : null
  const systemDocumentTemplateId = systemDocumentType ? getSystemDocumentTemplateIdForField(fieldKey) : null
  const isLnkRequestCardLink =
    hasVisibleValue && canOpenLnkRequest && LNK_REQUEST_NAME_FIELD_KEYS.has(fieldKey)
  const isLnkResultCardLink =
    hasVisibleValue && canOpenLnkResult && Boolean(getLnkResultMethodForField(fieldKey))
  const isSystemDocumentLink =
    canOpenDocument &&
    Boolean(systemDocumentType) &&
    hasVisibleValue &&
    Boolean(systemDocumentTemplateId && availableSystemDocumentTypes.has(systemDocumentTemplateId))
  const isDocumentLink =
    isJsrDocumentLink ||
    isChecklistDocumentLink ||
    isZniDocumentLink ||
    (isSystemDocumentLink && !isLnkRequestCardLink && !isLnkResultCardLink)

  return {
    isChecklistDocumentLink,
    isDocumentLink,
    isLnkRequestCardLink,
    isLnkResultCardLink,
    isSystemDocumentLink,
    isZniDocumentLink,
    systemDocumentType,
  }
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
        ? 'bg-emerald-50'
        : hasDispatcherTask
        ? 'bg-amber-100'
        : isBlockedEditableCell
        ? 'bg-amber-50'
        : stickyBackgroundClassName
  return `sticky z-[1] ${background}`
}

function getDocumentLabel({
  systemDocumentType,
  isSystemDocumentLink,
  isChecklistDocumentLink,
  isZniDocumentLink,
}: {
  systemDocumentType: ReturnType<typeof getSystemDocumentTypeForField>
  isSystemDocumentLink: boolean
  isChecklistDocumentLink: boolean
  isZniDocumentLink: boolean
}) {
  if (systemDocumentType && isSystemDocumentLink) return getSystemDocumentProfile(systemDocumentType).label
  if (isChecklistDocumentLink) return GENERATED_DOCUMENT_PROFILES.checklist.label
  if (isZniDocumentLink) return GENERATED_DOCUMENT_PROFILES.zni.label
  return GENERATED_DOCUMENT_PROFILES.weldingJournal.label
}
