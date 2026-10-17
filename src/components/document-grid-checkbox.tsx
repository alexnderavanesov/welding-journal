import type { ComponentPropsWithoutRef } from 'react'

export type DocumentGridCheckboxProps = Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'defaultChecked' | 'checked'> & {
  checked: boolean
  indeterminate?: boolean
}

/** Custom selection controls use the same themed wrapper and state classes as AG 36's own checkboxes. */
export function DocumentGridCheckbox({ checked, indeterminate = false, disabled = false, className = '', ...inputProps }: DocumentGridCheckboxProps) {
  const state = indeterminate ? 'ag-indeterminate' : checked ? 'ag-checked' : ''
  return <span role="presentation" className={`document-grid-checkbox ag-wrapper ag-input-wrapper ag-checkbox-input-wrapper ${state}${disabled ? ' ag-disabled' : ''}`}>
    <input {...inputProps} type="checkbox" className={`ag-input-field-input ag-checkbox-input ${className}`}
      checked={checked && !indeterminate} disabled={disabled}
      ref={element => { if (element) element.indeterminate = indeterminate }} />
  </span>
}
