export type PrintableReportMetric = {
  label: string
  value: string
  detail?: string
  tone?: 'blue' | 'green' | 'amber' | 'rose' | 'slate'
}

export type PrintableReportChartItem = {
  label: string
  value: number
  detail?: string
}

export type PrintableReportChart = {
  title: string
  subtitle?: string
  valueLabel: string
  items: PrintableReportChartItem[]
}

export type PrintableReportTable = {
  title: string
  subtitle?: string
  columns: string[]
  rows: Array<Array<string | number>>
}

export type PrintableReport = {
  title: string
  subtitle?: string
  meta?: Array<{ label: string; value: string }>
  metrics?: PrintableReportMetric[]
  charts?: PrintableReportChart[]
  tables?: PrintableReportTable[]
  emptyMessage?: string
}

export function openPrintableReport(report: PrintableReport) {
  const reportWindow = window.open('', '_blank')
  if (!reportWindow) {
    window.alert('Браузер заблокировал новую вкладку. Разрешите всплывающие окна для сайта и повторите.')
    return false
  }

  reportWindow.document.open()
  reportWindow.document.write(buildPrintableReportHtml(report))
  reportWindow.document.close()
  reportWindow.document.getElementById('print-report')?.addEventListener('click', () => reportWindow.print())
  reportWindow.document.getElementById('close-report')?.addEventListener('click', () => reportWindow.close())
  return true
}

