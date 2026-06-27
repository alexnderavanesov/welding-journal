import { WELDER_STAMP_WELD_TYPE_OPTIONS as welderStampWeldTypeOptions } from '@/lib/report-config'

type WelderStampWeldType = (typeof welderStampWeldTypeOptions)[number]

type WelderStampWeldTypeSelectorProps = {
  selectedWeldTypes: string[]
  onToggleWeldType: (type: WelderStampWeldType) => void
}

export function WelderStampWeldTypeSelector({
  selectedWeldTypes,
  onToggleWeldType,
}: WelderStampWeldTypeSelectorProps) {
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-input bg-white px-2 py-1.5 shadow-sm shadow-slate-200/40">
      {welderStampWeldTypeOptions.map((type) => {
        const isSelected = selectedWeldTypes.includes(type)
        return (
          <button
            key={type}
            type="button"
            onClick={() => onToggleWeldType(type)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              isSelected
                ? 'border-sky-300 bg-sky-50 text-sky-800'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white'
            }`}
            aria-pressed={isSelected}
          >
            {type}
          </button>
        )
      })}
    </div>
  )
}
