import { useEffect, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { setContextActionMenuOpen } from '@/lib/context-action-menu-state'

export type ContextActionMenuItem =
  | {
      type?: 'item'
      id: string
      label: string
      title?: string
      icon?: ComponentType<{ className?: string }>
      disabled?: boolean
      danger?: boolean
      children?: ContextActionMenuItem[]
      onSelect: () => void
    }
  | {
      type: 'separator'
      id: string
    }

export type ContextActionMenuState = {
  x: number
  y: number
  items: ContextActionMenuItem[]
} | null

type ContextActionMenuProps = {
  menu: ContextActionMenuState
  onClose: () => void
}

export function ContextActionMenu({ menu, onClose }: ContextActionMenuProps) {
  useEffect(() => {
    setContextActionMenuOpen(Boolean(menu))
    return () => setContextActionMenuOpen(false)
  }, [menu])

  useEffect(() => {
    if (!menu) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      onClose()
    }
    const handleWindowChange = () => onClose()

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowChange, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
    }
  }, [menu, onClose])

  if (!menu || typeof document === 'undefined') return null

  const menuWidth = 240
  const viewportPadding = 8
  const menuHeight = estimateMenuHeight(menu.items)
  const maxMenuHeight = Math.max(160, window.innerHeight - viewportPadding * 2)
  const menuLeft = Math.min(menu.x, window.innerWidth - menuWidth - viewportPadding)
  const preferredTop =
    menu.y + Math.min(menuHeight, maxMenuHeight) > window.innerHeight - viewportPadding
      ? menu.y - Math.min(menuHeight, maxMenuHeight)
      : menu.y
  const menuTop = Math.min(Math.max(viewportPadding, preferredTop), window.innerHeight - viewportPadding - Math.min(menuHeight, maxMenuHeight))

  return createPortal(
    <div className="fixed inset-0 z-[100]" onMouseDown={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div
        className="absolute min-w-56 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl shadow-slate-900/12"
        style={{
          left: Math.max(viewportPadding, menuLeft),
          top: menuTop,
          width: menuWidth,
          maxHeight: maxMenuHeight,
          overflowY: menuHeight > maxMenuHeight ? 'auto' : undefined,
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {menu.items.map((item) => {
          if (item.type === 'separator') {
            return <div key={item.id} className="my-1 border-t border-slate-100" />
          }

          const Icon = item.icon
          const hasChildren = Boolean(item.children?.length)
          const firstEnabledChild = item.children?.find((child) => child.type !== 'separator' && !child.disabled)
          return (
            <div key={item.id} className="group/context-submenu relative">
              <button
                type="button"
                disabled={item.disabled}
                title={item.title}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  item.danger
                    ? 'text-rose-600 hover:bg-rose-50 hover:text-rose-700'
                    : 'text-slate-700 hover:bg-sky-50 hover:text-sky-900'
                } disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-300`}
                onClick={() => {
                  if (item.disabled) return
                  if (hasChildren) {
                    if (!firstEnabledChild || firstEnabledChild.type === 'separator') return
                    onClose()
                    firstEnabledChild.onSelect()
                    return
                  }
                  onClose()
                  item.onSelect()
                }}
              >
                {Icon ? <Icon className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {hasChildren ? <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" /> : null}
              </button>
              {hasChildren ? (
                <div className="invisible absolute left-full top-0 z-[101] ml-1 min-w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1.5 opacity-0 shadow-xl shadow-slate-900/12 transition-opacity group-hover/context-submenu:visible group-hover/context-submenu:opacity-100">
                  {item.children?.map((child) => {
                    if (child.type === 'separator') return <div key={child.id} className="my-1 border-t border-slate-100" />
                    const ChildIcon = child.icon
                    return (
                      <button
                        key={child.id}
                        type="button"
                        disabled={child.disabled}
                        title={child.title}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                          child.danger
                            ? 'text-rose-600 hover:bg-rose-50 hover:text-rose-700'
                            : 'text-slate-700 hover:bg-sky-50 hover:text-sky-900'
                        } disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-300`}
                        onClick={() => {
                          if (child.disabled) return
                          onClose()
                          child.onSelect()
                        }}
                      >
                        {ChildIcon ? <ChildIcon className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0" />}
                        <span className="min-w-0 flex-1 truncate">{child.label}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}

function estimateMenuHeight(items: ContextActionMenuItem[]) {
  return items.reduce((height, item) => height + (item.type === 'separator' ? 9 : 36), 12)
}