export function buildPrintableReportHtml(report: PrintableReport) {
  const generatedAt = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date())
  const title = escapeHtml(report.title)
  const subtitle = report.subtitle ? `<p class="report-subtitle">${escapeHtml(report.subtitle)}</p>` : ''
  const meta = renderMeta(report.meta ?? [], generatedAt)
  const metrics = renderMetrics(report.metrics ?? [])
  const charts = (report.charts ?? []).map(renderChart).join('')
  const tables = (report.tables ?? []).map(renderTable).join('')
  const hasContent = Boolean(metrics || charts || tables)
  const empty = hasContent
    ? ''
    : `<div class="empty">${escapeHtml(report.emptyMessage ?? 'В выбранном срезе нет данных для отчета.')}</div>`

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      color: #243247;
      background: #eef3f7;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef3f7; }
    .toolbar {
      position: sticky; top: 0; z-index: 20;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 12px 24px; border-bottom: 1px solid #d7e0e8;
      background: rgba(255,255,255,.96); backdrop-filter: blur(10px);
    }
    .toolbar-copy { min-width: 0; }
    .toolbar-title { margin: 0; color: #172033; font-size: 14px; font-weight: 700; }
    .toolbar-note { margin: 3px 0 0; color: #718096; font-size: 12px; }
    .toolbar-actions { display: flex; gap: 8px; flex: 0 0 auto; }
    button {
      min-height: 36px; padding: 0 14px; border: 1px solid #cbd6e2; border-radius: 6px;
      background: #fff; color: #334155; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer;
    }
    button.primary { border-color: #182236; background: #182236; color: #fff; }
    .sheet {
      width: min(1480px, calc(100% - 32px)); margin: 20px auto; padding: 28px;
      border: 1px solid #d9e2ea; border-radius: 8px; background: #fff;
      box-shadow: 0 12px 35px rgba(27, 42, 63, .08);
    }
    .report-header { padding-bottom: 18px; border-bottom: 2px solid #c9d7e3; }
    h1 { margin: 0; color: #142033; font-size: 26px; line-height: 1.2; letter-spacing: 0; }
    .report-subtitle { max-width: 980px; margin: 8px 0 0; color: #64748b; font-size: 13px; line-height: 1.5; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 14px; color: #52647a; font-size: 12px; }
    .meta-item strong { margin-right: 5px; color: #25364b; }
    .metrics {
      display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px;
      margin-top: 18px;
    }
    .metric {
      min-height: 86px; padding: 11px 12px; border: 1px solid #dbe4ec; border-radius: 6px;
      background: #f8fafc; break-inside: avoid;
    }
    .metric.blue { border-color: #c8e3f3; background: #f1f9fd; }
    .metric.green { border-color: #c7eadc; background: #f1fbf7; }
    .metric.amber { border-color: #f1dfae; background: #fffaf0; }
    .metric.rose { border-color: #f0ced4; background: #fff6f7; }
    .metric-label { color: #71839a; font-size: 10px; font-weight: 750; text-transform: uppercase; letter-spacing: .04em; }
    .metric-value { margin-top: 6px; color: #172033; font-size: 20px; font-weight: 750; }
    .metric-detail { margin-top: 5px; color: #607188; font-size: 10px; line-height: 1.35; }
    .section {
      margin-top: 20px; padding-top: 2px; break-inside: avoid-page;
    }
    .section-title { margin: 0; color: #1c2a3d; font-size: 16px; }
    .section-subtitle { margin: 5px 0 0; color: #718096; font-size: 11px; }
    .chart {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(42px, 1fr)); align-items: end;
      gap: 7px; min-height: 180px; margin-top: 12px; padding: 14px 12px 8px;
      border: 1px solid #dce5ed; border-radius: 6px; background: #fbfdff; overflow: hidden;
    }
    .chart-item { min-width: 0; text-align: center; break-inside: avoid; }
    .bar-track {
      position: relative; height: 118px; border: 1px solid #e1e8ef; border-radius: 5px 5px 2px 2px;
      background: #f5f8fb; overflow: hidden;
    }
    .bar-fill {
      position: absolute; right: 4px; bottom: 0; left: 4px; min-height: 0;
      border-radius: 4px 4px 0 0; background: #43a9dc;
    }
    .bar-value { margin-top: 6px; color: #1f4f70; font-size: 10px; font-weight: 750; }
    .bar-label { margin-top: 3px; overflow: hidden; color: #52647a; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
    .bar-detail { min-height: 12px; margin-top: 2px; color: #7a8aa0; font-size: 8px; }
    .table-wrap {
      margin-top: 12px; border: 1px solid #d6e0e8; border-radius: 6px; overflow: hidden;
      break-inside: auto;
    }
    table { width: 100%; border-collapse: collapse; table-layout: auto; font-size: 9px; }
    thead { display: table-header-group; }
    th {
      padding: 7px 8px; border-right: 1px solid #d4dee7; border-bottom: 2px solid #c5d4df;
      background: #edf3f7; color: #334155; text-align: left; font-weight: 750;
    }
    td {
      padding: 6px 8px; border-top: 1px solid #e3e9ef; border-right: 1px solid #e6ebf0;
      color: #405168; vertical-align: top; overflow-wrap: anywhere;
    }
    th:last-child, td:last-child { border-right: 0; }
    tbody tr:nth-child(even) td { background: #f8fafc; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .empty { margin-top: 18px; padding: 30px; border: 1px dashed #cad6e1; border-radius: 6px; color: #718096; text-align: center; }
    @media (max-width: 900px) {
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .sheet { width: calc(100% - 16px); margin: 8px auto; padding: 18px; }
    }
    @page { size: A4 landscape; margin: 9mm; }
    @media print {
      :root, body { background: #fff; }
      .toolbar { display: none !important; }
      .sheet { width: auto; margin: 0; padding: 0; border: 0; border-radius: 0; box-shadow: none; }
      .metrics { grid-template-columns: repeat(5, minmax(0, 1fr)); }
      .section { break-inside: auto; }
      .chart, .metric { break-inside: avoid; }
      .table-wrap { overflow: visible; }
      h1 { font-size: 21px; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-copy">
      <p class="toolbar-title">Предпросмотр отчета</p>
      <p class="toolbar-note">Проверьте отчет, затем выберите «Печать / Сохранить PDF».</p>
    </div>
    <div class="toolbar-actions">
      <button id="close-report" type="button">Закрыть</button>
      <button id="print-report" type="button" class="primary">Печать / Сохранить PDF</button>
    </div>
  </div>
  <main class="sheet">
    <header class="report-header">
      <h1>${title}</h1>
      ${subtitle}
      ${meta}
    </header>
    ${metrics}
    ${charts}
    ${tables}
    ${empty}
  </main>
</body>
</html>`
}

function renderMeta(items: Array<{ label: string; value: string }>, generatedAt: string) {
  const allItems = [...items, { label: 'Сформировано', value: generatedAt }]
  return `<div class="meta">${allItems
    .map((item) => `<span class="meta-item"><strong>${escapeHtml(item.label)}:</strong>${escapeHtml(item.value)}</span>`)
    .join('')}</div>`
}

function renderMetrics(metrics: PrintableReportMetric[]) {
  if (metrics.length === 0) return ''
  return `<section class="metrics">${metrics
    .map(
      (metric) => `<article class="metric ${metric.tone ?? 'slate'}">
        <div class="metric-label">${escapeHtml(metric.label)}</div>
        <div class="metric-value">${escapeHtml(metric.value)}</div>
        ${metric.detail ? `<div class="metric-detail">${escapeHtml(metric.detail)}</div>` : ''}
      </article>`,
    )
    .join('')}</section>`
}

function renderChart(chart: PrintableReportChart) {
  const maxValue = Math.max(0, ...chart.items.map((item) => item.value))
  const items = chart.items
    .map((item) => {
      const height = maxValue > 0 ? Math.max(item.value > 0 ? 3 : 0, (item.value / maxValue) * 100) : 0
      return `<div class="chart-item">
        <div class="bar-track"><div class="bar-fill" style="height:${height.toFixed(2)}%"></div></div>
        <div class="bar-value">${escapeHtml(formatNumber(item.value))}</div>
        <div class="bar-label" title="${escapeAttribute(item.label)}">${escapeHtml(item.label)}</div>
        <div class="bar-detail">${item.detail ? escapeHtml(item.detail) : ''}</div>
      </div>`
    })
    .join('')

  return `<section class="section">
    <h2 class="section-title">${escapeHtml(chart.title)}</h2>
    <p class="section-subtitle">${escapeHtml(chart.subtitle ?? chart.valueLabel)}</p>
    <div class="chart">${items}</div>
  </section>`
}

function renderTable(table: PrintableReportTable) {
  const header = table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')
  const rows = table.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`)
    .join('')
  return `<section class="section">
    <h2 class="section-title">${escapeHtml(table.title)}</h2>
    ${table.subtitle ? `<p class="section-subtitle">${escapeHtml(table.subtitle)}</p>` : ''}
    <div class="table-wrap">
      <table>
        <thead><tr>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll('\n', ' ')
}
