import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import { WeldLineProgramImpact } from './weld-line-program-impact'
const preview = vi.hoisted(() => vi.fn())
vi.mock('@/server/line-program-card-impact', () => ({ getWeldLineProgramImpact: preview }))
it('loads only on request, never polls on edits, and invalidates visible estimates after an edit', async () => {
  preview.mockResolvedValue({ before: { missing: 1, excess: 0 }, after: { missing: 0, excess: 0 } })
  const client = new QueryClient()
  const draft = { id: 1, line: 'L', hasRk: 'да' }
  const mount = (value: typeof draft) => <QueryClientProvider client={client}><WeldLineProgramImpact draft={value} /></QueryClientProvider>
  const view = render(mount(draft))
  expect(preview).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Влияние изменений на линию' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Изменение закрывает недобор')
  expect(preview).toHaveBeenCalledOnce()
  view.rerender(mount({ ...draft, hasRk: 'дополнительный' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText(/пересчитайте влияние/)).toBeVisible()
  expect(preview).toHaveBeenCalledOnce()
})
