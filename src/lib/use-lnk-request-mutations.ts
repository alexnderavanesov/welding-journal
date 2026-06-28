import { useLnkRequestCorrectionMutation } from '@/lib/use-lnk-request-correction-mutation'
import { useLnkRequestCreateMutation } from '@/lib/use-lnk-request-create-mutation'
import { useLnkRequestManagerMutation } from '@/lib/use-lnk-request-manager-mutation'
import type { UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'

export function useLnkRequestMutations(options: UseLnkReportMutationsOptions) {
  return {
    lnkRequestMutation: useLnkRequestCreateMutation(options),
    lnkRequestCorrectionMutation: useLnkRequestCorrectionMutation(options),
    lnkRequestManagerMutation: useLnkRequestManagerMutation(options),
  }
}
