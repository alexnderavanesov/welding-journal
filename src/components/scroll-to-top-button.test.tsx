import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ScrollToTopButton } from '@/components/scroll-to-top-button'

describe('ScrollToTopButton', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('appears after page scrolling and smoothly returns to the top', () => {
    let scrollY = 0
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY)
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(720)
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    render(<ScrollToTopButton />)
    expect(screen.queryByRole('button', { name: 'Вернуться в начало страницы' })).not.toBeInTheDocument()

    scrollY = 900
    fireEvent.scroll(window)
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться в начало страницы' }))

    expect(scrollTo).toHaveBeenCalledWith({ left: 720, top: 0, behavior: 'smooth' })
  })

  it('returns a dedicated page scroll area to its beginning', () => {
    const { container } = render(
      <>
        <div data-page-scroll-container />
        <ScrollToTopButton />
      </>,
    )
    const scrollArea = container.querySelector<HTMLElement>('[data-page-scroll-container]')
    if (!scrollArea) throw new Error('Ожидалась область прокрутки страницы')
    Object.defineProperty(scrollArea, 'scrollTop', { configurable: true, value: 900, writable: true })
    Object.defineProperty(scrollArea, 'scrollLeft', { configurable: true, value: 180, writable: true })
    const scrollTo = vi.fn()
    scrollArea.scrollTo = scrollTo

    fireEvent.scroll(scrollArea)
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться в начало страницы' }))

    expect(scrollTo).toHaveBeenCalledWith({ left: 180, top: 0, behavior: 'smooth' })
  })
})
