import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listAppSettings, saveAppSetting, type AppSettingValue } from '@/server/app-settings'
import { applyRemoteDataListSettings } from '@/lib/data-list-settings'
import {
  applyRemoteDispatcherReminderSettings,
  applyRemoteDispatcherSettings,
} from '@/lib/dispatcher-settings'
import { applyRemoteOtherSettings } from '@/lib/other-settings'
import {
  PROJECT_SETTING_KEYS,
  PROJECT_SETTING_REMOTE_PERSIST_EVENT,
  projectSettingAffectsDispatcherIndex,
  type ProjectSettingRemotePersistDetail,
  type ProjectSettingKey,
  shouldSyncProjectSettingsRemote,
} from '@/lib/project-settings-remote'
import { applyRemoteRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { applyRemoteSaveCheckSettings } from '@/lib/save-check-settings'
import { applyRemoteSystemIndexSettings } from '@/lib/system-index-settings'
import {
  DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
  STATISTICS_SERVER_QUERY_KEY,
  WELD_JOINT_PAGES_QUERY_KEY,
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
  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => listAppSettings(),
    enabled: shouldSyncProjectSettingsRemote(),
    staleTime: 30_000,
    retry: 1,
  })

  useEffect(() => {
    const settings = settingsQuery.data
    if (!settings) return

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
      void saveAppSetting({ data: { key, value: value as AppSettingValue } })
        .then(async () => {
          if (key === PROJECT_SETTING_KEYS.systemIndex) {
            await queryClient.invalidateQueries({ queryKey: STATISTICS_SERVER_QUERY_KEY })
          }
          if (projectSettingAffectsDispatcherIndex(key)) {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY }),
              queryClient.invalidateQueries({ queryKey: WELD_JOINT_PAGES_QUERY_KEY }),
            ])
          }
          resolve?.()
        })
        .catch((error) => {
          console.warn('Не удалось сохранить настройку проекта в БД', key, error)
          reject?.(error)
        })
    }

    window.addEventListener(PROJECT_SETTING_REMOTE_PERSIST_EVENT, persistRemoteSetting)
    return () => window.removeEventListener(PROJECT_SETTING_REMOTE_PERSIST_EVENT, persistRemoteSetting)
  }, [queryClient])
}
