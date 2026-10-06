import { weldJoints } from '@/db/schema'

// A system WDI filter needs dimensions, not results, documents or free text.
export const WDI_FILTER_SOURCE_SELECT = {
  id: weldJoints.id,
  connectionType: weldJoints.connectionType,
  d1: weldJoints.d1,
  d2: weldJoints.d2,
  t1: weldJoints.t1,
  t2: weldJoints.t2,
  wdi: weldJoints.wdi,
}
