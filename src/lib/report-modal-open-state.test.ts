import { describe, expect, it } from 'vitest'

import { hasOpenReportDialogProps } from '@/lib/report-modal-open-state'

describe('report dialog render gate', () => {
  it('opens the lazy dialog container for newly added workflow props', () => {
    expect(hasOpenReportDialogProps({
      requestDialogProps: null,
      resultDialogProps: null,
      preHeatTreatmentWorkflowDialogProps: { mode: 'request' },
    })).toBe(true)
  })

  it('keeps the lazy dialog container unloaded when every dialog is closed', () => {
    expect(hasOpenReportDialogProps({
      requestDialogProps: null,
      resultDialogProps: null,
      preHeatTreatmentWorkflowDialogProps: null,
    })).toBe(false)
  })
})
