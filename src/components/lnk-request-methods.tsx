import { Input } from '@/components/ui/input'

type LnkRequestMethodOption<MethodKey extends string> = {
  code: string
  requestKey: MethodKey
}

type LnkRequestMethodsProps<MethodKey extends string> = {
  methods: readonly LnkRequestMethodOption<MethodKey>[]
  selectedMethodKeys: readonly MethodKey[]
  selectedMethods: ReadonlySet<MethodKey>
  requestDate?: string
  onRequestDateChange?: (value: string) => void
  onToggleMethod: (methodKey: MethodKey) => void
}

export function LnkRequestMethods<MethodKey extends string>({
  methods,
  selectedMethodKeys,
  selectedMethods,
  requestDate,
  onRequestDateChange,
  onToggleMethod,
}: LnkRequestMethodsProps<MethodKey>) {
  const showRequestDate = requestDate !== undefined && onRequestDateChange
  return (
    <section className="border-b border-slate-100 px-5 py-2.5" data-lnk-request-methods="true">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Виды контроля</h3>
          <span className="inline-flex w-10 justify-center rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-xs font-medium tabular-nums text-slate-500">
            {selectedMethodKeys.length}/{methods.length}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {methods.map((method) => (
            <button
              key={method.requestKey}
              type="button"
              onClick={() => onToggleMethod(method.requestKey)}
              aria-pressed={selectedMethods.has(method.requestKey)}
              className={`inline-flex h-9 w-16 shrink-0 items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors ${
                selectedMethods.has(method.requestKey)
                  ? 'border-sky-300 bg-sky-50 text-sky-900 shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {method.code}
            </button>
          ))}
        </div>
        {showRequestDate ? (
          <label className="ml-auto flex shrink-0 items-center gap-2 text-sm">
            <span className="text-[13px] font-medium text-slate-700">Дата заявки</span>
            <Input
              type="date"
              value={requestDate}
              onChange={(event) => onRequestDateChange(event.target.value)}
              className="h-9 w-[190px] bg-white"
            />
          </label>
        ) : null}
      </div>
    </section>
  )
}
