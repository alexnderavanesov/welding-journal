import { eq, inArray } from 'drizzle-orm'
import { requireDb } from '@/db'
import { generatedDocuments } from '@/db/schema'
import { assertPermission, hasPermission, type AccessIdentity, type Permission } from '@/lib/access-permissions'
export function documentArea(type: string): 'lnk' | 'psto' | 'welding' {
  return /psto|tvmt/i.test(type) ? 'psto' : /lnk|vik|pvk|rk|uzk|layered/i.test(type) ? 'lnk' : 'welding'
}
export async function extendOperationPermissions(identity: AccessIdentity, name: string, policy: string, input: unknown, permissions: Permission[]) {
  const data = (input ?? {}) as Record<string, any>
  const add = (permission: Permission) => { assertPermission(identity, permission); if (!permissions.includes(permission)) permissions.push(permission) }
  // These helpers return only common line properties or aggregate reference
  // usage. Their screens do not require access to the complete other section.
  if (policy === '@lineIdentity' || policy === '@weldDataUsage' || policy === '@documentSequenceRead') {
    const alternatives: Permission[] = policy === '@lineIdentity'
      ? ['lines.view', 'welding.view'] : policy === '@documentSequenceRead'
        ? ['documents.view', 'templates.view', 'numbering.view'] : ['data.view', 'indexes.view', 'welding.view']
    add(alternatives.find(permission => hasPermission(identity, permission)) ?? alternatives[0])
  }
  if (policy === '@templateRead') {
    if (hasPermission(identity, 'templates.view')) add('templates.view')
    else if (hasPermission(identity, 'documents.generate')) add('documents.generate')
    else if (hasPermission(identity, 'documents.export')) add('documents.export')
    else throw new Error('Нет доступа к шаблонам документов.')
  }
  if (policy === '@documentEdit') {
    const ids = data.documentIds ?? data.documents?.map((document: any) => document.id)
    if (ids) {
      if (!Array.isArray(ids) || ids.length > 10000 || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Некорректный список документов.')
      if (ids.length) {
        const documents = await requireDb().select({ id: generatedDocuments.id, type: generatedDocuments.type }).from(generatedDocuments).where(inArray(generatedDocuments.id, ids))
        if (documents.length !== new Set(ids).size) throw new Error('Документ не найден.')
        for (const document of documents) add(`${documentArea(document.type)}.edit`)
      }
    } else if (data.reference?.type) add(`${documentArea(data.reference.methodCode === 'ТВМТ' ? 'tvmt' : data.reference.type)}.edit`)
    else throw new Error('Не определена область документа.')
  }
  if (name === 'saveRemoteGeneratedDocuments') {
    if (!Array.isArray(input)) throw new Error('Некорректные документы.')
    for (const document of input) add(`${documentArea(document.type)}.generate`)
  }
  if (['manageLnkRequestDocument', 'managePstoRequestDocument'].includes(name) && data.action !== 'rename') add(name.includes('Lnk') ? 'lnk.delete' : 'psto.delete')
  if (name === 'changeTechnologyCard' && ['delete', 'archive'].includes(data.action)) add('references.delete')
  if (['createEarlyCoilDecision', 'cancelErroneousEarlyCoil'].includes(name)) add('exceptions.edit')
  if (name === 'changeLineProgramApprovals') add('exceptions.edit')
  if (name === 'changeLayeredControl' && data.assigned === false) add('lines.delete')
  if (name === 'correctPstoCycleStage' && data.action === 'delete') add('psto.delete')
  if (name === 'correctPreHeatTreatmentLnkResult' && data.action === 'delete') add('lnk.delete')
}
