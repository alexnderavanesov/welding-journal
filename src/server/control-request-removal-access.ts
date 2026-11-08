import { hasPermission, type AccessIdentity } from '@/lib/access-permissions'
import type { ControlRequestRemoval } from '@/lib/control-request-removal-preview'

export type RestrictedControlRequestRemoval = ControlRequestRemoval & { accessAreas: Array<'lnk' | 'psto'> }

/** Project only the public preview. The complete positions and token remain
 * authoritative for confirmation and atomic removal, regardless of the viewer.
 * Document viewers already have access to this registry metadata.
 */
export function projectControlRequestRemovalPreview<T extends { removals: readonly RestrictedControlRequestRemoval[] }>(
  preview: T, identity?: AccessIdentity,
) {
  const visible = preview.removals.filter(item => !identity || hasPermission(identity, 'documents.view') ||
    item.accessAreas.length > 0 && item.accessAreas.every(area => hasPermission(identity, `${area}.view`)))
  return { ...preview,
    removals: visible.map(({ accessAreas: _accessAreas, ...item }) => item),
    hiddenRemovalCount: preview.removals.length - visible.length,
  }
}
