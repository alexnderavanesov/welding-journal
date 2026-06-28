import { LNK_METHODS } from '@/lib/report-config'
import type { WeldFieldKey } from '@/lib/weld-fields'

type LnkRequestMethodsProps = {
  selectedMethodKeys: readonly WeldFieldKey[]
  selectedMethods: ReadonlySet<WeldFieldKey>
  onToggleMethod: (methodKey: WeldFieldKey) => void
}

export function LnkRequestMethods({ selectedMethodKeys, selectedMethods, onToggleMethod }: LnkRequestMethodsProps) {
  return (
    <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">Виды контроля</h3>
        <span className="text-xs text-slate-500">
          {selectedMethodKeys.length}/{LNK_METHODS.length}
        </span>
      </div>
      <p className="text-xs leading-5 text-slate-500">Выберите один или несколько видов контроля для этой заявки.</p>
      <div className="grid grid-cols-2 gap-2">
        {LNK_METHODS.map((method) => (
          <button
            key={method.requestKey}
            type="button"
            onClick={() => onToggleMethod(method.requestKey)}
            className={`inline-flex h-10 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors ${
              selectedMethods.has(method.requestKey)
                ? 'border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {method.code}
          </button>
        ))}
      </div>
    </section>
  )
}
