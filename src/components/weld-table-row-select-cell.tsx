type WeldTableRowSelectCellProps = {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (selected: boolean) => void
}

export function WeldTableRowSelectCell({ label, checked, disabled, onChange }: WeldTableRowSelectCellProps) {
  return (
    <td
      className={`border-b border-r border-b-slate-100 border-r-slate-200 px-2 py-2.5 text-center align-top ${
        disabled ? 'bg-slate-200/80 shadow-[inset_0_0_0_9999px_rgba(148,163,184,0.14)]' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={`Выбрать стык ${label}`}
        title={disabled ? 'Заявка ПСТО уже создана' : 'Выбрать стык для заявки ПСТО'}
        className="h-4 w-4 rounded border-slate-300 disabled:cursor-not-allowed disabled:opacity-35"
      />
    </td>
  )
}
