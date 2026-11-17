import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginationBar } from '@/components/pagination-bar'

describe('PaginationBar independent summary', () => {
  let intersect: () => void
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        intersect = () => callback([{ isIntersecting: true }])
      }
      observe() {}
      disconnect() {}
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('does not invent a total while counts wait or fail and keeps paging controls available', () => {
    const props = { totalCount: undefined, firstItemNumber: 1, lastItemNumber: 100,
      pageSize: 100, hasMore: true, onLoadMore: vi.fn(), onPageSizeChange: vi.fn() }
    const { rerender } = render(<PaginationBar {...props} summaryStatus="pending" />)
    expect(screen.getByText('1-100')).toBeVisible()
    expect(screen.getByText('Идёт подсчёт…')).toBeVisible()
    expect(screen.queryByText(/из 0 строк/)).not.toBeInTheDocument()
    expect(screen.getByText('дальше подгрузится при скролле')).toBeVisible()
    intersect()
    expect(props.onLoadMore).toHaveBeenCalledTimes(1)
    rerender(<PaginationBar {...props} summaryStatus="error" />)
    expect(screen.getByText('Итоги недоступны')).toBeVisible()
    expect(screen.queryByText('показано все')).not.toBeInTheDocument()
    intersect()
    expect(props.onLoadMore).toHaveBeenCalledTimes(2)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '300' } })
    expect(props.onPageSizeChange).toHaveBeenCalledWith(300)
    rerender(<PaginationBar {...props} firstItemNumber={0} lastItemNumber={0} totalCount={0} hasMore={false} summaryStatus="ready" />)
    expect(screen.getByText('из 0 строк')).toBeVisible()
    expect(screen.getByText('показано все')).toBeVisible()
  })

  it('does not claim all rows are shown while retained rows belong to a pending filter', () => {
    render(<PaginationBar totalCount={undefined} summaryStatus="pending" rowsLoading
      firstItemNumber={1} lastItemNumber={100} pageSize={100} hasMore={false}
      onLoadMore={vi.fn()} onPageSizeChange={vi.fn()} />)
    expect(screen.getByText('Загружаются строки…')).toBeVisible()
    expect(screen.queryByText('показано все')).not.toBeInTheDocument()
  })

  it('stops automatic retries after a page error and allows an explicit retry with retained rows', () => {
    const observe = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      observe = observe
      disconnect() {}
    })
    const onLoadMore = vi.fn()
    const props = { totalCount: 351, firstItemNumber: 1, lastItemNumber: 100,
      pageSize: 100, hasMore: true, onLoadMore, onPageSizeChange: vi.fn() }
    const { rerender } = render(<PaginationBar {...props} loadError="Нет связи" />)
    expect(observe).not.toHaveBeenCalled()
    expect(screen.getByText('1-100')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Нет связи')
    expect(screen.queryByText('дальше подгрузится при скролле')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
    expect(onLoadMore).toHaveBeenCalledOnce()
    rerender(<PaginationBar {...props} />)
    expect(observe).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
