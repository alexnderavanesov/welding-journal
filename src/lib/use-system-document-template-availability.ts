import { useEffect, useMemo } from 'react'
import { useAccess } from './security-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { DOCUMENT_TEMPLATE_STORAGE_EVENT } from '@/lib/document-storage-events'
import {
  resolveAvailableSystemDocumentTemplateIds,
  type SystemDocumentTemplateId,
} from '@/lib/system-document-template-types'
import { listRemoteDocumentTemplateIds } from '@/server/document-templates-api'

const SYSTEM_DOCUMENT_TEMPLATE_AVAILABILITY_QUERY_KEY = [
  'system-document-template-availability',
] as const

export function useSystemDocumentTemplateAvailability({
  enabled = true,
}: {
  enabled?: boolean
} = {}) {
  const { can } = useAccess()
  const queryClient = useQueryClient()
  const availabilityQuery = useQuery({
    queryKey: SYSTEM_DOCUMENT_TEMPLATE_AVAILABILITY_QUERY_KEY,
    queryFn: () => listRemoteDocumentTemplateIds(),
    enabled: enabled && (can('templates.view') || can('documents.generate') || can('documents.export')),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  useEffect(() => {
    const syncAvailability = () => {
      void queryClient.invalidateQueries({
        queryKey: SYSTEM_DOCUMENT_TEMPLATE_AVAILABILITY_QUERY_KEY,
      })
    }

    window.addEventListener(DOCUMENT_TEMPLATE_STORAGE_EVENT, syncAvailability)
    return () => {
      window.removeEventListener(DOCUMENT_TEMPLATE_STORAGE_EVENT, syncAvailability)
    }
  }, [queryClient])

  return useMemo<ReadonlySet<SystemDocumentTemplateId>>(
    () => resolveAvailableSystemDocumentTemplateIds(availabilityQuery.data ?? []),
    [availabilityQuery.data],
  )
}
