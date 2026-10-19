import { afterEach, describe, expect, it, vi } from 'vitest'
import { orderProgramGridDom } from './line-program-dom-order'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })
function fixture() {
  const root = document.createElement('div'); root.dataset.programGrid = 'lines'
  root.innerHTML = `<div class="rows"><div class="ag-row" row-index="0">Line A</div><div class="ag-row" row-index="2">Line B</div><div class="ag-row" row-index="1"><input value="Retained draft"></div><div class="ag-row" style="display:none">Cached</div></div>`
  document.body.append(root); return root
}

describe('program DOM order without reordering React fibers', () => {
  it('puts a cached detail between its line and the next line, preserving nodes and focus', () => {
    const root = fixture(), input = root.querySelector('input')!
    input.focus(); input.setSelectionRange(2, 5)
    orderProgramGridDom(root)
    expect([...root.querySelectorAll('.ag-row[row-index]')].map(row => row.getAttribute('row-index'))).toEqual(['0', '1', '2'])
    expect(root.querySelector('input')).toBe(input)
    expect(input.value).toBe('Retained draft')
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(2)
    const insert = vi.spyOn(root.querySelector('.rows')!, 'insertBefore')
    orderProgramGridDom(root)
    expect(insert).not.toHaveBeenCalled()
  })
  it('orders new and replaced rows after filtering, without touching a nested grid', () => {
    const root = fixture()
    const nested = document.createElement('div'); nested.dataset.programGrid = 'joints'
    nested.innerHTML = '<div class="ag-row" row-index="3"></div><div class="ag-row" row-index="0"></div>'
    root.querySelector('.ag-row[row-index="1"]')!.append(nested)
    orderProgramGridDom(root)
    expect([...nested.children].map(row => row.getAttribute('row-index'))).toEqual(['3', '0'])
    const row = document.createElement('div'); row.className = 'ag-row'; row.setAttribute('row-index', '0')
    root.querySelector('.ag-row[row-index="0"]')!.remove()
    root.querySelector('.rows')!.append(row)
    orderProgramGridDom(root)
    // Hidden cached rows have no reading/tab order and can stay in place.
    expect(root.querySelector('.rows > .ag-row[row-index]')).toBe(row)
  })
  it('keeps header and cell reading order after column moves, separately for pinned sections', () => {
    const root = fixture()
    root.innerHTML = '<div class="header"><div class="ag-header-cell" aria-colindex="3"></div><div class="ag-header-cell" aria-colindex="2"></div></div><div class="left"><div class="ag-cell" aria-colindex="1"></div></div><div class="center"><div class="ag-cell" aria-colindex="3"></div><div class="ag-cell" aria-colindex="2"></div></div>'
    orderProgramGridDom(root)
    for (const selector of ['.header', '.center']) expect([...root.querySelector(selector)!.children].map(cell => cell.getAttribute('aria-colindex'))).toEqual(['2', '3'])
    expect(root.querySelector('.left')!.children).toHaveLength(1)
  })
})
