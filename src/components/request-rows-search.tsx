import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type RequestRowsSearchProps = {
  value: string
  placeholder: string
  filteredCount: number
  availableCount: number
  onChange: (value: string) => void
}

export function RequestRowsSearch({ value, placeholder, filteredCount, availableCount, onChange }: RequestRowsSearchProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 min-w-64 flex-1 bg-white"
      />
      <span className="whitespace-nowrap px-2 text-xs text-slate-500">
        Найдено: {filteredCount} · Доступно: {availableCount}
      </span>
      {value ? (
        <Button variant="outline" size="sm" onClick={() => onChange('')}>
          Очистить
        </Button>
      ) : null}
    </div>
  )
}
