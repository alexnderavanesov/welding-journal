import { useMemo, useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listWelderStampRecords, saveWelderStampRecords } from '@/server/welder-stamps'
import { useConfirmAction } from '@/lib/confirm-action-context'
import type { WeldInput } from '@/lib/weld-fields'
import { createEmptyWelderStampFilters, filterWelderStampRecords } from '@/lib/welder-stamp-filters'
import { buildWeldFormStampSelectOptions } from '@/lib/welder-stamp-compatibility'
import {
  createEmptyWelderStampDraft,
  normalizeNaksStamp,
  prepareWelderStampSave,
  removeWelderStampRecord,
  setWelderStampRecordArchived,
} from '@/lib/welder-stamp-registry'
import type { WelderStampFilters, WelderStampRecord } from '@/lib/welder-stamp-types'

type WelderStampRegistryStateInput = {
  setMessage: (message: string | null) => void
}

export function useWelderStampRegistryState({ setMessage }: WelderStampRegistryStateInput) {
  const queryClient = useQueryClient()
  const confirmAction = useConfirmAction()
  const [welderStamps, setWelderStamps] = useState<WelderStampRecord[]>([])
  const [welderStampDraft, setWelderStampDraft] = useState<WelderStampRecord>(() => createEmptyWelderStampDraft())
  const [editingWelderStampId, setEditingWelderStampId] = useState<number | null>(null)
  const [welderStampSearch, setWelderStampSearch] = useState('')
  const [welderStampFilters, setWelderStampFilters] = useState<WelderStampFilters>(() => createEmptyWelderStampFilters())
  const [showArchivedWelderStamps, setShowArchivedWelderStamps] = useState(false)

  const welderStampsQuery = useQuery({
    queryKey: ['welder-stamps'],
    queryFn: async () => listWelderStampRecords(),
  })

  const welderStampsMutation = useMutation({
    mutationFn: async (records: WelderStampRecord[]) => saveWelderStampRecords({ data: { records } }),
    onSuccess: async (records) => {
      setWelderStamps(records)
      await queryClient.invalidateQueries({ queryKey: ['welder-stamps'] })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  useEffect(() => {
    if (welderStampsQuery.data) {
      setWelderStamps(welderStampsQuery.data)
    }
  }, [welderStampsQuery.data])

  const weldFormStampSelectOptions = useMemo(() => buildWeldFormStampSelectOptions(welderStamps), [welderStamps])
  const getWeldFormStampSelectOptions = useMemo(
    () => (draft: WeldInput, allowedArchivedOfficialStamps: readonly string[] = []) =>
      buildWeldFormStampSelectOptions(welderStamps, draft, allowedArchivedOfficialStamps),
    [welderStamps],
  )
  const filteredWelderStamps = useMemo(
    () => filterWelderStampRecords(welderStamps, welderStampSearch, welderStampFilters),
    [welderStampFilters, welderStampSearch, welderStamps],
  )
  const activeWelderStamps = useMemo(() => filteredWelderStamps.filter((record) => !record.archived), [filteredWelderStamps])
  const archivedWelderStamps = useMemo(() => filteredWelderStamps.filter((record) => record.archived), [filteredWelderStamps])

  function updateWelderStampDraft(field: keyof WelderStampRecord, value: string) {
    setWelderStampDraft((current) => ({ ...current, [field]: field === 'naksStamp' ? normalizeNaksStamp(value) : value }))
  }

  function resetWelderStampForm() {
    setWelderStampDraft(createEmptyWelderStampDraft())
    setEditingWelderStampId(null)
  }

  function persistWelderStampRecords(nextRecords: WelderStampRecord[]) {
    setWelderStamps(nextRecords)
    welderStampsMutation.mutate(nextRecords)
  }

  function saveWelderStampRecord() {
    const preparedSave = prepareWelderStampSave(welderStamps, welderStampDraft, editingWelderStampId)
    if (!preparedSave.ok) {
      setMessage(preparedSave.message)
      return
    }

    persistWelderStampRecords(preparedSave.nextRecords)
    setMessage(preparedSave.message)
    resetWelderStampForm()
  }

  function editWelderStampRecord(record: WelderStampRecord) {
    setWelderStampDraft(record)
    setEditingWelderStampId(record.id)
  }

  function archiveWelderStampRecord(id: number) {
    persistWelderStampRecords(setWelderStampRecordArchived(welderStamps, id, true))
    if (editingWelderStampId === id) resetWelderStampForm()
    setMessage('Клеймо добавлено в архив')
  }

  function restoreWelderStampRecord(id: number) {
    persistWelderStampRecords(setWelderStampRecordArchived(welderStamps, id, false))
    setMessage('Клеймо возвращено в общий список')
  }

  async function deleteWelderStampRecord(id: number) {
    const record = welderStamps.find((candidate) => candidate.id === id)
    const stampName = record?.naksStamp || record?.internalStamp || 'Запись клейма'
    const confirmed = await confirmAction({
      title: 'Удалить клеймо',
      itemName: stampName,
      description: 'Запись будет удалена из справочника клейм сварщиков.',
      warning: 'Это действие нельзя отменить.',
    })
    if (!confirmed) return
    persistWelderStampRecords(removeWelderStampRecord(welderStamps, id))
    if (editingWelderStampId === id) resetWelderStampForm()
    setMessage('Клеймо удалено')
  }

  return {
    welderStamps,
    welderStampDraft,
    welderStampSearch,
    welderStampFilters,
    editingWelderStampId,
    showArchivedWelderStamps,
    filteredWelderStamps,
    activeWelderStamps,
    archivedWelderStamps,
    weldFormStampSelectOptions,
    getWeldFormStampSelectOptions,
    setWelderStampSearch,
    setWelderStampFilters,
    setShowArchivedWelderStamps,
    updateWelderStampDraft,
    resetWelderStampForm,
    saveWelderStampRecord,
    editWelderStampRecord,
    archiveWelderStampRecord,
    restoreWelderStampRecord,
    deleteWelderStampRecord,
  }
}
