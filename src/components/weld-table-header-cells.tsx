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
      rowSpan={3}
      className="border-r border-slate-200/70 px-2 py-2.5 text-center shadow-[inset_0_1px_0_0_rgb(241,245,249),inset_0_-1px_0_0_rgb(226,232,240)]"
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
      rowSpan={3}
      className="border-r border-slate-200/70 bg-slate-50 px-2 py-2.5 text-center text-xs font-semibold text-slate-500 shadow-[inset_0_1px_0_0_rgb(241,245,249),inset_0_-1px_0_0_rgb(226,232,240)]"
      title={label}
    >
      <span className="sr-only">{screenReaderLabel}</span>
    </th>
  )
}
