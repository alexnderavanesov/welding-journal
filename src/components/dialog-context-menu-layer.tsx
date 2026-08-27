import { forwardRef, useImperativeHandle, useState } from 'react'

import { ContextActionMenu, type ContextActionMenuState } from '@/components/context-action-menu'

export type DialogContextMenuLayerHandle = {
  open: (menu: NonNullable<ContextActionMenuState>) => void
  close: () => void
}

export const DialogContextMenuLayer = forwardRef<DialogContextMenuLayerHandle>(function DialogContextMenuLayer(_, ref) {
  const [menu, setMenu] = useState<ContextActionMenuState>(null)

  useImperativeHandle(ref, () => ({
    open: setMenu,
    close: () => setMenu(null),
  }), [])

  return <ContextActionMenu menu={menu} closeOnEscapeWithModal onClose={() => setMenu(null)} />
})
