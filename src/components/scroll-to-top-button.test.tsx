import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ScrollToTopButton } from '@/components/scroll-to-top-button'

describe('ScrollToTopButton', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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

  it('keeps the arrow inside the report boundary and updates its inset on resize', () => {
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(900)
    const { container } = render(<><div data-scroll-top-boundary /><ScrollToTopButton /></>)
    const boundary = container.querySelector('[data-scroll-top-boundary]')!
    let right = window.innerWidth - 60
    vi.spyOn(boundary, 'getBoundingClientRect').mockImplementation(() => ({ right, width: 500 }) as DOMRect)
    fireEvent.scroll(window)
    expect(screen.getByRole('button', { name: 'Вернуться в начало страницы' })).toHaveStyle({ right: '76px' })
    right = window.innerWidth + 500
    fireEvent.resize(window)
    expect(screen.getByRole('button', { name: 'Вернуться в начало страницы' })).toHaveStyle({ right: '16px' })
  })

  it('does not remeasure the journal gutter during vertical scroll, including a late boundary', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    let y = 0, x = 0
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y)
    vi.spyOn(window, 'scrollX', 'get').mockImplementation(() => x)
    const { rerender } = render(<><ScrollToTopButton stableHorizontalBoundary /></>)
    // The route can finish its Suspense render after the fixed button mounts.
    rerender(<><ScrollToTopButton stableHorizontalBoundary /><div data-scroll-top-boundary /></>)
    const boundary = document.querySelector('[data-scroll-top-boundary]')!
    const measure = vi.spyOn(boundary, 'getBoundingClientRect').mockReturnValue({ right: window.innerWidth - 40, width: 500 } as DOMRect)
    y = 600; fireEvent.scroll(window)
    expect(screen.getByRole('button', { name: 'Вернуться в начало страницы' })).toHaveStyle({ right: '56px' })
    measure.mockClear()
    for (let i = 0; i < 10; i++) { y += 20; fireEvent.scroll(window) }
    expect(measure).not.toHaveBeenCalled()
    x = 20; fireEvent.scroll(window)
    expect(measure).toHaveBeenCalledTimes(1)
    fireEvent.resize(window)
    expect(measure).toHaveBeenCalledTimes(2)
  })
})
