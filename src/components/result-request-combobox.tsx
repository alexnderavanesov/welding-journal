import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RequestDocumentCombobox, type RequestDocumentComboboxProps } from './request-document-combobox'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { collectRequestDocumentIdentities, type RequestDocumentIdentity } from '@/lib/request-document-identity'
import { getLnkWorkflowRequestSummary, getPstoWorkflowRequestOptions } from '@/server/weld-read-api'

export function ResultRequestCombobox({ scope, methodCode, ...props }: RequestDocumentComboboxProps & {
  scope: 'primary' | 'beforeHeatTreatment' | 'psto' | 'tvmt'
  methodCode?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<RequestDocumentIdentity | null>(null)
  const debouncedSearch = useDebouncedValue(search, 200)
  const query = useQuery({
    queryKey: ['result-request-options', scope, methodCode ?? '', debouncedSearch],
    queryFn: async () => {
      if (scope === 'psto' || scope === 'tvmt') return getPstoWorkflowRequestOptions({ data: { resultScope: scope, search: debouncedSearch } })
      const result = await getLnkWorkflowRequestSummary({ data: { resultScope: scope, methodCode, search: debouncedSearch } })
      return { options: result.requestOptions, hasMore: result.hasMore }
    },
    enabled: open,
    staleTime: 0,
    gcTime: 15 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const selected = props.options.find(option => option.key === props.value) ?? (picked?.key === props.value ? picked : null)
  const options = collectRequestDocumentIdentities([...(query.data?.options ?? props.options), ...(selected ? [selected] : [])])
  return <RequestDocumentCombobox {...props} options={options} onOpenChange={setOpen} onSearchChange={setSearch}
    loading={query.isFetching || search !== debouncedSearch} searchError={query.error ? 'Не удалось найти заявки. Закройте и откройте список, чтобы повторить поиск.' : undefined}
    hasMore={query.data?.hasMore}
    onChange={request => { setPicked(request); props.onChange(request) }} />
}
