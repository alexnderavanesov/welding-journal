import { describe, expect, it } from 'vitest'
import { pdfFitScale, pdfFootprint, turnPdfPoint, unturnPdfPoint } from './line-scheme-pdf-camera'

describe('PDF point coordinates', () => {
  it.each([
    [0, .2, .7], [90, .3, .2], [180, .8, .3], [270, .7, .8], [450, .3, .2],
  ])('maps a top-left page fraction through rotation %s', (rotation, x, y) => {
    const screen = turnPdfPoint({ x: .2, y: .7 }, rotation)
    expect(screen.x).toBeCloseTo(x); expect(screen.y).toBeCloseTo(y)
    const placed = unturnPdfPoint({ x, y }, rotation)
    expect(placed.x).toBeCloseTo(.2); expect(placed.y).toBeCloseTo(.7)
  })
  it('fits the rotated sheet, preserving space for its edges', () => {
    const size = pdfFootprint({ width: 800, height: 400 }, 90)
    expect(size).toEqual({ width: 400, height: 800 })
    expect(pdfFitScale(size, { width: 1048, height: 648 }, 'fit-page')).toBe(.75)
    expect(pdfFitScale(size, { width: 1048, height: 648 }, 'fit-width')).toBe(2.5)
  })
})
