import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ReportLnkDialogs, type ReportLnkDialogsProps } from '@/components/report-lnk-dialogs'

vi.mock('@/components/lnk-request-dialog', () => ({
  LnkRequestDialog: ({ embedded }: { embedded?: boolean }) => (
    <div data-embedded={String(Boolean(embedded))}>Основная заявка</div>
  ),
}))

vi.mock('@/components/lnk-result-dialog', () => ({
  LnkResultDialog: ({ embedded }: { embedded?: boolean }) => (
    <div data-embedded={String(Boolean(embedded))}>Основной результат</div>
  ),
}))

vi.mock('@/components/pre-heat-treatment-lnk-workflow-dialog', () => ({
  PreHeatTreatmentLnkWorkflowDialog: ({
    embedded,
    mode,
  }: {
    embedded?: boolean
    mode: 'request' | 'result'
  }) => (
    <div data-embedded={String(Boolean(embedded))}>
      {mode === 'request' ? 'Заявка до ТО' : 'Результат до ТО'}
    </div>
  ),
}))

vi.mock('@/components/lnk-request-manager-dialog', () => ({
  LnkRequestManagerDialog: ({ embedded }: { embedded?: boolean }) => {
    const [draft, setDraft] = useState('')
    const [selected, setSelected] = useState(false)
    return (
      <div data-embedded={String(Boolean(embedded))}>
        <span data-embedded={String(Boolean(embedded))}>Основной реестр заявок</span>
        <input aria-label="Черновик исходного реестра" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <input
          aria-label="Выбор исходной строки"
          type="checkbox"
          checked={selected}
          onChange={(event) => setSelected(event.target.checked)}
        />
      </div>
    )
  },
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
  it.each([
    ['request', 'Основная заявка', 'Заявка до ТО'],
    ['result', 'Основной результат', 'Результат до ТО'],
  ] as const)('keeps the %s workflow shell mounted while switching control stages', async (mode, primaryLabel, preHeatTreatmentLabel) => {
    const primaryProps = mode === 'request'
      ? { requestDialogProps: {} as never }
      : { resultDialogProps: {} as never }
    const { rerender } = render(
      <ReportLnkDialogs {...createProps(primaryProps)} />,
    )

    expect(await screen.findByText(primaryLabel)).toHaveAttribute('data-embedded', 'true')
    const workflowShell = screen.getByRole('dialog')

    rerender(
      <ReportLnkDialogs {...createProps({
        preHeatTreatmentWorkflowDialogProps: { mode } as never,
      })} />,
    )

    expect(await screen.findByText(preHeatTreatmentLabel)).toHaveAttribute('data-embedded', 'true')
    expect(screen.getByRole('dialog')).toBe(workflowShell)
  })

  it('keeps the source manager mounted while an exact correction manager is stacked above it', async () => {
    const { rerender } = render(
      <ReportLnkDialogs {...createProps({ requestManagerDialogProps: {} as never })} />,
    )

    const sourceManager = await screen.findByText('Основной реестр заявок')
    expect(sourceManager).toHaveAttribute('data-embedded', 'true')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Черновик исходного реестра' }), {
      target: { value: 'несохраненный текст' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбор исходной строки' }))

    rerender(
      <ReportLnkDialogs {...createProps({
        requestManagerDialogProps: {} as never,
        resultManagerDialogProps: { elevated: true } as never,
      })} />,
    )
    expect(await screen.findByText('Основной реестр результатов')).toHaveAttribute('data-embedded', 'true')
    expect(screen.getByText('Основной реестр заявок')).toBe(sourceManager)
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(screen.getByRole('textbox', { name: 'Черновик исходного реестра' })).toHaveValue('несохраненный текст')
    expect(screen.getByRole('checkbox', { name: 'Выбор исходной строки' })).toBeChecked()

    rerender(
      <ReportLnkDialogs {...createProps({ requestManagerDialogProps: {} as never })} />,
    )
    expect(screen.getByText('Основной реестр заявок')).toBe(sourceManager)
    expect(screen.queryByText('Основной реестр результатов')).not.toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Черновик исходного реестра' })).toHaveValue('несохраненный текст')
    expect(screen.getByRole('checkbox', { name: 'Выбор исходной строки' })).toBeChecked()
  })
})
