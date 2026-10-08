import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LnkOfficialityDialog } from '@/components/lnk-officiality-dialog'
import type { WeldRow } from '@/lib/dispatcher-types'

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0]

  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }
  unobserve() {}
}

describe('LnkOfficialityDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders only the visible part of a large filtered row batch', () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      id: index + 1,
      joint: `F${index + 1}`,
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия',
      rkResult: 'ремонт',
    })) as WeldRow[]

    render(
      <LnkOfficialityDialog
        draft={{ search: '', officiality: '', rowIds: new Set() }}
        filteredRows={rows}
        selectedRows={[]}
        counters={{ unofficial: 0, rejectedOfficial: rows.length }}
        saveBlockReason="Выберите значение."
        isSaveDisabled
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDraftChange={vi.fn()}
        onToggleRow={vi.fn()}
        onSetVisibleRowsSelected={vi.fn()}
      />,
    )

    expect(screen.getByText('Линия · F1')).toBeInTheDocument()
    expect(screen.queryByText('Линия · F100')).not.toBeInTheDocument()
    expect(screen.getAllByText(/^Линия · F\d+$/)).toHaveLength(12)
    expect(screen.getByText(/1-100/)).toBeInTheDocument()
    expect(screen.getByText(/из 120 строк/)).toBeInTheDocument()
  })

  it('explains a legacy unofficial waiting row without inventing a rejection or hiding restoration', () => {
    const row = { id: 1, joint: 'S1', line: 'Л1', officiality: 'неофициальный', finalStatus: 'ожидает НК', vikResult: 'ожидает НК' } as WeldRow
    render(<LnkOfficialityDialog draft={{ search: '', officiality: 'official', rowIds: new Set([1]) }}
      filteredRows={[row]} selectedRows={[row]} counters={{ unofficial: 1, rejectedOfficial: 0 }}
      saveBlockReason={null} isSaveDisabled={false} onClose={vi.fn()} onSave={vi.fn()} onDraftChange={vi.fn()}
      onToggleRow={vi.fn()} onSetVisibleRowsSelected={vi.fn()} />)
    expect(screen.getByText('ожидает НК')).toBeVisible()
    expect(screen.getByText('Неофициальный стык без негодного результата. Проверьте историю и официальность.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Сохранить официальность' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^Неофициальный/ })).toBeDisabled()
    expect(screen.getByRole('region', { name: 'Параметры официальности' })).toHaveClass('lg:overflow-y-auto')
  })
})
