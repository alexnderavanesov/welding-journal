import { describe, expect, it } from 'vitest'
import { keepSchemePdfPreview, takeSchemePdfPreview } from './line-scheme-pdf-preview'

function canvas(width = 800, height = 600) {
  const result = document.createElement('canvas'); result.width = width; result.height = height; return result
}
describe('bounded immutable PDF preview', () => {
  it('reuses the same pixels only for the same revision at sufficient resolution', () => {
    takeSchemePdfPreview('first', 800, 600)
    const bitmap = canvas(); keepSchemePdfPreview('first', bitmap)
    expect(takeSchemePdfPreview('first', 400, 300)).toBe(bitmap)
    expect(takeSchemePdfPreview('first', 400, 300)).toBeUndefined()
    keepSchemePdfPreview('first', bitmap)
    expect(takeSchemePdfPreview('first', 1600, 1200)).toBeUndefined()
    expect(bitmap.width).toBe(0)
  })
  it('releases the previous revision and rejects a delayed close from it', () => {
    takeSchemePdfPreview('old', 800, 600)
    const old = canvas(); keepSchemePdfPreview('old', old)
    expect(takeSchemePdfPreview('new', 800, 600)).toBeUndefined()
    expect(old.width).toBe(0)
    const delayed = canvas(); keepSchemePdfPreview('old', delayed)
    expect(delayed.width).toBe(0)
    expect(takeSchemePdfPreview('new', 800, 600)).toBeUndefined()
  })
  it('keeps only one detached bitmap and releases it on replacement', () => {
    takeSchemePdfPreview('only', 800, 600)
    const first = canvas(), second = canvas()
    document.body.append(first, second)
    keepSchemePdfPreview('only', first); keepSchemePdfPreview('only', second)
    expect(first.width).toBe(0)
    expect(second.isConnected).toBe(false)
    expect(takeSchemePdfPreview('only', 800, 600)).toBe(second)
  })
})
