import { describe, expect, it } from 'vitest'
import { getReportImportFieldKeys } from '@/lib/report-field-state'
import { getReportImportCellKind } from '@/lib/report-import-template'
import {
  LNK_CONCLUSION_FIELD_KEYS,
  LNK_EDITABLE_FIELD_KEYS,
  LNK_REQUEST_DATE_FIELD_KEYS,
  LNK_REQUEST_FIELD_KEYS,
} from '@/lib/lnk-report-config'
import { HEAT_TREATMENT_EDITABLE_FIELD_KEYS } from '@/lib/psto-report-config'
import type { WeldFieldKey } from '@/lib/weld-fields'

const LNK_DOCUMENT_FIELD_KEYS = [
  ...LNK_REQUEST_FIELD_KEYS,
  ...LNK_REQUEST_DATE_FIELD_KEYS,
  ...LNK_CONCLUSION_FIELD_KEYS,
] as WeldFieldKey[]

const PSTO_DOCUMENT_FIELD_KEYS = ['pstoRequest', 'pstoRequestDate', 'pstoDate', 'heatTreatmentDiagram'] as WeldFieldKey[]

describe('lnk report editable fields', () => {
  it('keeps LNK requests, request dates and conclusions as system-managed fields', () => {
    for (const fieldKey of LNK_DOCUMENT_FIELD_KEYS) {
      expect(LNK_EDITABLE_FIELD_KEYS.has(fieldKey)).toBe(false)
    }
  })

  it('keeps LNK and PSTO document fields out of report import editable sets', () => {
    const lnkImportFields = getReportImportFieldKeys('lnk')
    const pstoImportFields = getReportImportFieldKeys('heatTreatment')
    expect(lnkImportFields).not.toBeNull()
    expect(pstoImportFields).not.toBeNull()

    for (const fieldKey of LNK_DOCUMENT_FIELD_KEYS) {
      expect(lnkImportFields?.editableFieldKeys.has(fieldKey)).toBe(false)
    }
    for (const fieldKey of PSTO_DOCUMENT_FIELD_KEYS) {
      expect(HEAT_TREATMENT_EDITABLE_FIELD_KEYS.has(fieldKey)).toBe(false)
      expect(pstoImportFields?.editableFieldKeys.has(fieldKey)).toBe(false)
    }
  })

  it('marks document fields as ignored in welding journal import templates', () => {
    for (const fieldKey of [...LNK_DOCUMENT_FIELD_KEYS, ...PSTO_DOCUMENT_FIELD_KEYS]) {
      expect(getReportImportCellKind('weldingJournal', fieldKey)).toBe('ignored')
    }
  })
})
