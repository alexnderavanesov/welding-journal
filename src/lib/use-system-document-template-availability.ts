import { useEffect, useState } from 'react'

import { DOCUMENT_TEMPLATE_STORAGE_EVENT } from '@/lib/document-template-storage'
import {
  isSystemDocumentType,
  type SystemDocumentType,
} from '@/lib/system-document-types'
import { listRemoteDocumentTemplates } from '@/server/document-templates'

export function useSystemDocumentTemplateAvailability() {
  const [availableTypes, setAvailableTypes] = useState<ReadonlySet<SystemDocumentType>>(
    () => new Set(),
  )

  useEffect(() => {
    let isMounted = true
    const syncAvailability = () => {
      listRemoteDocumentTemplates()
        .then((templates) => {
          if (!isMounted) return
          setAvailableTypes(
            new Set(
              templates
                .map((template) => template.id)
                .filter(isSystemDocumentType),
            ),
          )
        })
        .catch(() => {
          if (isMounted) setAvailableTypes(new Set())
        })
    }

    syncAvailability()
    window.addEventListener(DOCUMENT_TEMPLATE_STORAGE_EVENT, syncAvailability)
    return () => {
      isMounted = false
      window.removeEventListener(DOCUMENT_TEMPLATE_STORAGE_EVENT, syncAvailability)
    }
  }, [])

  return availableTypes
}
