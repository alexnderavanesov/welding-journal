import { LNK_EMPTY_RESULT_VALUE } from '@/lib/report-config'

export function getInactiveLnkRequestBadgeClass() {
  return 'border-slate-300 bg-slate-100 text-slate-600'
}

export function getLnkResultBadgeClass(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  if (result === LNK_EMPTY_RESULT_VALUE) return 'border-slate-300 bg-slate-100 text-slate-700'
  if (result === 'годен' || result === 'годен (отменен)') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (result === 'ремонт') return 'border-rose-200 bg-rose-50 text-rose-800'
  if (result === 'вырез') return 'border-red-300 bg-red-100 text-red-900'
  if (result === 'ожидает' || result === 'ожидает нк' || result === 'ожидает заявку') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (result === 'нет потребности') return getInactiveLnkRequestBadgeClass()
  if (result === 'отменен') return 'border-slate-300 bg-slate-100 text-slate-600'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

export function getPstoResultBadgeClass(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  if (result === 'проведено' || result === 'проведено (отменен)') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (result === 'отменен') return 'border-slate-300 bg-slate-100 text-slate-600'
  return 'border-amber-200 bg-amber-50 text-amber-800'
}

export function getPstoResultLabel(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  if (result === 'отменен') return 'отменен'
  if (result === 'ожидает заявку') return 'ожидает заявку'
  if (result === 'проведено (отменен)') return 'проведено (отменен)'
  return result === 'проведено' ? 'проведено' : 'ожидает'
}
