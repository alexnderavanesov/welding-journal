import { useLnkFieldMutation } from '@/lib/use-lnk-field-mutation'
import { useLnkOfficialityMutations } from '@/lib/use-lnk-officiality-mutations'
import { useLnkResultEntryMutations } from '@/lib/use-lnk-result-entry-mutations'
import { useLnkResultManagerMutations } from '@/lib/use-lnk-result-manager-mutations'
import type { UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'

export function useLnkResultMutations(options: UseLnkReportMutationsOptions) {
  return {
    ...useLnkResultEntryMutations(options),
    ...useLnkOfficialityMutations(options),
    ...useLnkResultManagerMutations(options),
    ...useLnkFieldMutation(options),
  }
}
