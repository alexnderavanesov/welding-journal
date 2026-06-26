import { formatDateInputValue } from '@/lib/date-format'
import {
  defaultRequestNamingState,
  type RequestNamingState,
} from '@/lib/request-naming-state'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type LnkRequestDraftState = {
  methods: Set<WeldFieldKey>
}

export type LnkResultDraftState = {
  requestName: string
  methodKey: WeldFieldKey | ''
  rowIds: Set<number>
  rowResults: Record<number, string>
  controlDate: string
  result: string
  conclusionNaming: RequestNamingState
  search: string
}

export type LnkOfficialityDraftState = {
  rowIds: Set<number>
  search: string
  status: 'official' | 'unofficial' | ''
}

export type PstoResultDraftState = {
  requestName: string
  rowIds: Set<number>
  pstoDate: string
  result: string
  diagramNaming: RequestNamingState
  search: string
}

export function createDefaultLnkResultDraft(): LnkResultDraftState {
  return {
    requestName: '',
    methodKey: '',
    rowIds: new Set(),
    rowResults: {},
    controlDate: formatDateInputValue(new Date()),
    result: '',
    conclusionNaming: defaultRequestNamingState,
    search: '',
  }
}

export function createDefaultLnkOfficialityDraft(): LnkOfficialityDraftState {
  return {
    rowIds: new Set(),
    search: '',
    status: '',
  }
}

export function createDefaultPstoResultDraft(): PstoResultDraftState {
  return {
    requestName: '',
    rowIds: new Set(),
    pstoDate: formatDateInputValue(new Date()),
    result: '',
    diagramNaming: defaultRequestNamingState,
    search: '',
  }
}
