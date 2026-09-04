import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmActionProvider } from '@/lib/confirm-action-context'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LnkOfficialityChainPlan } from '@/lib/lnk-officiality-chain-plan'
import { useLnkOfficialityActions } from '@/lib/use-lnk-officiality-actions'

type OfficialityMutationInput = {
  records: WeldRow[]
  officiality: 'official' | 'unofficial'
  plan: LnkOfficialityChainPlan
}

type OfficialityPreviewInput = Omit<OfficialityMutationInput, 'plan'>

describe('useLnkOfficialityActions', () => {
  it('saves a simple officiality change after the server preview', async () => {
    const record = row(1, 'S1')
    const plan = makePlan()
    const mutate = vi.fn<(value: OfficialityMutationInput) => void>()
    const preview = vi.fn<(value: OfficialityPreviewInput) => Promise<LnkOfficialityChainPlan>>()
      .mockResolvedValue(plan)
    const { result } = renderActions({ record, mutate, preview })

    await act(async () => result.current.saveLnkOfficiality())

    expect(preview).toHaveBeenCalledWith({ records: [record], officiality: 'unofficial' })
    expect(mutate).toHaveBeenCalledWith({ records: [record], officiality: 'unofficial', plan })
  })

  it('requires confirmation before renaming the continuation', async () => {
    const record = row(1, 'S1')
    const plan = makePlan({
      renames: [{ rowId: 2, currentJoint: 'S1R1', targetJoint: 'S1' }],
      affectedRowIds: [1, 2],
    })
    const mutate = vi.fn<(value: OfficialityMutationInput) => void>()
    const { result } = renderActions({
      record,
      mutate,
      preview: vi.fn<(value: OfficialityPreviewInput) => Promise<LnkOfficialityChainPlan>>()
        .mockResolvedValue(plan),
    })

    let savePromise: Promise<void> | undefined
    act(() => {
      savePromise = result.current.saveLnkOfficiality()
    })

    expect(mutate).not.toHaveBeenCalled()
    expect(await screen.findByText('Изменить официальность и перестроить цепочку')).toBeInTheDocument()
    expect(screen.getByText(/S1R1 -> S1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и перестроить' }))
    await act(async () => savePromise)
    await waitFor(() => expect(mutate).toHaveBeenCalledWith({
      records: [record],
      officiality: 'unofficial',
      plan,
    }))
  })

  it('reports a blocked server preview without saving anything', async () => {
    const setMessage = vi.fn<(value: string | null) => void>()
    const mutate = vi.fn<(value: OfficialityMutationInput) => void>()
    const { result } = renderActions({
      record: row(1, 'S1'),
      mutate,
      preview: vi.fn<(value: OfficialityPreviewInput) => Promise<LnkOfficialityChainPlan>>()
        .mockRejectedValue(new Error('Катушка требует ручного решения.')),
      setMessage,
    })

    await act(async () => result.current.saveLnkOfficiality())

    expect(mutate).not.toHaveBeenCalled()
    expect(setMessage).toHaveBeenCalledWith('Катушка требует ручного решения.')
  })
})

function renderActions({
  record,
  mutate,
  preview,
  setMessage = vi.fn<(value: string | null) => void>(),
}: {
  record: WeldRow
  mutate: (value: OfficialityMutationInput) => void
  preview: (value: OfficialityPreviewInput) => Promise<LnkOfficialityChainPlan>
  setMessage?: (value: string | null) => void
}) {
  return renderHook(() => useLnkOfficialityActions({
    draft: {
      rowIds: new Set([record.id]),
      search: '',
      officiality: 'unofficial',
    },
    filteredRows: [record],
    selectedRows: [record],
    isSaveDisabled: false,
    mutation: { isPending: false, mutate },
    previewMutation: { isPending: false, mutateAsync: preview },
    setDraft: vi.fn(),
    setIsOpen: vi.fn(),
    setMessage,
  }), { wrapper })
}

function wrapper({ children }: { children: ReactNode }) {
  return <ConfirmActionProvider>{children}</ConfirmActionProvider>
}

function makePlan(values: Partial<LnkOfficialityChainPlan> = {}): LnkOfficialityChainPlan {
  return {
    officiality: 'unofficial',
    officialityChanges: [{
      rowId: 1,
      joint: 'S1',
      previousOfficiality: 'official',
      nextOfficiality: 'unofficial',
    }],
    renames: [],
    earlyCoilDecisions: [],
    affectedRowIds: [1],
    planKey: 'plan-key',
    ...values,
  }
}

function row(id: number, joint: string): WeldRow {
  return {
    id,
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line: 'Линия',
    joint,
    rkResult: 'вырез',
    rowVersion: `version-${id}`,
  } as WeldRow
}
