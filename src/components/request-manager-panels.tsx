import { Pencil, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

type RequestManagerSelectProps = {
  label: string
  value: string
  options: string[]
  onChange: (requestName: string) => void
}

export function RequestManagerSelect({ label, value, options, onChange }: RequestManagerSelectProps) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="text-[13px] font-medium leading-none text-slate-700">{label}</span>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Выберите заявку</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </label>
  )
}

type RequestManagerUsagePanelProps = {
  children: ReactNode
}

export function RequestManagerUsagePanel({ children }: RequestManagerUsagePanelProps) {
  return <div className="rounded-md border border-slate-200 bg-slate-50 p-3">{children}</div>
}

type RequestManagerUsageBadgeProps = {
  children: ReactNode
}

export function RequestManagerUsageBadge({ children }: RequestManagerUsageBadgeProps) {
  return (
    <span className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
      {children}
    </span>
  )
}

type RequestManagerEmptyStateProps = {
  children: ReactNode
}

export function RequestManagerEmptyState({ children }: RequestManagerEmptyStateProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
      {children}
    </div>
  )
}

type RequestRenamePanelProps = {
  value: string
  placeholder: string
  disabled: boolean
  canRename: boolean
  onChange: (requestName: string) => void
  onRename: () => void
}

export function RequestRenamePanel({
  value,
  placeholder,
  disabled,
  canRename,
  onChange,
  onRename,
}: RequestRenamePanelProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">Переименовать заявку</h3>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="h-10 flex-1"
        />
        <Button onClick={onRename} disabled={!canRename}>
          <Pencil className="mr-2 h-4 w-4" />
          Переименовать
        </Button>
      </div>
    </div>
  )
}

type RequestDeletePanelProps = {
  description: string
  disabled: boolean
  onDelete: () => void
}

export function RequestDeletePanel({ description, disabled, onDelete }: RequestDeletePanelProps) {
  return (
    <div className="rounded-md border border-rose-200 bg-rose-50/60 p-3">
      <h3 className="mb-1 text-sm font-semibold text-rose-900">Удалить заявку</h3>
      <p className="mb-3 text-xs leading-5 text-rose-800">{description}</p>
      <Button
        variant="outline"
        onClick={onDelete}
        disabled={disabled}
        className="border-rose-300 bg-white text-rose-800 hover:bg-rose-50"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Удалить выбранную заявку
      </Button>
    </div>
  )
}
