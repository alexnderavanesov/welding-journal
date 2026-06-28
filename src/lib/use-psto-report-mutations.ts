import { usePstoRequestMutations } from '@/lib/use-psto-request-mutations'
import { usePstoResultMutations } from '@/lib/use-psto-result-mutations'
import type { UsePstoReportMutationsOptions } from '@/lib/psto-report-mutation-types'

export function usePstoReportMutations(options: UsePstoReportMutationsOptions) {
  const requestMutations = usePstoRequestMutations(options)
  const resultMutations = usePstoResultMutations(options)

  return {
    ...requestMutations,
    ...resultMutations,
  }
}
