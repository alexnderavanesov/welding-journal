import type { ComponentPropsWithoutRef } from 'react'

export type DocumentGridCheckboxProps = Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'defaultChecked' | 'checked'> & {
  checked: boolean
  indeterminate?: boolean
  busy?: boolean
}

/** Custom selection controls use the same themed wrapper and state classes as AG 36's own checkboxes. */
export function DocumentGridCheckbox({ checked, indeterminate = false, disabled = false, busy = false, className = '', onClick, onChange, ...inputProps }: DocumentGridCheckboxProps) {
  const state = indeterminate ? 'ag-indeterminate' : checked ? 'ag-checked' : ''
  return <label className="ag-selection-checkbox document-grid-checkbox-label" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    <span role="presentation" className={`document-grid-checkbox ag-wrapper ag-input-wrapper ag-checkbox-input-wrapper ${state}${disabled || busy ? ' ag-disabled' : ''}`}>
    <input {...inputProps} type="checkbox" className={`ag-input-field-input ag-checkbox-input ${className}`}
      checked={checked && !indeterminate} disabled={disabled}
      aria-disabled={disabled || busy || undefined} aria-busy={busy || undefined}
      // Native disabled drops focus when an async membership read starts.
      // Keep focus in place while busy, but consume every repeated activation.
      onClick={event => { if (busy) { event.stopPropagation(); return }; onClick?.(event) }}
      onChange={event => { if (!busy) onChange?.(event) }}
      ref={element => { if (element) element.indeterminate = indeterminate }} />
    </span>
  </label>
}
