import { getSpecialistDocumentProfile, resolveDocumentSpecialists, type DocumentSpecialists, type SpecialistSelection } from '@/lib/document-specialists'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { loadSelectedSpecialists } from './specialists'

export type SpecialistDateDocument = { id: number; type: string; title: string; date: string; snapshot: DocumentSpecialists | null }

/** Only explicit post-deployment assignments carry certificateDate. Legacy
 * snapshots and unchanged dates do not read today's registry or rewrite history. */
export async function prepareSpecialistDateChanges(tx: SystemDocumentSequenceTransaction, documents: SpecialistDateDocument[]) {
  const targets = documents.map(document => ({ document, selection: Object.fromEntries((['first', 'second'] as const)
    .filter(role => document.snapshot?.[role]?.certificateDate && document.snapshot[role]!.certificateDate !== document.date)
    .map(role => [role, document.snapshot![role]!.id])) as SpecialistSelection }))
    .filter(target => Object.keys(target.selection).length)
  if (!targets.length) return { writes: [] as Array<{ id: number; snapshot: DocumentSpecialists }>, warnings: [] as string[], revisions: [] as number[][] }
  const records = await loadSelectedSpecialists(tx, targets.map(target => target.selection))
  const warnings: string[] = []
  const writes = targets.map(({ document, selection }) => {
    const profile = getSpecialistDocumentProfile(document.type)
    if (!profile) throw new Error('Не удалось определить вид контроля заключения.')
    const snapshot = resolveDocumentSpecialists(document.snapshot, selection, records, profile, document.date)
    for (const role of ['first', 'second'] as const) if (selection[role]) {
      const previous = document.snapshot![role]!, next = snapshot[role]!
      if (previous.certificate !== next.certificate) warnings.push(`${document.title}: ${previous.name}, № ${previous.certificate} → № ${next.certificate}.`)
      snapshot[role] = { ...previous, certificate: next.certificate, certificateDate: document.date }
    }
    return { id: document.id, snapshot }
  })
  return { writes, warnings, revisions: [...records.values()].map(record => [record.id, record.revision]) }
}

export async function confirmSpecialistDateChanges(changes: Awaited<ReturnType<typeof prepareSpecialistDateChanges>>, context: unknown, confirmation?: string) {
  if (!changes.warnings.length) return
  const { createHash } = await import('node:crypto')
  const token = createHash('sha256').update(JSON.stringify({ context, revisions: changes.revisions, warnings: changes.warnings })).digest('hex')
  if (confirmation !== token) throw new Error(`Изменение даты заключения изменит удостоверения специалистов. ${changes.warnings.slice(0, 10).join(' ')}${changes.warnings.length > 10 ? ` Ещё изменений: ${changes.warnings.length - 10}.` : ''} Пока ничего не сохранено. [specialist-confirmation:${token}]`)
}
