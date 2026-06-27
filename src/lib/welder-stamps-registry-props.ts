import type { WelderStampsRegistryProps } from '@/components/welder-stamps-registry'
import type { WelderStampFilters, WelderStampRecord } from '@/lib/welder-stamp-types'

type CreateWelderStampsRegistryPropsOptions = {
  activeRecords: WelderStampRecord[]
  archivedRecords: WelderStampRecord[]
  draft: WelderStampRecord
  search: string
  filters: WelderStampFilters
  editingId: number | null
  showArchived: boolean
  onSearchChange: (value: string) => void
  onFiltersChange: (value: WelderStampFilters) => void
  onDraftChange: (field: keyof WelderStampRecord, value: string) => void
  onSave: () => void
  onReset: () => void
  onEdit: (record: WelderStampRecord) => void
  onArchive: (id: number) => void
  onRestore: (id: number) => void
  onToggleArchived: (value: boolean) => void
  onDelete: (id: number) => void
}

export function createWelderStampsRegistryProps({
  activeRecords,
  archivedRecords,
  draft,
  search,
  filters,
  editingId,
  showArchived,
  onSearchChange,
  onFiltersChange,
  onDraftChange,
  onSave,
  onReset,
  onEdit,
  onArchive,
  onRestore,
  onToggleArchived,
  onDelete,
}: CreateWelderStampsRegistryPropsOptions): WelderStampsRegistryProps {
  return {
    records: activeRecords,
    archivedRecords,
    draft,
    search,
    filters,
    editingId,
    showArchived,
    onSearchChange,
    onFiltersChange,
    onDraftChange,
    onSave,
    onReset,
    onEdit,
    onArchive,
    onRestore,
    onToggleArchived,
    onDelete,
  }
}
