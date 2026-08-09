import { describe, expect, it } from 'vitest'

import { getSidebarViewportCorrection } from '@/components/app-sidebar'

describe('getSidebarViewportCorrection', () => {
  it('compensates a fixed sidebar shifted left by the browser', () => {
    expect(getSidebarViewportCorrection(0, -12)).toBe(12)
  })

  it('removes an obsolete correction when the browser returns the sidebar to the viewport', () => {
    expect(getSidebarViewportCorrection(12, 12)).toBe(0)
  })

  it('keeps a correctly aligned sidebar unchanged', () => {
    expect(getSidebarViewportCorrection(0, 0)).toBe(0)
  })
})
