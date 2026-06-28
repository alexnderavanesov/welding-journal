import { useRepeatedJointActionMutations } from '@/lib/use-repeated-joint-action-mutations'
import { useWeldImportMutation } from '@/lib/use-weld-import-mutation'
import { useWeldRowMutations } from '@/lib/use-weld-row-mutations'
import type { UseWeldJournalMutationsOptions } from '@/lib/weld-journal-mutation-types'

export function useWeldJournalMutations(options: UseWeldJournalMutationsOptions) {
  return {
    ...useWeldRowMutations(options),
    ...useRepeatedJointActionMutations(options),
    ...useWeldImportMutation(options),
  }
}
