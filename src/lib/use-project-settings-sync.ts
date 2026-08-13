import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listAppSettingsSnapshot, saveAppSetting, type AppSettingValue } from '@/server/app-settings'
import { applyRemoteDataListSettings } from '@/lib/data-list-settings'
import { applyRemoteDispatcherBackgroundSettings } from '@/lib/dispatcher-background-settings'
import {
  applyRemoteDispatcherReminderSettings,
  applyRemoteDispatcherSettings,
} from '@/lib/dispatcher-settings'
import { applyRemoteOtherSettings } from '@/lib/other-settings'
import { createKeyedTaskQueue } from '@/lib/keyed-task-queue'
import {
  PROJECT_SETTING_KEYS,
  PROJECT_SETTING_REMOTE_PERSIST_EVENT,
  projectSettingAffectsDerivedCalculations,
  projectSettingAffectsDispatcherIndex,
  type ProjectSettingRemotePersistDetail,
  type ProjectSettingKey,
  shouldSyncProjectSettingsRemote,
} from '@/lib/project-settings-remote'
import { applyRemoteRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { applyRemoteSaveCheckSettings } from '@/lib/save-check-settings'
import { applyRemoteSystemIndexSettings } from '@/lib/system-index-settings'
import {
  DISPATCHER_BACKGROUND_STATUS_QUERY_KEY,
  DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
  STATISTICS_SERVER_QUERY_KEY,
  WELD_JOINTS_QUERY_KEY,
  WELD_JOINT_PAGES_QUERY_KEY,
  WELD_REPORT_CONTEXT_QUERY_KEY,
} from '@/lib/weld-query-utils'

type ProjectSettingSyncEntry = {
  key: ProjectSettingKey
  applyRemote: (value: unknown) => void
}

const PROJECT_SETTING_SYNC_ENTRIES: ProjectSettingSyncEntry[] = [
  {
    key: PROJECT_SETTING_KEYS.other,
    applyRemote: applyRemoteOtherSettings,
  },
  {
    key: PROJECT_SETTING_KEYS.saveCheck,
    applyRemote: applyRemoteSaveCheckSettings,
  },
  {
    key: PROJECT_SETTING_KEYS.dispatcher,
    applyRemote: applyRemoteDispatcherSettings,
  },
  {
    key: PROJECT_SETTING_KEYS.dispatcherBackground,
    applyRemote: applyRemoteDispatcherBackgroundSettings,
  },
  {
    key: PROJECT_SETTING_KEYS.dispatcherReminders,
    applyRemote: applyRemoteDispatcherReminderSettings,
  },
  {
    key: PROJECT_SETTING_KEYS.dataList,
    applyRemote: applyRemoteDataListSettings,
  },
  {
    key: PROJECT_SETTING_KEYS.requestConclusion,
    applyRemote: applyRemoteRequestConclusionSettings,
  },
  {
    key: PROJECT_SETTING_KEYS.systemIndex,
    applyRemote: applyRemoteSystemIndexSettings,
  },
]

export function useProjectSettingsSync() {
  const queryClient = useQueryClient()
  const revisionsRef = useRef<Record<string, string>>({})
  const saveQueueRef = useRef(createKeyedTaskQueue<ProjectSettingKey>())
  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => listAppSettingsSnapshot(),
    enabled: shouldSyncProjectSettingsRemote(),
    staleTime: 30_000,
    retry: 1,
  })

  useEffect(() => {
    const snapshot = settingsQuery.data
    if (!snapshot) return
    const settings = snapshot.values
    revisionsRef.current = snapshot.updatedAt

    for (const entry of PROJECT_SETTING_SYNC_ENTRIES) {
      if (Object.prototype.hasOwnProperty.call(settings, entry.key)) {
        entry.applyRemote(settings[entry.key])
      }
    }
  }, [settingsQuery.data])

  useEffect(() => {
    if (!shouldSyncProjectSettingsRemote()) return undefined

    const persistRemoteSetting = (event: Event) => {
      const { key, value, resolve, reject } = (event as CustomEvent<ProjectSettingRemotePersistDetail>).detail ?? {}
      if (!key) return
      void saveQueueRef.current.enqueue(key, async () => {
        try {
          const saved = await saveAppSetting({
            data: {
              key,
              value: value as AppSettingValue,
              expectedUpdatedAt: revisionsRef.current[key] ?? null,
            },
          })
          if (saved.updatedAt) revisionsRef.current[key] = saved.updatedAt
          if (projectSettingAffectsDerivedCalculations(key)) {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: STATISTICS_SERVER_QUERY_KEY }),
              queryClient.invalidateQueries({ queryKey: WELD_JOINTS_QUERY_KEY }),
              queryClient.invalidateQueries({ queryKey: WELD_JOINT_PAGES_QUERY_KEY }),
              queryClient.invalidateQueries({ queryKey: WELD_REPORT_CONTEXT_QUERY_KEY }),
            ])
          }
          if (projectSettingAffectsDispatcherIndex(key)) {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY }),
              queryClient.invalidateQueries({ queryKey: WELD_JOINT_PAGES_QUERY_KEY }),
            ])
          }
          if (key === PROJECT_SETTING_KEYS.dispatcherBackground) {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: DISPATCHER_BACKGROUND_STATUS_QUERY_KEY }),
              queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY }),
              queryClient.invalidateQueries({ queryKey: WELD_JOINT_PAGES_QUERY_KEY }),
            ])
          }
          resolve?.()
        } catch (error) {
          console.warn('Не удалось сохранить настройку проекта в БД', key, error)
          await queryClient.invalidateQueries({ queryKey: ['app-settings'] })
          reject?.(error)
        }
      })
    }

    window.addEventListener(PROJECT_SETTING_REMOTE_PERSIST_EVENT, persistRemoteSetting)
    return () => window.removeEventListener(PROJECT_SETTING_REMOTE_PERSIST_EVENT, persistRemoteSetting)
  }, [queryClient])
}
