import type { WelderStampsRegistryProps } from '@/components/welder-stamps-registry'
import type { WelderStampFilters, WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

type CreateWelderStampsRegistryPropsOptions = {
  activeRecords: WelderStampRecord[]
  archivedRecords: WelderStampRecord[]
  allRecords: WelderStampRecord[]
  suspensionRecords: WelderStampSuspensionRecord[]
  draft: WelderStampRecord
  suspensionDraft: WelderStampSuspensionRecord
  suspensionEditorOpenSignal?: number
  search: string
  filters: WelderStampFilters
  editingId: number | null
  onSearchChange: (value: string) => void
  onFiltersChange: (value: WelderStampFilters) => void
  onDraftChange: <K extends keyof WelderStampRecord>(field: K, value: WelderStampRecord[K]) => void
  onSuspensionDraftChange: (field: keyof WelderStampSuspensionRecord, value: string) => void
  onSave: () => boolean | Promise<boolean | undefined>
  onSaveSuspension: () => boolean | Promise<boolean | undefined>
  onReset: () => void
  onResetSuspension: () => void
  onEdit: (record: WelderStampRecord) => void
  onEditSuspension: (record: WelderStampSuspensionRecord) => void
  onArchive: (id: number) => void
  onRestore: (id: number) => void
  onArchivePermit: (recordId: number, permitKind: 'naks' | 'dls', permitId: string) => void
  onRestorePermit: (recordId: number, permitKind: 'naks' | 'dls', permitId: string) => void
  onDelete: (id: number) => void
  onDeleteSuspension: (id: number) => void
}

export function createWelderStampsRegistryProps({
  activeRecords,
  archivedRecords,
  allRecords,
  suspensionRecords,
  draft,
  suspensionDraft,
  suspensionEditorOpenSignal = 0,
  search,
  filters,
  editingId,
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
  onArchivePermit,
  onRestorePermit,
  onDelete,
  onDeleteSuspension,
}: CreateWelderStampsRegistryPropsOptions): WelderStampsRegistryProps {
  return {
    records: [...activeRecords, ...archivedRecords],
    allRecords,
    suspensionRecords,
    draft,
    suspensionDraft,
    suspensionEditorOpenSignal,
    search,
    filters,
    editingId,
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
    onArchivePermit,
    onRestorePermit,
    onDelete,
    onDeleteSuspension,
  }
}
