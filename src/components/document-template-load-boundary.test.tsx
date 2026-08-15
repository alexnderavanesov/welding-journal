import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DocumentTemplateLoadBoundary } from '@/components/document-template-load-boundary'

describe('DocumentTemplateLoadBoundary', () => {
  it('hides all template actions while the saved state is loading', () => {
    render(
      <DocumentTemplateLoadBoundary isLoading error={null} onRetry={() => undefined}>
        <button type="button">Загрузить первый шаблон</button>
      </DocumentTemplateLoadBoundary>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Загружаем настройки шаблонов')
    expect(screen.queryByRole('button', { name: 'Загрузить первый шаблон' })).not.toBeInTheDocument()
  })

  it('keeps template actions blocked after an error and allows a safe retry', () => {
    const onRetry = vi.fn()
    render(
      <DocumentTemplateLoadBoundary isLoading={false} error="Временная ошибка" onRetry={onRetry}>
        <button type="button">Загрузить первый шаблон</button>
      </DocumentTemplateLoadBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Временная ошибка')
    expect(screen.queryByRole('button', { name: 'Загрузить первый шаблон' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows template actions only after loading succeeds', () => {
    render(
      <DocumentTemplateLoadBoundary isLoading={false} error={null} onRetry={() => undefined}>
        <button type="button">Загрузить первый шаблон</button>
      </DocumentTemplateLoadBoundary>,
    )

    expect(screen.getByRole('button', { name: 'Загрузить первый шаблон' })).toBeVisible()
  })
})
