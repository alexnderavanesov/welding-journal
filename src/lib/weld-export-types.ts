import type { WeldField } from './weld-fields'

export type ExportWorkbookOptions = {
  fields?: readonly WeldField[]
  readOnlyFieldKeys?: ReadonlySet<string>
  sheetName?: string
}
