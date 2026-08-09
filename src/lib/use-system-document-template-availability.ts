import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { DOCUMENT_TEMPLATE_STORAGE_EVENT } from '@/lib/document-storage-events'
import {
  isSystemDocumentTemplateId,
  type SystemDocumentTemplateId,
} from '@/lib/system-document-template-types'

const SYSTEM_DOCUMENT_TEMPLATE_AVAILABILITY_QUERY_KEY = [
  'system-document-template-availability',
] as const

export function useSystemDocumentTemplateAvailability({
  enabled = true,
}: {
  enabled?: boolean
} = {}) {
  const queryClient = useQueryClient()
  const availabilityQuery = useQuery({
    queryKey: SYSTEM_DOCUMENT_TEMPLATE_AVAILABILITY_QUERY_KEY,
    queryFn: async () => {
      const { listRemoteDocumentTemplateIds } = await import('@/server/document-templates')
      return listRemoteDocumentTemplateIds()
    },
    enabled,
    staleTime: 60_000,
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
    () =>
      new Set(
        (availabilityQuery.data ?? [])
          .filter(isSystemDocumentTemplateId),
      ),
    [availabilityQuery.data],
  )
}
