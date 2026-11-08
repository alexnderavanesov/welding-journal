import type { DocumentTemplateConstructorConfig } from './document-template-model'
import { loadXlsx, preserveTemplateWorkbookXml } from './document-template-xlsx'

// One-time release conversion. Import/runtime field lookup accepts only current names.
const removedKeys = new Set(['stamp1O', 'stamp2K', 'stamp2Z', 'stamp2O', 'stamp1OFact', 'stamp2KFact', 'stamp2ZFact', 'stamp2OFact'])
const removedField = (field: unknown) => typeof field === 'string' && removedKeys.has(field.replace(/^__welderName:/, ''))

export function simplifyStampTemplateConfig(config: DocumentTemplateConstructorConfig): DocumentTemplateConstructorConfig {
  const bindings = config.bindings.map(binding => {
    const parts = binding.parts?.filter(part => !removedField(part.field) && !removedField(part.compareField))
    const field = removedField(binding.field) || (binding.parts?.length && !parts?.length) ? undefined : binding.field
    const cleared = Boolean(binding.field && !field) || Boolean(binding.parts?.length && !parts?.length)
    return { ...binding, field, parts, ...(cleared ? { emptyMode: 'blank' as const, emptyText: undefined } : {}) }
  })
  const removedGrouping = removedField(config.repeatGroupBy)
  return { ...config, bindings,
    ...(removedGrouping ? { repeatGroupBy: undefined, repeatMode: 'rows' as const } : {}),
    nameConfig: config.nameConfig ? { ...config.nameConfig, parts: config.nameConfig.parts.filter(part => !removedField(part.field)) } : undefined,
  }
}

export function simplifyStampTemplateText(text: string) {
  if (/^(?:Облицовка_[12]|Корень_2|Заполнение_2)(?:\s*-?\s*факт|\s*ФИО сварщика)?$/i.test(text.trim())) return ''
  return text.replace(/\{\{([^{}]+)\}\}/g, (_marker, token: string) => {
    const name = token.trim()
    if (/^(?:Облицовка_[12]|Корень_2|Заполнение_2)(?=\s|ФИО|\/|\||$)/i.test(name)) return ''
    const renamed = token.replace(/^(\s*)(Корень_1|Заполнение_1)(?=\s|ФИО|\/|\||$)/,
      (_, whitespace: string, label: string) => `${whitespace}${label === 'Корень_1' ? 'Клеймо_1' : 'Клеймо_2'}`)
    return `{{${renamed}}}`
  }).replace(/^(Корень_1|Заполнение_1)(\s*-?\s*факт)?$/, (_, label: string, suffix: string = '') =>
    `${label === 'Корень_1' ? 'Клеймо_1' : 'Клеймо_2'}${suffix ? ' - факт' : ''}`)
}

export async function simplifyStampTemplateFile(data: ArrayBuffer): Promise<ArrayBuffer | null> {
  const xlsx = await loadXlsx()
  const workbook = xlsx.read(data, { type: 'array', cellStyles: true })
  let changed = false
  for (const name of workbook.SheetNames) for (const [address, cell] of Object.entries(workbook.Sheets[name])) {
    if (address.startsWith('!') || typeof cell?.v !== 'string' || cell.f) continue
    const next = simplifyStampTemplateText(cell.v)
    if (next === cell.v) continue
    cell.v = next
    delete cell.w; delete cell.r; delete cell.h
    changed = true
  }
  if (!changed) return null
  const generated = xlsx.write(workbook, { type: 'array', bookType: 'xlsx', cellStyles: true }) as ArrayBuffer
  return preserveTemplateWorkbookXml(data, generated, { sheetIndex: 0, markerRow: 0, recordCount: 1 })
}
