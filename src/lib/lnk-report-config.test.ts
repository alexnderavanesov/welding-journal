import { describe, expect, it } from 'vitest'
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
  ...[...LNK_CONCLUSION_FIELD_KEYS].filter(
    (fieldKey) => fieldKey !== 'lnkNote' && fieldKey !== 'lnkDefectDescription',
  ),
] as WeldFieldKey[]

const PSTO_DOCUMENT_FIELD_KEYS = ['pstoRequest', 'pstoRequestDate', 'pstoDate', 'heatTreatmentDiagram'] as WeldFieldKey[]

describe('lnk report editable fields', () => {
  it('allows each report to edit only its own note', () => {
    expect(LNK_EDITABLE_FIELD_KEYS.has('lnkNote')).toBe(true)
    expect(LNK_EDITABLE_FIELD_KEYS.has('pstoNote')).toBe(false)
    expect(HEAT_TREATMENT_EDITABLE_FIELD_KEYS.has('pstoNote')).toBe(true)
    expect(HEAT_TREATMENT_EDITABLE_FIELD_KEYS.has('lnkNote')).toBe(false)
  })

  it('edits RK exposure details only through the LNK table dialog', () => {
    expect(LNK_EDITABLE_FIELD_KEYS.has('rkExposureScheme')).toBe(true)
    expect(LNK_EDITABLE_FIELD_KEYS.has('lnkDefectDescription')).toBe(true)
  })

  it('keeps LNK requests, request dates and conclusions as system-managed fields', () => {
    for (const fieldKey of LNK_DOCUMENT_FIELD_KEYS) {
      expect(LNK_EDITABLE_FIELD_KEYS.has(fieldKey)).toBe(false)
    }
  })

  it('keeps LNK and PSTO document fields out of report editable sets', () => {
    for (const fieldKey of LNK_DOCUMENT_FIELD_KEYS) {
      expect(LNK_EDITABLE_FIELD_KEYS.has(fieldKey)).toBe(false)
    }
    for (const fieldKey of PSTO_DOCUMENT_FIELD_KEYS) {
      expect(HEAT_TREATMENT_EDITABLE_FIELD_KEYS.has(fieldKey)).toBe(false)
    }
  })

  it('marks document fields as ignored in welding journal import templates', () => {
    for (const fieldKey of [...LNK_DOCUMENT_FIELD_KEYS, 'lnkNote', ...PSTO_DOCUMENT_FIELD_KEYS, 'pstoNote']) {
      expect(getReportImportCellKind('weldingJournal', fieldKey)).toBe('ignored')
    }
  })
})
