import type { WelderStampsRegistryProps } from '@/components/welder-stamps-registry'
import type { WelderStampFilters, WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

type CreateWelderStampsRegistryPropsOptions = {
  activeRecords: WelderStampRecord[]
  archivedRecords: WelderStampRecord[]
  suspensionRecords: WelderStampSuspensionRecord[]
  draft: WelderStampRecord
  suspensionDraft: WelderStampSuspensionRecord
  search: string
  filters: WelderStampFilters
  editingId: number | null
  showArchived: boolean
  onSearchChange: (value: string) => void
  onFiltersChange: (value: WelderStampFilters) => void
  onDraftChange: (field: keyof WelderStampRecord, value: string) => void
  onSuspensionDraftChange: (field: keyof WelderStampSuspensionRecord, value: string) => void
  onSave: () => boolean
  onSaveSuspension: () => boolean
  onReset: () => void
  onResetSuspension: () => void
  onEdit: (record: WelderStampRecord) => void
  onEditSuspension: (record: WelderStampSuspensionRecord) => void
  onArchive: (id: number) => void
  onRestore: (id: number) => void
  onToggleArchived: (value: boolean) => void
  onDelete: (id: number) => void
  onDeleteSuspension: (id: number) => void
}

export function createWelderStampsRegistryProps({
  activeRecords,
  archivedRecords,
  suspensionRecords,
  draft,
  suspensionDraft,
  search,
  filters,
  editingId,
  showArchived,
  onSearchChange,
  onFiltersChange,
  onDraftChange,
  onSuspensionDraftChange,
  onSave,
  onSaveSuspension,
  onReset,
  onResetSuspension,
  onEdit,
  onEditSuspension,
  onArchive,
  onRestore,
  onToggleArchived,
  onDelete,
  onDeleteSuspension,
}: CreateWelderStampsRegistryPropsOptions): WelderStampsRegistryProps {
  return {
    records: activeRecords,
    archivedRecords,
    suspensionRecords,
    draft,
    suspensionDraft,
    search,
    filters,
    editingId,
    showArchived,
    onSearchChange,
    onFiltersChange,
    onDraftChange,
    onSuspensionDraftChange,
    onSave,
    onSaveSuspension,
    onReset,
    onResetSuspension,
    onEdit,
    onEditSuspension,
    onArchive,
    onRestore,
    onToggleArchived,
    onDelete,
    onDeleteSuspension,
  }
}
