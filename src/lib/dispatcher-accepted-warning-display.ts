export type AcceptedWarningContextPart = {
  label: string
  value: string
}

type AcceptedWarningDisplayInput = {
  key: string
  kind: string
  context: string
}

const CONTEXT_LABELS: Record<string, string[]> = {
  'percentage-line-control': ['Проект', 'Шифр', 'Линия', 'Клеймо'],
  'line-consistency': ['Проект', 'Шифр', 'Линия', 'Проверка'],
  'welder-stamp-expiry': ['Клеймо', 'Допуск', 'Срок'],
  create: ['Проект', 'Шифр', 'Линия', 'Стык'],
  coil: ['Проект', 'Шифр', 'Линия', 'Стык'],
  delete: ['Проект', 'Шифр', 'Линия', 'Стык'],
  rename: ['Проект', 'Шифр', 'Линия', 'Стык'],
  check: ['Проект', 'Шифр', 'Линия', 'Стык'],
  'duplicate-check': ['Проект', 'Шифр', 'Линия', 'Стык'],
}

export function getAcceptedWarningContextParts({
  key,
  kind,
  context,
}: AcceptedWarningDisplayInput): AcceptedWarningContextPart[] {
  const savedParts = splitSavedContext(context)
  if (savedParts.length > 0) return addMissingLabels(savedParts, CONTEXT_LABELS[kind] ?? [])

  return parseLegacyWarningKey(key, kind)
}

function splitSavedContext(context: string): AcceptedWarningContextPart[] {
  return context
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf(':')
      if (separatorIndex <= 0) return { label: '', value: part }
      return {
        label: part.slice(0, separatorIndex).trim(),
        value: part.slice(separatorIndex + 1).trim(),
      }
    })
    .filter((part) => part.value)
}

function addMissingLabels(parts: AcceptedWarningContextPart[], labels: string[]) {
  return parts.map((part, index) => ({
    label: part.label || labels[index] || 'Контекст',
    value: part.value,
  }))
}

function parseLegacyWarningKey(key: string, kind: string): AcceptedWarningContextPart[] {
  if (kind === 'percentage-line-control') {
    const summaryKey = key.split(':')[2] ?? ''
    const [project, subtitle, line, stamp] = summaryKey.split('|')
    return toParts([
      ['Проект', project],
      ['Шифр', subtitle],
      ['Линия', line],
      ['Клеймо', stamp?.toUpperCase()],
    ])
  }

  if (kind === 'line-consistency') {
    const [, field, project, subtitle, line] = key.split(':')
    return toParts([
      ['Проект', project],
      ['Шифр', subtitle],
      ['Линия', line],
      ['Проверка', getLegacyLineFieldLabel(field)],
    ])
  }

  if (kind === 'welder-stamp-expiry') {
    const [, permitKind, , stamp, permitNumber, validTo] = key.split(':')
    return toParts([
      ['Клеймо', stamp?.toUpperCase()],
      ['Допуск', permitKind === 'dls' ? 'ДЛС' : permitKind === 'naks' ? 'НАКС' : permitKind],
      ['Номер', permitNumber],
      ['Действует до', validTo],
    ])
  }

  return []
}

function toParts(entries: Array<[string, string | undefined]>): AcceptedWarningContextPart[] {
  return entries
    .map(([label, value]) => ({ label, value: String(value ?? '').trim() }))
    .filter((part) => part.value)
}

function getLegacyLineFieldLabel(field: string | undefined) {
  switch (field) {
    case 'weldControlPercent':
      return 'Контроль швов, (%)'
    case 'groupName':
      return 'Группа трубопровода'
    case 'category':
      return 'Категория трубопровода'
    case 'controlPresence':
      return 'Назначение контроля'
    case 'pstoPresence':
      return 'ПСТО'
    default:
      return field
  }
}
