import type { LnkControlStage } from '@/lib/lnk-control-stage'

type LnkControlStageSwitchProps = {
  value: LnkControlStage
  onChange: (stage: LnkControlStage) => void
  disabled?: boolean
}

const STAGES: Array<{ value: LnkControlStage; label: string }> = [
  { value: 'primary', label: 'Основной' },
  { value: 'beforeHeatTreatment', label: 'До ТО' },
]

export function LnkControlStageSwitch({
  value,
  onChange,
  disabled = false,
}: LnkControlStageSwitchProps) {
  return (
    <div
      className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 p-1"
      role="group"
      aria-label="Этап контроля ЛНК"
    >
      {STAGES.map((stage) => (
        <button
          key={stage.value}
          type="button"
          aria-pressed={value === stage.value}
          disabled={disabled}
          onClick={() => onChange(stage.value)}
          className={`inline-flex h-7 min-w-[86px] items-center justify-center rounded px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            value === stage.value
              ? stage.value === 'beforeHeatTreatment'
                ? 'bg-violet-100 text-violet-800 shadow-sm'
                : 'bg-emerald-100 text-emerald-800 shadow-sm'
              : 'text-slate-500 hover:bg-white hover:text-slate-800'
          }`}
        >
          {stage.label}
        </button>
      ))}
    </div>
  )
}
