import { Badge } from '@/components/ui/badge'

export function getCellKey(rowId: number, fieldKey: string) {
  return `${rowId}:${fieldKey}`
}

export function isYesText(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'да' || text === 'дополнительный'
}

export function isNoText(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'нет'
}

export function isCancelledText(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'отменен'
}

export function isAdditionalText(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'дополнительный'
}

export function YesBadge() {
  return <Badge className="bg-background px-2 py-0.5 text-xs font-normal text-slate-600">да</Badge>
}

export function CancelledBadge() {
  return <Badge className="bg-amber-50 px-2 py-0.5 text-xs font-normal text-amber-700">отменен</Badge>
}

export function AdditionalBadge() {
  return <Badge className="bg-sky-50 px-2 py-0.5 text-xs font-normal text-sky-700">дополнительный</Badge>
}

export function ResultBadge({ value }: { value: unknown }) {
  const text = String(value ?? '').trim()
  const normalized = text.toLowerCase()
  if (!text) return ''

  const className =
    normalized === 'годен' ||
    normalized === 'проведено' ||
    normalized === 'годен (отменен)' ||
    normalized === 'проведено (отменен)'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : normalized === 'ремонт' || normalized === 'вырез' || normalized === 'не годен' || normalized === 'ошибка'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : normalized === 'ожидает' || normalized === 'ожидает нк' || normalized === 'ожидает заявку'
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : normalized === 'нет потребности' || normalized === 'отменен'
            ? 'border-slate-300 bg-slate-100 text-slate-600'
          : 'border-slate-200 bg-slate-50 text-slate-600'

  return (
    <Badge
      variant="outline"
      className={`inline-flex max-w-full justify-center whitespace-normal break-words px-1.5 py-0.5 text-center text-[11px] font-normal leading-tight ${className}`}
    >
      {text}
    </Badge>
  )
}
