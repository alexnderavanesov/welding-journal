import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ResultManagerDocumentEditor } from '@/components/result-manager-document-editor'

function EditorHarness({ onRename }: { onRename: (value: string) => void }) {
  const persistedValue = 'Заключение-17'
  const [draft, setDraft] = useState(persistedValue)

  return (
    <ResultManagerDocumentEditor
      value={draft}
      placeholder="Наименование заключения"
      disabled={false}
      canRename={Boolean(draft.trim()) && draft.trim() !== persistedValue}
      onChange={setDraft}
      onRename={onRename}
    />
  )
}

describe('ResultManagerDocumentEditor', () => {
  it('keeps typed text as a draft until the rename button is clicked', () => {
    const onRename = vi.fn()
    render(<EditorHarness onRename={onRename} />)

    const input = screen.getByPlaceholderText('Наименование заключения')
    fireEvent.change(input, { target: { value: 'Заключение-18' } })

    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByText(/Новое название еще не сохранено/)).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Переименовать' }))
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('Заключение-18')
  })
})
