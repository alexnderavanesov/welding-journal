import { usePstoRequestCorrectionMutation } from '@/lib/use-psto-request-correction-mutation'
import { usePstoRequestCreateMutation } from '@/lib/use-psto-request-create-mutation'
import { usePstoRequestManagerMutation } from '@/lib/use-psto-request-manager-mutation'
import type { UsePstoReportMutationsOptions } from '@/lib/psto-report-mutation-types'

export function usePstoRequestMutations(options: UsePstoReportMutationsOptions) {
  return {
    pstoRequestMutation: usePstoRequestCreateMutation(options),
    pstoRequestManagerMutation: usePstoRequestManagerMutation(options),
    pstoRequestCorrectionMutation: usePstoRequestCorrectionMutation(options),
  }
}
