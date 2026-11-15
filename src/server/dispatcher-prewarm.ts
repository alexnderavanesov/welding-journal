import { requireDb } from '@/db'
import { ensureDispatcherTaskIndexFresh, isDispatcherTaskIndexFresh } from './dispatcher-task-index'
import { isDatabaseReleaseReady } from './release-readiness'

/** Operator entry only. The existing engine skips fresh results and coalesces
 * users, release preparation and scheduled calls, including across processes. */
export async function prepareDispatcherCalculation() {
  if (!await isDatabaseReleaseReady(requireDb())) {
    throw new Error('Сначала завершите подготовку базы для текущей версии системы.')
  }
  const state = await ensureDispatcherTaskIndexFresh()
  if (!isDispatcherTaskIndexFresh(state)) {
    throw new Error('Данные менялись во время пересчёта. Актуальный результат пока не подтверждён; повторите запуск.')
  }
  return {
    ready: true as const,
    sourceRevision: state.sourceRevision,
    computedRevision: state.computedRevision,
    computedAt: state.computedAt!.toISOString(),
  }
}
