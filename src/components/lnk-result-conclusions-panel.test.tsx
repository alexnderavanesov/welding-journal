import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LnkResultConclusionsPanel } from '@/components/lnk-result-conclusions-panel'
import type { WeldRow } from '@/lib/dispatcher-types'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import type { RequestNamingState } from '@/lib/request-naming-state'
import { buildSystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'

const rows = [
  { id: 1, projectTitle: 'Проект А', subtitleCode: '500', line: 'L-10', joint: 'F5' },
  { id: 2, projectTitle: 'Проект Б', subtitleCode: '600', line: 'L-20', joint: 'F6' },
] as WeldRow[]
const settings = {
  ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
  splitModes: {
    ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes,
    lnkConclusionVik: 'joint' as const,
  },
}

function createPlan(naming: RequestNamingState) {
  return buildSystemDocumentCreationPlan({
    type: 'lnkConclusion',
    methodCode: 'ВИК',
    date: '2026-08-26',
    rows,
    naming,
    settings,
    nextNumber: 13,
  })
}

describe('LnkResultConclusionsPanel', () => {
  it('shows every system name in a full-width group list', () => {
    const naming = { mode: 'system' as const, customName: '' }
    const plan = createPlan(naming)

    render(<LnkResultConclusionsPanel plan={plan} naming={naming} onNamingChange={vi.fn()} />)

    expect(screen.getByText('Проект: Проект А · Шифр: 500 · Линия: L-10')).toBeInTheDocument()
    expect(screen.getByText(plan.groups[0].name)).toBeInTheDocument()
    expect(screen.getByText(plan.groups[1].name)).toBeInTheDocument()
    expect(screen.getByText(/Будет создано:/)).toHaveTextContent('Будет создано: 2')
  })

  it('switches to arbitrary custom names without discarding saved drafts', () => {
    const naming = {
      mode: 'system' as const,
      customName: 'Одно имя',
      customGroupNames: { saved: 'Сохранённое имя' },
    }
    const onNamingChange = vi.fn()

    render(<LnkResultConclusionsPanel plan={createPlan(naming)} naming={naming} onNamingChange={onNamingChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Пользовательское' }))

    expect(onNamingChange).toHaveBeenCalledWith({ ...naming, mode: 'custom' })
  })

  it('fills successive groups from names pasted on separate lines', () => {
    const naming = { mode: 'custom' as const, customName: '', customGroupNames: {} }
    const plan = createPlan(naming)
    const onNamingChange = vi.fn()

    render(<LnkResultConclusionsPanel plan={plan} naming={naming} onNamingChange={onNamingChange} />)
    fireEvent.paste(screen.getByRole('textbox', { name: 'Название заключения: Стык F5' }), {
      clipboardData: { getData: () => 'Первое заключение\nВторое заключение' },
    })

    expect(onNamingChange).toHaveBeenCalledWith({
      ...naming,
      customGroupNames: {
        [plan.groups[0].key]: 'Первое заключение',
        [plan.groups[1].key]: 'Второе заключение',
      },
    })
  })

  it('marks duplicate custom names inside their rows', () => {
    const groupNames = createPlan({ mode: 'system', customName: '' }).groups
    const naming = {
      mode: 'custom' as const,
      customName: '',
      customGroupNames: {
        [groupNames[0].key]: 'Одинаковое',
        [groupNames[1].key]: 'Одинаковое',
      },
    }

    render(<LnkResultConclusionsPanel plan={createPlan(naming)} naming={naming} onNamingChange={vi.fn()} />)

    expect(screen.getAllByText('Название повторяется')).toHaveLength(2)
  })
})
