import { createServerFn } from '@tanstack/react-start'
import type { SchemeChanges, SchemeFilterField, SchemeRegistryRequest } from '@/lib/line-schemes'
import type { SchemeWriteRequest } from './line-scheme-write'

export const getLineSchemes = createServerFn({ method: 'GET' }).validator((data: SchemeRegistryRequest) => data).handler(async ({ data }) => {
  const { readSchemeLines } = await import('./line-scheme-read'); return readSchemeLines(data)
})
export const getLineSchemeFilterOptions = createServerFn({ method: 'GET' }).validator((data: SchemeRegistryRequest & { field: SchemeFilterField; valueSearch?: string }) => data).handler(async ({ data }) => {
  const { readSchemeFilterOptions } = await import('./line-scheme-read'); return readSchemeFilterOptions(data)
})
export const openLineScheme = createServerFn({ method: 'POST' }).validator((data: { lineId: number; token: string; acquire?: boolean }) => data).handler(async ({ data }) => {
  const { openScheme } = await import('./line-scheme-write'); return openScheme(data)
})
export const keepLineSchemeLease = createServerFn({ method: 'POST' }).validator((data: { bundleId: number; token: string; release?: boolean }) => data).handler(async ({ data }) => {
  const { updateSchemeLease } = await import('./line-scheme-write'); return updateSchemeLease(data)
})
export const getLineSchemeJoints = createServerFn({ method: 'GET' }).validator((data: { bundleId: number; revisionId?: string; page?: number; search?: string; unplaced?: boolean }) => data).handler(async ({ data }) => {
  const { readSchemeJoints } = await import('./line-scheme-read'); return readSchemeJoints(data)
})
export const getLineSchemePoints = createServerFn({ method: 'GET' }).validator((data: { revisionId: string; page: number; after?: string }) => data).handler(async ({ data }) => {
  const { readSchemePointPage } = await import('./line-scheme-read'); return readSchemePointPage(data)
})
export const getLineSchemeDraftStates = createServerFn({ method: 'GET' }).validator((data: { bundleId: number; roots: number[] }) => data).handler(async ({ data }) => {
  const { readSchemeDraftStates } = await import('./line-scheme-read'); return readSchemeDraftStates(data)
})
export const saveLineSchemePoints = createServerFn({ method: 'POST' }).validator((data: SchemeWriteRequest & { revisionId: string; revisionVersion: number; changes: SchemeChanges }) => data).handler(async ({ data }) => {
  const { saveSchemePoints } = await import('./line-scheme-write'); return saveSchemePoints(data)
})
export const changeLineSchemeRevision = createServerFn({ method: 'POST' }).validator((data: SchemeWriteRequest & { revisionId: string; action: 'activate' | 'delete' }) => data).handler(async ({ data }) => {
  const { changeSchemeRevision } = await import('./line-scheme-write'); return changeSchemeRevision(data)
})
export const updateLineSchemeRevisionNumber = createServerFn({ method: 'POST' }).validator((data: SchemeWriteRequest & { revisionId: string; changeNumber: string | null }) => data).handler(async ({ data }) => {
  const { updateSchemeRevisionNumber } = await import('./line-scheme-write'); return updateSchemeRevisionNumber(data)
})
