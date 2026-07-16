type WeldTableSelectAllHeaderProps = {
  checked: boolean
  indeterminate: boolean
  disabled: boolean
  title: string
  onChange: (selected: boolean) => void
}

export function WeldTableSelectAllHeader({
  checked,
  indeterminate,
  disabled,
  title,
  onChange,
}: WeldTableSelectAllHeaderProps) {
  return (
    <th
      rowSpan={2}
      className="border-b-2 border-r-2 border-t-2 border-b-[#d3e3ee] border-r-[#d3e3ee] border-t-[#d3e3ee] bg-[#f6fbfe] px-2 py-2.5 text-center shadow-[inset_0_1px_0_0_rgba(255,255,255,0.86)]"
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        ref={(element) => {
          if (element) element.indeterminate = indeterminate
        }}
        onChange={(event) => onChange(event.target.checked)}
        aria-label="Выбрать видимые стыки"
        title={title}
        className="h-4 w-4 rounded border-slate-300 disabled:cursor-not-allowed disabled:opacity-35"
      />
    </th>
  )
}

type WeldTableRowActionsHeaderProps = {
  label: string
  screenReaderLabel: string
}

export function WeldTableRowActionsHeader({ label, screenReaderLabel }: WeldTableRowActionsHeaderProps) {
  return (
    <th
      rowSpan={2}
      className="border-b-2 border-r-2 border-t-2 border-b-[#d3e3ee] border-r-[#d3e3ee] border-t-[#d3e3ee] bg-[#f6fbfe] px-2 py-2.5 text-center text-xs font-semibold text-slate-600 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.86)]"
      title={label}
    >
      <span className="sr-only">{screenReaderLabel}</span>
    </th>
  )
}
