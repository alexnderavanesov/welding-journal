import { WeldTableValue } from '@/components/weld-table-value'
import type { WeldRow } from '@/lib/dispatcher-types'
import { bodyCellClass } from '@/lib/weld-table-utils'
import { getFinalStatusErrorReason, type WeldField, type WeldFieldKey } from '@/lib/weld-fields'
import { formatFinalStatusDisplay } from '@/lib/weld-status'
import { getStickyWeldTableFieldStyle, isStickyWeldTableField } from '@/lib/weld-table-sticky-columns'
import {
  GENERATED_DOCUMENT_PROFILES,
} from '@/lib/generated-document-types'
import {
  getSystemDocumentProfile,
  getSystemDocumentTypeForField,
  type SystemDocumentType,
} from '@/lib/system-document-types'

const SYSTEM_FIELD_TOOLTIP =
  'Системное поле: заполняется через связанные окна ЛНК/ПСТО, заявки, результаты, заключения или другие действия системы.'
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
  availableSystemDocumentTypes?: ReadonlySet<SystemDocumentType>
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
  const isStickyCell = stickyIdentityColumns && isStickyWeldTableField(field.key)
  const isJsrDocumentLink = field.key === 'jsrDocument' && Boolean(row.jsrDocumentId) && Boolean(visibleValue)
  const isChecklistDocumentLink =
    field.key === 'checklistDocument' && Boolean(row.checklistDocumentId) && Boolean(visibleValue)
  const isZniDocumentLink =
    field.key === 'zniDocument' && Boolean(row.zniDocumentId) && Boolean(visibleValue)
  const systemDocumentType = getSystemDocumentTypeForField(field.key as WeldFieldKey)
  const isSystemDocumentLink =
    Boolean(systemDocumentType) &&
    Boolean(visibleValue) &&
    Boolean(systemDocumentType && availableSystemDocumentTypes.has(systemDocumentType))
  const isDocumentLink =
    isJsrDocumentLink || isChecklistDocumentLink || isZniDocumentLink || isSystemDocumentLink
  const documentLabel = systemDocumentType && isSystemDocumentLink
    ? getSystemDocumentProfile(systemDocumentType).label
    : isChecklistDocumentLink
      ? GENERATED_DOCUMENT_PROFILES.checklist.label
      : isZniDocumentLink
        ? GENERATED_DOCUMENT_PROFILES.zni.label
        : GENERATED_DOCUMENT_PROFILES.weldingJournal.label
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
          ? undefined
          : isDocumentLink
            ? `Открыть актуальную версию документа «${documentLabel}» в новой вкладке`
          : isBlockedEditableCell
            ? 'Недоступно: отсутствует отметка "да" в назначении соответствующего контроля'
            : field.key === 'id'
              ? RECORD_NUMBER_TOOLTIP
              : field.key === 'dispatcherTasks'
                ? DISPATCHER_TASKS_TOOLTIP
              : field.key === 'jsrDocument'
                ? JSR_DOCUMENT_TOOLTIP
              : field.key === 'checklistDocument'
                ? CHECKLIST_DOCUMENT_TOOLTIP
              : field.key === 'zniDocument'
                ? ZNI_DOCUMENT_TOOLTIP
              : SYSTEM_FIELD_TOOLTIP
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
          title={`Открыть актуальную версию документа «${documentLabel}» в новой вкладке`}
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
