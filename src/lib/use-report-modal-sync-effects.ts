import {
  type LnkReportModalSyncEffectsOptions,
  useLnkReportModalSyncEffects,
} from '@/lib/use-lnk-report-modal-sync-effects'
import {
  type PstoReportModalSyncEffectsOptions,
  usePstoReportModalSyncEffects,
} from '@/lib/use-psto-report-modal-sync-effects'

type ReportModalSyncEffectsOptions = LnkReportModalSyncEffectsOptions & PstoReportModalSyncEffectsOptions

export function useReportModalSyncEffects(options: ReportModalSyncEffectsOptions) {
  usePstoReportModalSyncEffects(options)
  useLnkReportModalSyncEffects(options)
}
