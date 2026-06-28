import { useLnkRequestMutations } from '@/lib/use-lnk-request-mutations'
import { useLnkResultMutations } from '@/lib/use-lnk-result-mutations'
import type { UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'

export function useLnkReportMutations(options: UseLnkReportMutationsOptions) {
  const requestMutations = useLnkRequestMutations(options)
  const resultMutations = useLnkResultMutations(options)

  return {
    ...requestMutations,
    ...resultMutations,
  }
}
