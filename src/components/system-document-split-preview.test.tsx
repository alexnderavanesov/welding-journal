import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SystemDocumentSplitPreview } from '@/components/system-document-split-preview'
import type { WeldRow } from '@/lib/dispatcher-types'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import { buildSystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'

const rows = [
  { id: 1, projectTitle: 'Проект', subtitleCode: '500', line: 'L-10', joint: 'F5' },
  { id: 2, projectTitle: 'Проект', subtitleCode: '600', line: 'L-20', joint: 'F6' },
] as WeldRow[]

const settings = {
  ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
  splitModes: {
    ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes,
    lnkConclusionVik: 'joint' as const,
  },
}

describe('SystemDocumentSplitPreview', () => {
  it('shows the subtitle and line without repeating the joint-group heading', () => {
    const naming = { mode: 'system' as const, customName: '' }
    const plan = buildSystemDocumentCreationPlan({
      type: 'lnkConclusion',
      methodCode: 'ВИК',
      date: '2026-08-25',
      rows,
      naming,
      settings,
      nextNumber: 13,
    })

    render(
      <SystemDocumentSplitPreview
        plan={plan}
        naming={naming}
        onNamingChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Показать группы/ }))

    expect(screen.getByText('Шифр: 500')).toBeInTheDocument()
    expect(screen.getByText('Линия: L-10')).toBeInTheDocument()
    expect(screen.queryByText('Стыки: F5')).not.toBeInTheDocument()
  })

  it('keeps the joint list for groups that contain more than a joint identity', () => {
    const naming = { mode: 'system' as const, customName: '' }
    const plan = buildSystemDocumentCreationPlan({
      type: 'lnkConclusion',
      methodCode: 'ВИК',
      date: '2026-08-25',
      rows,
      naming,
      settings: {
        ...settings,
        splitModes: { ...settings.splitModes, lnkConclusionVik: 'line' as const },
      },
      nextNumber: 13,
    })

    render(
      <SystemDocumentSplitPreview
        plan={plan}
        naming={naming}
        onNamingChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Показать группы/ }))

    expect(screen.getByText('Стыки: F5')).toBeInTheDocument()
  })

  it('immediately shows one custom-name field for every group', () => {
    const naming = { mode: 'custom' as const, customName: 'Общее имя' }
    const plan = buildSystemDocumentCreationPlan({
      type: 'lnkConclusion',
      methodCode: 'ВИК',
      date: '2026-08-25',
      rows,
      naming,
      settings,
    })

    render(
      <SystemDocumentSplitPreview
        plan={plan}
        naming={naming}
        onNamingChange={vi.fn()}
      />,
    )

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    expect(screen.queryByText(/Базовое \+ суффикс/)).not.toBeInTheDocument()
  })

  it('keeps typing local and commits a group name after a short pause', () => {
    vi.useFakeTimers()
    try {
      const naming = { mode: 'custom' as const, customName: '' }
      const plan = buildSystemDocumentCreationPlan({
        type: 'lnkConclusion',
        methodCode: 'ВИК',
        date: '2026-08-25',
        rows,
        naming,
        settings,
      })
      const onNamingChange = vi.fn()

      render(
        <SystemDocumentSplitPreview
          plan={plan}
          naming={naming}
          onNamingChange={onNamingChange}
        />,
      )

      const input = screen.getByRole('textbox', { name: 'Название документа: Стык F5' })
      fireEvent.change(input, { target: { value: 'ВИК-1' } })

      expect(input).toHaveValue('ВИК-1')
      expect(onNamingChange).not.toHaveBeenCalled()

      act(() => vi.advanceTimersByTime(150))

      expect(onNamingChange).toHaveBeenCalledWith({
        mode: 'custom',
        customName: '',
        customGroupNames: { [plan.groups[0].key]: 'ВИК-1' },
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
