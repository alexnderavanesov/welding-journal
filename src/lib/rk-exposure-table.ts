import type { RkExposureOption, RkExposureTableSettings } from '@/lib/other-settings'

export function parseRkExposureRows(rows: unknown[][]) {
  const entries: RkExposureTableSettings['entries'] = []
  let currentEntry: RkExposureTableSettings['entries'][number] | null = null
  let currentOption: RkExposureOption | null = null

  for (const row of rows) {
    const diameter = parseNumber(row[0])
    const exposure = normalizeText(row[1])
    const isDefault = normalizeText(row[2]) === '+'
    const note = normalizeText(row[3])
    if (diameter !== null) {
      const lastEntry = entries.at(-1)
      if (entries.some((entry) => entry.diameter === diameter) && lastEntry?.diameter !== diameter) {
        throw new Error(`Диаметр ${formatNumber(diameter)} должен находиться одним непрерывным блоком строк.`)
      }
      if (!currentEntry || currentEntry.diameter !== diameter) {
        currentEntry = { diameter, options: [] }
        entries.push(currentEntry)
      }
      currentOption = { values: [], isDefault, label: '', note }
      currentEntry.options.push(currentOption)
    } else if (isDefault || note) {
      throw new Error('Знак «+» и примечание должны стоять в первой строке варианта экспозиций.')
    }
    if (diameter === null && exposure && (!currentEntry || !currentOption)) {
      throw new Error('Первая строка варианта экспозиций должна содержать диаметр.')
    }
    if (!currentEntry || !currentOption || !exposure) continue
    currentOption.values.push(exposure)
  }

  if (entries.length === 0) throw new Error('В справочнике не найдены диаметры и варианты экспозиций.')
  entries.forEach((entry) => {
    entry.options = entry.options.filter((option) => option.values.length > 0)
    if (entry.options.length === 0) throw new Error(`Для диаметра ${formatNumber(entry.diameter)} не указаны экспозиции.`)
    const explicitDefaults = entry.options.filter((option) => option.isDefault)
    if (explicitDefaults.length > 1) throw new Error(`Для диаметра ${formatNumber(entry.diameter)} отмечено несколько вариантов по умолчанию.`)
    if (explicitDefaults.length === 0) entry.options[0].isDefault = true
    entry.options.forEach((option) => {
      option.label = buildRkExposureOptionLabel(option)
    })
  })
  if (!entries.every((entry, index) => index === 0 || entry.diameter > entries[index - 1].diameter)) {
    throw new Error('Диаметры в справочнике должны идти строго по возрастанию.')
  }
  return entries
}

export function buildRkExposureOptionLabel(option: Pick<RkExposureOption, 'values' | 'note'>) {
  const values = option.values.map((value) => value.trim()).filter(Boolean)
  const numericOnly = values.every((value) => /^\d+$/.test(value))
  const base = numericOnly
    ? `по ${values.length} ${values.length === 1 ? 'экспозиции' : 'экспозициям'}`
    : `по координатам ${values.join(' / ')}`
  return option.note ? `${base} (${option.note})` : base
}

function normalizeText(value: unknown) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim()
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).trim().replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',')
}
