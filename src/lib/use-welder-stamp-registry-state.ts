import { useMemo, useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  loadWelderStampRegistrySnapshot,
  saveWelderStampRecords,
  saveWelderStampSuspensionRecords,
  type WelderStampRegistrySnapshot,
} from '@/server/welder-stamps'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { useSaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldInput } from '@/lib/weld-fields'
import { createEmptyWelderStampFilters, filterWelderStampRecords } from '@/lib/welder-stamp-filters'
import { buildWeldFormStampSelectOptions } from '@/lib/welder-stamp-compatibility'
import {
  createEmptyWelderStampDraft,
  normalizeWelderStampRecordsForRegistry,
  normalizeNaksStamp,
  prepareWelderStampSave,
  removeWelderStampRecord,
  setWelderStampRecordArchived,
} from '@/lib/welder-stamp-registry'
import {
  createEmptyWelderStampSuspensionDraft,
  prepareWelderStampSuspensionSave,
  removeWelderStampSuspensionRecord,
} from '@/lib/welder-stamp-suspensions'
import type { WelderStampFilters, WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'
import {
  DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
  STATISTICS_SERVER_QUERY_KEY,
  WELD_JOINT_PAGES_QUERY_KEY,
} from '@/lib/weld-query-utils'

type WelderStampRegistryStateInput = {
  setMessage: (message: string | null) => void
}

const WELDER_STAMP_REGISTRY_QUERY_KEY = ['welder-stamp-registry'] as const

export function useWelderStampRegistryState({ setMessage }: WelderStampRegistryStateInput) {
  const queryClient = useQueryClient()
  const confirmAction = useConfirmAction()
  const saveCheckSettings = useSaveCheckSettings()
  const [welderStamps, setWelderStamps] = useState<WelderStampRecord[]>([])
  const [welderStampDraft, setWelderStampDraft] = useState<WelderStampRecord>(() => createEmptyWelderStampDraft())
  const [editingWelderStampId, setEditingWelderStampId] = useState<number | null>(null)
  const [welderStampSearch, setWelderStampSearch] = useState('')
  const [welderStampFilters, setWelderStampFilters] = useState<WelderStampFilters>(() => createEmptyWelderStampFilters())
  const [welderStampSuspensions, setWelderStampSuspensions] = useState<WelderStampSuspensionRecord[]>([])
  const [welderStampSuspensionDraft, setWelderStampSuspensionDraft] = useState<WelderStampSuspensionRecord>(() =>
    createEmptyWelderStampSuspensionDraft(),
  )
  const registryRevisionRef = useRef('')

  const applyRegistrySnapshot = (snapshot: WelderStampRegistrySnapshot) => {
    const normalizedStamps = normalizeWelderStampRecordsForRegistry(snapshot.stamps)
    setWelderStamps(normalizedStamps)
    setWelderStampSuspensions(snapshot.suspensions)
    registryRevisionRef.current = snapshot.revision
    queryClient.setQueryData(WELDER_STAMP_REGISTRY_QUERY_KEY, {
      ...snapshot,
      stamps: normalizedStamps,
    })
  }

  const restoreCurrentRegistrySnapshot = async (error: unknown) => {
    setMessage((error as Error).message)
    try {
      const snapshot = await loadWelderStampRegistrySnapshot()
      applyRegistrySnapshot(snapshot)
    } catch {
      await queryClient.invalidateQueries({ queryKey: WELDER_STAMP_REGISTRY_QUERY_KEY })
    }
  }

  const welderStampRegistryQuery = useQuery({
    queryKey: WELDER_STAMP_REGISTRY_QUERY_KEY,
    queryFn: async () => loadWelderStampRegistrySnapshot(),
    staleTime: 30_000,
  })

  const welderStampsMutation = useMutation({
    mutationFn: async (records: WelderStampRecord[]) =>
      saveWelderStampRecords({ data: { records, expectedRevision: registryRevisionRef.current || undefined } }),
    onSuccess: async (snapshot) => {
      applyRegistrySnapshot(snapshot)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: WELD_JOINT_PAGES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: STATISTICS_SERVER_QUERY_KEY }),
      ])
    },
    onError: restoreCurrentRegistrySnapshot,
  })

  const welderStampSuspensionsMutation = useMutation({
    mutationFn: async (records: WelderStampSuspensionRecord[]) =>
      saveWelderStampSuspensionRecords({ data: { records, expectedRevision: registryRevisionRef.current || undefined } }),
    onSuccess: async (snapshot) => {
      applyRegistrySnapshot(snapshot)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: WELD_JOINT_PAGES_QUERY_KEY }),
      ])
    },
    onError: restoreCurrentRegistrySnapshot,
  })

  useEffect(() => {
    if (welderStampRegistryQuery.data) {
      applyRegistrySnapshot(welderStampRegistryQuery.data)
    }
  }, [welderStampRegistryQuery.data])

  const weldFormStampSelectOptions = useMemo(
    () =>
      buildWeldFormStampSelectOptions(welderStamps, undefined, [], welderStampSuspensions, {
        saveCheckSettings,
      }),
    [saveCheckSettings, welderStampSuspensions, welderStamps],
  )
  const getWeldFormStampSelectOptions = useMemo(
    () => (draft: WeldInput, allowedArchivedOfficialStamps: readonly string[] = []) =>
      buildWeldFormStampSelectOptions(welderStamps, draft, allowedArchivedOfficialStamps, welderStampSuspensions, {
        saveCheckSettings,
      }),
    [saveCheckSettings, welderStampSuspensions, welderStamps],
  )
  const filteredWelderStamps = useMemo(
    () => filterWelderStampRecords(welderStamps, welderStampSearch, welderStampFilters),
    [welderStampFilters, welderStampSearch, welderStamps],
  )
  const activeWelderStamps = useMemo(() => filteredWelderStamps.filter((record) => !record.archived), [filteredWelderStamps])
  const archivedWelderStamps = useMemo(() => filteredWelderStamps.filter((record) => record.archived), [filteredWelderStamps])

  function updateWelderStampDraft<K extends keyof WelderStampRecord>(field: K, value: WelderStampRecord[K]) {
    setWelderStampDraft((current) => ({ ...current, [field]: field === 'naksStamp' ? normalizeNaksStamp(String(value ?? '')) : value }))
  }

  function resetWelderStampForm() {
    setWelderStampDraft(createEmptyWelderStampDraft())
    setEditingWelderStampId(null)
  }

  function persistWelderStampRecords(nextRecords: WelderStampRecord[]) {
    setWelderStamps(nextRecords)
    welderStampsMutation.mutate(nextRecords)
  }

  function persistWelderStampSuspensionRecords(nextRecords: WelderStampSuspensionRecord[]) {
    setWelderStampSuspensions(nextRecords)
    welderStampSuspensionsMutation.mutate(nextRecords)
  }

  function saveWelderStampRecord() {
    const preparedSave = prepareWelderStampSave(welderStamps, welderStampDraft, editingWelderStampId)
    if (!preparedSave.ok) {
      setMessage(preparedSave.message)
      return false
    }

    persistWelderStampRecords(preparedSave.nextRecords)
    setMessage(preparedSave.message)
    resetWelderStampForm()
    return true
  }

  function editWelderStampRecord(record: WelderStampRecord) {
    setWelderStampDraft(createEmptyWelderStampDraft())
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

  function setWelderStampPermitArchived(recordId: number, permitKind: 'naks' | 'dls', permitId: string, archived: boolean) {
    const nextRecords = welderStamps.map((record) => {
      if (record.id !== recordId) return record
      if (permitKind === 'naks') {
        return {
          ...record,
          naksPermits: record.naksPermits.map((permit) => (permit.id === permitId ? { ...permit, archived } : permit)),
        }
      }
      return {
        ...record,
        dlsPermits: record.dlsPermits.map((permit) => (permit.id === permitId ? { ...permit, archived } : permit)),
      }
    })

    persistWelderStampRecords(nextRecords)
    setMessage(archived ? 'Допуск добавлен в архив' : 'Допуск возвращен из архива')
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

  function updateWelderStampSuspensionDraft(field: keyof WelderStampSuspensionRecord, value: string) {
    setWelderStampSuspensionDraft((current) => ({ ...current, [field]: field === 'naksStamp' ? normalizeNaksStamp(value) : value }))
  }

  function resetWelderStampSuspensionForm() {
    setWelderStampSuspensionDraft(createEmptyWelderStampSuspensionDraft())
  }

  function saveWelderStampSuspensionRecord() {
    const preparedSave = prepareWelderStampSuspensionSave(welderStampSuspensions, welderStampSuspensionDraft)
    if (!preparedSave.ok) {
      setMessage(preparedSave.message)
      return false
    }

    persistWelderStampSuspensionRecords(preparedSave.nextRecords)
    setMessage(preparedSave.message)
    resetWelderStampSuspensionForm()
    return true
  }

  function editWelderStampSuspensionRecord(record: WelderStampSuspensionRecord) {
    setWelderStampSuspensionDraft(record)
  }

  async function deleteWelderStampSuspensionRecord(id: number) {
    const record = welderStampSuspensions.find((candidate) => candidate.id === id)
    const confirmed = await confirmAction({
      title: 'Удалить запись отстранения',
      itemName: record ? `${record.naksStamp} · ${record.suspendedFrom || '-'}` : 'Запись отстранения',
      description: 'Запись будет удалена из истории отстранений.',
      warning: 'Это действие нельзя отменить.',
    })
    if (!confirmed) return
    persistWelderStampSuspensionRecords(removeWelderStampSuspensionRecord(welderStampSuspensions, id))
    setMessage('Запись отстранения удалена')
  }

  return {
    welderStamps,
    welderStampSuspensions,
    welderStampDraft,
    welderStampSuspensionDraft,
    welderStampSearch,
    welderStampFilters,
    editingWelderStampId,
    filteredWelderStamps,
    activeWelderStamps,
    archivedWelderStamps,
    weldFormStampSelectOptions,
    getWeldFormStampSelectOptions,
    setWelderStampSearch,
    setWelderStampFilters,
    updateWelderStampDraft,
    resetWelderStampForm,
    saveWelderStampRecord,
    editWelderStampRecord,
    archiveWelderStampRecord,
    restoreWelderStampRecord,
    setWelderStampPermitArchived,
    deleteWelderStampRecord,
    updateWelderStampSuspensionDraft,
    resetWelderStampSuspensionForm,
    saveWelderStampSuspensionRecord,
    editWelderStampSuspensionRecord,
    deleteWelderStampSuspensionRecord,
  }
}
