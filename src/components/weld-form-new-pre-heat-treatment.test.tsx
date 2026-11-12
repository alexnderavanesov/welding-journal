import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { WeldInput } from '@/lib/weld-fields'
import { getPstoLineIdentityKey } from '@/lib/psto-line-assignment'
import { WeldFormPreHeatTreatment } from './weld-form-pre-heat-treatment'

const preview = vi.hoisted(() => vi.fn())
vi.mock('@/server/pre-heat-treatment-api', () => ({ previewNewPreHeatTreatment: preview }))
beforeEach(() => { preview.mockImplementation(async ({ data }) => ({
  identityKey: getPstoLineIdentityKey(data), applicable: data.line !== 'none',
  inherited: data.joint === 'S1R2', required: data.joint === 'S1R2', rootJoint: 'S1',
})) })
function Form() {
  const [draft, setDraft] = useState<WeldInput>({ projectTitle: 'P', subtitleCode: 'S', line: 'L1', joint: 'S2' })
  return <><input aria-label="line" value={String(draft.line)} onChange={e => setDraft(d => ({ ...d, line: e.target.value }))} />
    <input aria-label="joint" value={String(draft.joint)} onChange={e => setDraft(d => ({ ...d, joint: e.target.value }))} />
    <WeldFormPreHeatTreatment draft={draft} setDraft={setDraft} /><output>{JSON.stringify(draft)}</output></>
}
function open() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Form /></QueryClientProvider>); return screen.getByRole('checkbox') }
it('marks an unsaved joint, clears the choice between two PSTO lines and does not restore it on return', async () => {
  const checkbox = open()
  await waitFor(() => expect(checkbox).toBeEnabled())
  expect(checkbox).not.toBeChecked()
  fireEvent.click(checkbox)
  expect(checkbox).toBeChecked()
  expect(screen.getByRole('status').textContent).toContain('newPreHeatTreatmentChoice')
  fireEvent.change(screen.getByLabelText('line'), { target: { value: 'L2' } })
  expect(checkbox).not.toBeChecked()
  await waitFor(() => expect(checkbox).toBeEnabled())
  fireEvent.change(screen.getByLabelText('line'), { target: { value: 'L1' } })
  await waitFor(() => expect(checkbox).toBeEnabled())
  expect(checkbox).not.toBeChecked()
})
it('disables the manual choice without PSTO and shows inherited repair requirements', async () => {
  const checkbox = open()
  await waitFor(() => expect(checkbox).toBeEnabled())
  fireEvent.change(screen.getByLabelText('line'), { target: { value: 'none' } })
  await waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ line: 'none' }) })))
  expect(checkbox).toBeDisabled()
  fireEvent.change(screen.getByLabelText('line'), { target: { value: 'L1' } })
  fireEvent.change(screen.getByLabelText('joint'), { target: { value: 'S1R2' } })
  await waitFor(() => expect(checkbox).toBeChecked())
  expect(checkbox).toBeDisabled()
  expect(screen.getByText(/S1\./)).toBeVisible()
})
