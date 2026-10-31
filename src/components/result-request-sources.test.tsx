import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useResultRequestSources } from './use-result-request-sources'
import { ResultDialogHeader } from './result-dialog-header'
import { collectResultRequestSources } from '@/lib/result-request-sources'
import { createRequestDocumentIdentity } from '@/lib/request-document-identity'
const rows = [{ id: 1, request: 'A' }, { id: 2, request: 'B' }, { id: 3, request: 'A' }]
const groups = collectResultRequestSources(rows, ([row]) => [createRequestDocumentIdentity(row.request, '2026-10-30')!])
it('discloses selected source requests, filters the view and preserves the selection', () => {
  function Example() {
    const sources = useResultRequestSources(rows, groups, () => {})
    return <><ResultDialogHeader title="Результат" requestName="A" selectedCount={rows.length} sources={sources.sourceProps} managerDisabled={false} onOpenManager={() => {}} onClose={() => {}} /><output>{sources.rows.map(row => row.id).join(',')}</output></>
  }
  render(<Example />)
  expect(screen.queryByText('Состав выбранных стыков по заявкам')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Заявки: 2' }))
  fireEvent.click(screen.getByRole('button', { name: /A ·.*2 ст\./ }))
  expect(screen.getByRole('status')).toHaveTextContent('1,3')
  expect(screen.getByText(/Выбрано: 3/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Показать все выбранные' }))
  expect(screen.getByRole('status')).toHaveTextContent('1,2,3')
})
