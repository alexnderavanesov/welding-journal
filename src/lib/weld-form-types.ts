import type { WeldFieldKey } from '@/lib/weld-fields'

export type StampSelectOption = {
  value: string
  disabled?: boolean
  reason?: string
}

export type StampSelectOptions = Partial<Record<WeldFieldKey, readonly StampSelectOption[]>>
