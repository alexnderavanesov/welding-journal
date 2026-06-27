import type { Dispatch, SetStateAction } from 'react'
import type { ActiveReport, EditingState, HeatTreatmentFieldEditingState } from '@/lib/home-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import { isLnkRequestAllowedForRow, isLnkRequestField, isLnkResultField } from '@/lib/lnk-field-updates'
import {
  HEAT_TREATMENT_EDITABLE_FIELD_KEYS,
  LNK_EDITABLE_FIELD_KEYS,
  REQUEST_AND_RESULT_FIELD_KEYS,
} from '@/lib/report-config'
import { FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-fields'

type FieldMutationVariables = {
  record: WeldRow
  fieldKey: WeldFieldKey
  value: string | null
}

type HeatTreatmentFieldMutationVariables = FieldMutationVariables & {
  rows: WeldRow[]
}

type FieldMutation<TVariables> = {
  mutate: (variables: TVariables) => void
}

type UseReportEditActionsParams = {
  activeReport: ActiveReport
  heatTreatmentFieldEditing: HeatTreatmentFieldEditingState | null
  heatTreatmentFieldMutation: FieldMutation<HeatTreatmentFieldMutationVariables>
  lnkFieldMutation: FieldMutation<FieldMutationVariables>
  lnkRequestOptions: string[]
  rows: WeldRow[]
  setEditing: Dispatch<SetStateAction<EditingState | null>>
  setHeatTreatmentFieldEditing: Dispatch<SetStateAction<HeatTreatmentFieldEditingState | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
}

export function useReportEditActions({
  activeReport,
  heatTreatmentFieldEditing,
  heatTreatmentFieldMutation,
  lnkFieldMutation,
  lnkRequestOptions,
  rows,
  setEditing,
  setHeatTreatmentFieldEditing,
  setMessage,
}: UseReportEditActionsParams) {
  function handleEditRecord(record: WeldRow, focusField?: WeldFieldKey) {
    if (activeReport === 'heatTreatment') {
      if (focusField && HEAT_TREATMENT_EDITABLE_FIELD_KEYS.has(focusField)) {
        const field = FIELD_BY_KEY.get(focusField)
        setHeatTreatmentFieldEditing({
          record,
          fieldKey: focusField,
          label: field?.label ?? 'Поле ПСТО',
          kind: field?.kind === 'date' ? 'date' : 'text',
          value: String(record[focusField] ?? ''),
        })
      }
      return
    }

    if (activeReport === 'lnk') {
      if (focusField && LNK_EDITABLE_FIELD_KEYS.has(focusField)) {
        if (isLnkRequestField(focusField) && !isLnkRequestAllowedForRow(record, focusField)) {
          setMessage('Сначала укажите наличие этого вида контроля в сварочном журнале')
          return
        }
        const field = FIELD_BY_KEY.get(focusField)
        setHeatTreatmentFieldEditing({
          record,
          fieldKey: focusField,
          label: field?.label ?? 'Поле ЛНК',
          kind: field?.kind === 'date' ? 'date' : 'text',
          value: String(record[focusField] ?? ''),
          report: 'lnk',
          mode: isLnkResultField(focusField) ? 'result' : isLnkRequestField(focusField) ? 'request' : 'text',
        })
      }
      return
    }

    if (focusField && REQUEST_AND_RESULT_FIELD_KEYS.has(focusField)) {
      setMessage('Поля заявок и результатов редактируются только в отчетах Термообработка и ЛНК')
      return
    }

    setEditing({ record, focusField })
  }

  function saveEditedHeatTreatmentField() {
    if (!heatTreatmentFieldEditing) return
    if (heatTreatmentFieldEditing.report === 'lnk') {
      const value = heatTreatmentFieldEditing.value.trim()
      if (heatTreatmentFieldEditing.mode === 'request' && value && !lnkRequestOptions.includes(value)) {
        setMessage('Можно выбрать только существующую заявку ЛНК или очистить поле')
        return
      }
      lnkFieldMutation.mutate({
        record: heatTreatmentFieldEditing.record,
        fieldKey: heatTreatmentFieldEditing.fieldKey,
        value: value || null,
      })
      return
    }
    heatTreatmentFieldMutation.mutate({
      record: heatTreatmentFieldEditing.record,
      fieldKey: heatTreatmentFieldEditing.fieldKey,
      value: heatTreatmentFieldEditing.value.trim() || null,
      rows,
    })
  }

  return {
    handleEditRecord,
    saveEditedHeatTreatmentField,
  }
}
