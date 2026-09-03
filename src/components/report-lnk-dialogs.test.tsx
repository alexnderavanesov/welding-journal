import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ReportLnkDialogs, type ReportLnkDialogsProps } from '@/components/report-lnk-dialogs'

vi.mock('@/components/lnk-request-manager-dialog', () => ({
  LnkRequestManagerDialog: ({ embedded }: { embedded?: boolean }) => (
    <div data-embedded={String(Boolean(embedded))}>Основной реестр заявок</div>
  ),
}))

vi.mock('@/components/lnk-result-manager-dialog', () => ({
  LnkResultManagerDialog: ({ embedded }: { embedded?: boolean }) => (
    <div data-embedded={String(Boolean(embedded))}>Основной реестр результатов</div>
  ),
}))

vi.mock('@/components/pre-heat-treatment-result-manager-dialog', () => ({
  PreHeatTreatmentResultManagerDialog: ({ embedded }: { embedded?: boolean }) => (
    <div data-embedded={String(Boolean(embedded))}>Реестр до ТО</div>
  ),
}))

function createProps(overrides: Partial<ReportLnkDialogsProps> = {}): ReportLnkDialogsProps {
  return {
    requestDialogProps: null,
    requestManagerDialogProps: null,
    resultManagerDialogProps: null,
    officialityDialogProps: null,
    duplicateControlDialogProps: null,
    resultDialogProps: null,
    preHeatTreatmentWorkflowDialogProps: null,
    preHeatTreatmentResultManagerDialogProps: null,
    ...overrides,
  }
}

describe('ReportLnkDialogs', () => {
  it('keeps one manager shell mounted while the LNK stage changes', async () => {
    const { rerender } = render(
      <ReportLnkDialogs {...createProps({ requestManagerDialogProps: {} as never })} />,
    )

    expect(await screen.findByText('Основной реестр заявок')).toHaveAttribute('data-embedded', 'true')
    const dialog = screen.getByRole('dialog')

    rerender(
      <ReportLnkDialogs {...createProps({ preHeatTreatmentResultManagerDialogProps: {} as never })} />,
    )
    expect(await screen.findByText('Реестр до ТО')).toHaveAttribute('data-embedded', 'true')
    expect(screen.getByRole('dialog')).toBe(dialog)

    rerender(
      <ReportLnkDialogs {...createProps({ resultManagerDialogProps: {} as never })} />,
    )
    expect(await screen.findByText('Основной реестр результатов')).toHaveAttribute('data-embedded', 'true')
    expect(screen.getByRole('dialog')).toBe(dialog)
  })
})
