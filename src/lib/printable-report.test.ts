import { describe, expect, it } from 'vitest'
import { buildPrintableReportHtml } from '@/lib/printable-report'

describe('printable report', () => {
  it('builds a preview with print controls, metrics, chart and table', () => {
    const html = buildPrintableReportHtml({
      title: 'Статистика <проекта>',
      metrics: [{ label: 'Сварено', value: '12', tone: 'green' }],
      charts: [{ title: 'Динамика', valueLabel: 'стыков', items: [{ label: '01.07', value: 4 }] }],
      tables: [{ title: 'Линии', columns: ['Линия'], rows: [['A-1']] }],
    })

    expect(html).toContain('Печать / Сохранить PDF')
    expect(html).toContain('id="print-report"')
    expect(html).toContain('Статистика &lt;проекта&gt;')
    expect(html).toContain('Динамика')
    expect(html).toContain('A-1')
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
