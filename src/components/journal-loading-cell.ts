import type { ILoadingCellRendererComp, ILoadingCellRendererParams } from 'ag-grid-community'

/** Failed obsolete stores still have to settle AG's request slots. Their cells
 * use the same placeholder; current request failures are shown once above the
 * viewport, with an explicit retry, instead of repeated in every empty cell. */
export class JournalLoadingCell implements ILoadingCellRendererComp {
  private element!: HTMLDivElement
  init(params: ILoadingCellRendererParams) {
    this.element = document.createElement('div')
    this.element.className = 'journal-loading-cell'
    this.element.setAttribute('aria-hidden', 'true')
    const bar = document.createElement('span')
    const column = params.column?.getColId() ?? ''
    const seed = [...column].reduce((sum, letter) => sum + letter.charCodeAt(0), params.node.rowIndex ?? 0)
    bar.style.width = `${45 + (seed % 5) * 10}%`
    this.element.append(bar)
  }
  getGui() { return this.element }
}
