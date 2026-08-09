import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetPageScrollPosition } from '@/lib/page-scroll-position'

describe('resetPageScrollPosition', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clears every browser scroll container before a report changes', () => {
    document.documentElement.scrollLeft = 420
    document.body.scrollLeft = 320
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    resetPageScrollPosition()

    expect(document.documentElement.scrollLeft).toBe(0)
    expect(document.body.scrollLeft).toBe(0)
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 0, behavior: 'auto' })
  })
})
