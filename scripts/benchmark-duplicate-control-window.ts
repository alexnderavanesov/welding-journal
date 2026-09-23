import 'dotenv/config'

import {
  loadDuplicateControlCandidateIds,
  loadDuplicateControlCandidatePage,
  loadDuplicateControlCandidateRowsByIds,
  loadDuplicateControlRegistryPage,
} from '@/server/duplicate-controls'
import {
  DUPLICATE_CONTROL_MASS_SELECTION_ERROR,
  DUPLICATE_CONTROL_MASS_SELECTION_LIMIT,
} from '@/lib/duplicate-control-types'

const LOAD_DATABASE_NAME = 'welding_tracker_load_200k'
const connectionString = String(process.env.DATABASE_URL ?? '')
const databaseUrl = new URL(connectionString)
if (databaseUrl.hostname !== '127.0.0.1' && databaseUrl.hostname !== 'localhost') {
  throw new Error('Duplicate-control benchmark can run only against local PostgreSQL.')
}
if (databaseUrl.pathname.replace(/^\//, '') !== LOAD_DATABASE_NAME) {
  throw new Error(`Duplicate-control benchmark requires the isolated ${LOAD_DATABASE_NAME} database.`)
}

const coldPage = await measure('candidate page (first open)', () =>
  loadDuplicateControlCandidatePage({ page: 1, pageSize: 100 }),
)
const warmPage = await measure('candidate page (warm)', () =>
  loadDuplicateControlCandidatePage({ page: 1, pageSize: 100 }),
)
const search = String(warmPage.value.rows[Math.floor(warmPage.value.rows.length / 2)]?.joint ?? '').trim()
const searchedPage = await measure(`candidate search (${search || 'empty'})`, () =>
  loadDuplicateControlCandidatePage({ search, page: 1, pageSize: 100 }),
)
const registryPage = await measure('controls registry page', () =>
  loadDuplicateControlRegistryPage({ page: 1, pageSize: 100 }),
)
const broadSelection = await measure('broad select-found guard', async () => {
  try {
    const ids = await loadDuplicateControlCandidateIds('')
    return { rejected: false, count: ids.length }
  } catch (error) {
    if (!(error instanceof Error) || error.message !== DUPLICATE_CONTROL_MASS_SELECTION_ERROR) throw error
    return { rejected: true, count: 0 }
  }
})
if ((coldPage.value.totalCount ?? 0) > DUPLICATE_CONTROL_MASS_SELECTION_LIMIT &&
  !broadSelection.value.rejected) {
  throw new Error('Broad duplicate-control selection must be rejected above 5,000 joints.')
}
const narrowedIds = await measure('select-found IDs after narrowing', () =>
  loadDuplicateControlCandidateIds(search),
)
const selectedRows = await measure('selected rows by 100 IDs', () =>
  loadDuplicateControlCandidateRowsByIds(narrowedIds.value.slice(0, 100)),
)

console.log(JSON.stringify({
  database: LOAD_DATABASE_NAME,
  candidateTotal: coldPage.value.totalCount,
  candidateRowsReturned: coldPage.value.rows.length,
  candidatePayloadBytes: Buffer.byteLength(JSON.stringify(coldPage.value)),
  coldPageMs: coldPage.elapsedMs,
  warmPageMs: warmPage.elapsedMs,
  searchedPageMs: searchedPage.elapsedMs,
  searchedTotal: searchedPage.value.totalCount,
  registryPageMs: registryPage.elapsedMs,
  registryTotal: registryPage.value.totalCount,
  registryRowsReturned: registryPage.value.rows.length,
  broadSelectionRejected: broadSelection.value.rejected,
  broadSelectionMs: broadSelection.elapsedMs,
  narrowedIdCount: narrowedIds.value.length,
  narrowedIdsPayloadBytes: Buffer.byteLength(JSON.stringify(narrowedIds.value)),
  narrowedIdsMs: narrowedIds.elapsedMs,
  selectedRowsReturned: selectedRows.value.length,
  selectedRowsPayloadBytes: Buffer.byteLength(JSON.stringify(selectedRows.value)),
  selectedRowsMs: selectedRows.elapsedMs,
}, null, 2))

async function measure<T>(label: string, action: () => Promise<T>) {
  const startedAt = performance.now()
  const value = await action()
  const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10
  console.log(`${label}: ${elapsedMs} ms`)
  return { value, elapsedMs }
}
