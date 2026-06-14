import type { WeldField, WeldFieldKey } from './weld-fields'

export const ACTIONS_COLUMN_WIDTH = 96

const COMPACT_FIELD_KEYS = new Set<WeldFieldKey>([
  'hasVik',
  'hasRk',
  'hasPvk',
  'hasUzk',
  'hasTvmt',
  'hasRfa',
  'hasStls',
  'hasMkk',
  'pstoRequired',
  'vikResult',
  'rkResult',
  'pvkResult',
  'uzkResult',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'mkkResult',
  'pstoResult',
])

const COLUMN_WIDTHS: Partial<Record<WeldFieldKey, number>> = {
  projectTitle: 112,
  subtitleCode: 112,
  line: 128,
  groupName: 92,
  category: 92,
  weldControlPercent: 104,
  isometry: 168,
  sheet: 64,
  revisionNumber: 72,
  revisionActuality: 104,
  spool: 86,
  spoolId: 90,
  joint: 74,
  status: 104,
  orderCode1: 112,
  orderCode2: 112,
  element1: 120,
  element2: 120,
  material1: 188,
  material2: 188,
  weldingMethod: 104,
  connectionType: 96,
  d1: 58,
  d2: 58,
  t1: 58,
  t2: 58,
  wdi: 70,
  weldDate: 112,
  responsible: 132,
  stamp1K: 86,
  stamp1Zo: 92,
  stamp2K: 86,
  stamp2Zo: 92,
  stamp1KFact: 112,
  stamp1ZoFact: 120,
  stamp2KFact: 112,
  stamp2ZoFact: 120,
  pstoRequest: 150,
  lnkRequest: 170,
  finalStatus: 116,
  boq: 70,
  ks3: 70,
}

export function getWeldColumnWidth(fieldKey: string) {
  const key = fieldKey as WeldFieldKey
  return COLUMN_WIDTHS[key] ?? (COMPACT_FIELD_KEYS.has(key) ? 82 : 120)
}

export function getWeldTableWidth(fields: readonly WeldField[]) {
  return Math.max(900, fields.reduce((total, field) => total + getWeldColumnWidth(field.key), 0) + ACTIONS_COLUMN_WIDTH)
}

export function isCompactWeldColumn(fieldKey: string) {
  return COMPACT_FIELD_KEYS.has(fieldKey as WeldFieldKey)
}
