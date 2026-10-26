import { describe, expect, it, vi } from 'vitest'
import { buildPrintableReportHtml } from '@/lib/printable-report'

describe('printable report', () => {
  it('retains the snapshot time when rebuilding a page or printing later', () => {
    const report = { title: 'Snapshot', generatedAt: '2026-10-25T10:00:00.000Z' }
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-25T11:00:00.000Z'))
      const first = buildPrintableReportHtml(report)
      vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'))
      expect(buildPrintableReportHtml(report)).toBe(first)
      expect(first).toContain(new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(report.generatedAt)))
    } finally { vi.useRealTimers() }
  })

  it('compacts only runs of genuinely empty print cells, preserving every column, value and row kind', () => {
    const columns = Array.from({ length: 111 }, (_, i) => `Column ${i}`)
    const rows = Array.from({ length: 120 }, (_, i) => columns.map((_, column) => column === 0 ? `S${i}` : column === 55 ? 0 : column === 110 ? '<last>\nстрока' : ''))
    const report = { title: 'Wide', tables: [{ title: '', columns, rows, rowKinds: rows.map(() => 'detail' as const) }] }
    const ordinary = new DOMParser().parseFromString(buildPrintableReportHtml(report), 'text/html')
    const compact = new DOMParser().parseFromString(buildPrintableReportHtml(report, { compactPrint: true }), 'text/html')
    expect(ordinary.querySelectorAll('td')).toHaveLength(120 * 111)
    expect(compact.querySelectorAll('td').length).toBeLessThan(120 * 10)
    expect(compact.querySelectorAll('thead th')).toHaveLength(111)
    const expanded = [...compact.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')]
      .flatMap(cell => cell.colSpan > 1 ? Array(cell.colSpan).fill('') : [cell.textContent]))
    expect(expanded).toEqual(rows.map(row => row.map(String)))
    expect(compact.querySelectorAll('.table-row-detail')).toHaveLength(120)
    expect(compact.querySelector('last')).toBeNull()
  })

  it('keeps whitespace, zero and non-empty placeholders as real print cells', () => {
    const values = ['', '', '', ' ', 0, '—', '', '', 'end']
    const doc = new DOMParser().parseFromString(buildPrintableReportHtml({ title: 'Edges',
      tables: [{ title: '', columns: values.map(String), rows: [values] }] }, { compactPrint: true }), 'text/html')
    const cells = [...doc.querySelectorAll('tbody td')]
    expect(cells.map(cell => cell.textContent)).toEqual(['', ' ', '0', '—', '', '', 'end'])
    expect(cells[0].getAttribute('colspan')).toBe('3')
  })

  it('omits standalone controls in the embedded preview while retaining escaped content and print layout', () => {
    const html = buildPrintableReportHtml({ title: '<Сводка>', tables: [{ title: 'Линии', columns: ['Линия'], rows: [['<L1>']] }] }, { embedded: true })
    expect(html).not.toContain('<div class="toolbar">')
    expect(html).not.toContain('id="print-report"')
    expect(html).toContain('<td>&lt;L1&gt;</td>')
    expect(html).toContain('@page { size: A4 landscape;')
    expect(html).toContain('thead { display: table-header-group; }')
  })
  it('builds a preview with print controls, metrics, chart and table', () => {
    const html = buildPrintableReportHtml({
      title: 'Статистика <проекта>',
      metrics: [{ label: 'Сварено', value: '12', tone: 'green' }],
      charts: [{ title: 'Динамика', valueLabel: 'стыков', items: [{ label: '01.07', value: 4 }] }],
      tables: [{ title: 'Линии', columns: ['Линия'], rows: [['A-1']], rowKinds: ['group'] }],
    })

    expect(html).toContain('Печать / Сохранить PDF')
    expect(html).toContain('id="print-report"')
    expect(html).toContain('Статистика &lt;проекта&gt;')
    expect(html).toContain('Динамика')
    expect(html).toContain('A-1')
    expect(html).toContain('class="table-row-group"')
  })

  it('escapes report content instead of inserting executable markup', () => {
    const html = buildPrintableReportHtml({
      title: '<script>alert(1)</script>',
      tables: [{ title: 'Данные', columns: ['Значение'], rows: [['<img src=x onerror=alert(1)>']] }],
    })

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
