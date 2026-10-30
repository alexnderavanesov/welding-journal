import { randomUUID } from 'node:crypto'
import { auditChanges, auditOperations } from '@/db/schema'
import type { requireDb } from '@/db'
import type { AccessIdentity } from '@/lib/access-permissions'

export type AuditTransaction = Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0]
export async function recordAccessEvent(tx: AuditTransaction, actor: Pick<AccessIdentity, 'id' | 'name'> | null,
  action: string, entityId: string, label: string, changes: Record<string, { before?: unknown; after?: unknown }> = {}) {
  const id = randomUUID()
  await tx.insert(auditOperations).values({ id, actorId: actor?.id, actorName: actor?.name ?? 'Оператор сервера', action, area: 'access', source: 'access' })
  await tx.insert(auditChanges).values({ operationId: id, entity: 'account', entityId, label, area: 'access',
    kind: action === 'account.delete' ? 'delete' : action === 'account.invite' ? 'create' : 'update', changes: JSON.parse(JSON.stringify(changes)) })
}
