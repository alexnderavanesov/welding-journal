import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { setContextActionMenuOpen } from '@/lib/context-action-menu-state'
import { isModalDialogOpen } from '@/lib/modal-layer'

export type ContextActionMenuItem =
  | {
      type?: 'item'
      id: string
      label: string
      description?: string
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
  | {
      type: 'label'
      id: string
      label: string
    }

export type ContextActionMenuState = {
  x: number
  y: number
  anchorRowId?: number
  heading?: string
  description?: string
  items: ContextActionMenuItem[]
} | null

type ContextActionMenuProps = {
  menu: ContextActionMenuState
  closeOnEscapeWithModal?: boolean
  onClose: () => void
}

export function ContextActionMenu({ menu, closeOnEscapeWithModal = false, onClose }: ContextActionMenuProps) {
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null)
  const [submenuLayout, setSubmenuLayout] = useState<{
    id: string
    left: number
    top: number
    maxHeight: number
    width: number
  } | null>(null)
  const menuPanelRef = useRef<HTMLDivElement | null>(null)
  const submenuAnchorRefs = useRef(new Map<string, HTMLDivElement>())
  const submenuPanelRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    setContextActionMenuOpen(Boolean(menu))
    return () => setContextActionMenuOpen(false)
  }, [menu])

  useEffect(() => {
    setOpenSubmenuId(null)
    setSubmenuLayout(null)
  }, [menu])

  useLayoutEffect(() => {
    if (!openSubmenuId || typeof window === 'undefined') {
      setSubmenuLayout(null)
      return
    }

    const anchor = submenuAnchorRefs.current.get(openSubmenuId)
    const panel = submenuPanelRefs.current.get(openSubmenuId)
    if (!anchor || !panel) return

    const viewportPadding = 8
    const menuWidth = Math.min(320, Math.max(224, window.innerWidth - viewportPadding * 2))
    if (window.innerWidth < menuWidth * 2 + viewportPadding * 2) {
      setSubmenuLayout(null)
      return
    }
    const anchorRect = anchor.getBoundingClientRect()
    const maxHeight = Math.max(96, window.innerHeight - viewportPadding * 2)
    const panelHeight = Math.min(panel.scrollHeight, maxHeight)
    const viewportTop = Math.min(
      Math.max(viewportPadding, anchorRect.top),
      window.innerHeight - viewportPadding - panelHeight,
    )
    const openLeft = anchorRect.right + menuWidth > window.innerWidth - viewportPadding
    const preferredLeft = openLeft
      ? anchorRect.left - menuWidth + 1
      : anchorRect.right - 1
    setSubmenuLayout({
      id: openSubmenuId,
      left: Math.max(
        viewportPadding,
        Math.min(preferredLeft, window.innerWidth - viewportPadding - menuWidth),
      ),
      top: viewportTop,
      maxHeight,
      width: menuWidth,
    })
  }, [openSubmenuId])

  useEffect(() => {
    if (!menu) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (isModalDialogOpen() && !closeOnEscapeWithModal) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      onClose()
    }
    const handleWindowChange = () => onClose()
    const handleWindowScroll = (event: Event) => {
      const target = event.target
      if (
        target instanceof Node
        && (
          menuPanelRef.current?.contains(target)
          || Array.from(submenuPanelRefs.current.values()).some((panel) => panel.contains(target))
        )
      ) {
        return
      }
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowScroll, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowScroll, true)
    }
  }, [closeOnEscapeWithModal, menu, onClose])

  if (!menu || typeof document === 'undefined') return null

  const viewportPadding = 8
  const menuWidth = Math.min(320, Math.max(224, window.innerWidth - viewportPadding * 2))
  const menuHeight = estimateMenuHeight(menu.items) + (menu.heading ? 52 : 0)
  const maxMenuHeight = Math.max(160, window.innerHeight - viewportPadding * 2)
  const menuLeft = Math.min(menu.x, window.innerWidth - menuWidth - viewportPadding)
  const stackSubmenus = window.innerWidth < menuWidth * 2 + viewportPadding * 2
  const preferredTop =
    menu.y + Math.min(menuHeight, maxMenuHeight) > window.innerHeight - viewportPadding
      ? menu.y - Math.min(menuHeight, maxMenuHeight)
      : menu.y
  const menuTop = Math.min(Math.max(viewportPadding, preferredTop), window.innerHeight - viewportPadding - Math.min(menuHeight, maxMenuHeight))

  return createPortal(
    <div className="fixed inset-0 z-[100]" onMouseDown={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div
        ref={menuPanelRef}
        className="absolute min-w-0 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl shadow-slate-900/12"
        style={{
          left: Math.max(viewportPadding, menuLeft),
          top: menuTop,
          width: menuWidth,
          maxHeight: maxMenuHeight,
          overflowY: stackSubmenus || menuHeight > maxMenuHeight ? 'auto' : undefined,
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {menu.heading ? (
          <div className="border-b border-slate-100 px-3 pb-2 pt-1">
            <div className="truncate text-sm font-semibold text-slate-900">{menu.heading}</div>
            {menu.description ? <div className="mt-0.5 truncate text-xs text-slate-500">{menu.description}</div> : null}
          </div>
        ) : null}
        {menu.items.map((item) => {
          if (item.type === 'separator') {
            return <div key={item.id} className="my-1 border-t border-slate-100" />
          }
          if (item.type === 'label') {
            return (
              <div key={item.id} className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase text-slate-400">
                {item.label}
              </div>
            )
          }

          const Icon = item.icon
          const hasChildren = Boolean(item.children?.length)
          const isSubmenuOpen = openSubmenuId === item.id
          const description = item.description ?? (item.disabled ? item.title : undefined)
          const submenu = hasChildren ? (
            <div
              ref={(node) => {
                if (node) submenuPanelRefs.current.set(item.id, node)
                else submenuPanelRefs.current.delete(item.id)
              }}
              role="menu"
              className={`${
                stackSubmenus
                  ? 'relative mx-2 mb-1 w-[calc(100%-1rem)] border-l-2 border-sky-100 bg-slate-50 py-1'
                  : 'fixed z-[101] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl shadow-slate-900/12 transition-opacity'
              } ${
                isSubmenuOpen
                  ? 'visible opacity-100'
                  : stackSubmenus
                    ? 'hidden'
                    : 'invisible opacity-0'
              }`}
              style={!stackSubmenus ? {
                left: submenuLayout?.id === item.id ? submenuLayout.left : Math.max(viewportPadding, menuLeft + menuWidth - 1),
                top: submenuLayout?.id === item.id ? submenuLayout.top : menuTop,
                width: submenuLayout?.id === item.id ? submenuLayout.width : menuWidth,
                maxHeight: submenuLayout?.id === item.id ? submenuLayout.maxHeight : maxMenuHeight,
              } : undefined}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {item.children?.map((child) => {
                if (child.type === 'separator') return <div key={child.id} className="my-1 border-t border-slate-100" />
                if (child.type === 'label') {
                  return (
                    <div key={child.id} className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase text-slate-400">
                      {child.label}
                    </div>
                  )
                }
                const ChildIcon = child.icon
                const childDescription = child.description ?? (child.disabled ? child.title : undefined)
                return (
                  <button
                    key={child.id}
                    type="button"
                    disabled={child.disabled}
                    title={child.title}
                    aria-label={child.label}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors ${
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
                    {ChildIcon ? <ChildIcon className="mt-0.5 h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block break-words leading-5">{child.label}</span>
                      {childDescription ? (
                        <span className={`mt-0.5 block text-xs font-normal leading-4 ${
                          child.disabled ? 'text-slate-400' : 'text-slate-500'
                        }`}>
                          {childDescription}
                        </span>
                      ) : null}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null
          return (
            <div
              key={item.id}
              ref={(node) => {
                if (node) submenuAnchorRefs.current.set(item.id, node)
                else submenuAnchorRefs.current.delete(item.id)
              }}
              className="relative"
              onMouseEnter={() => setOpenSubmenuId(hasChildren ? item.id : null)}
            >
              <button
                type="button"
                disabled={item.disabled}
                title={item.title}
                aria-label={item.label}
                aria-haspopup={hasChildren ? 'menu' : undefined}
                aria-expanded={hasChildren ? isSubmenuOpen : undefined}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  item.danger
                    ? 'text-rose-600 hover:bg-rose-50 hover:text-rose-700'
                    : 'text-slate-700 hover:bg-sky-50 hover:text-sky-900'
                } disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-300`}
                onClick={() => {
                  if (item.disabled) return
                  if (hasChildren) {
                    setOpenSubmenuId((currentId) => (
                      stackSubmenus && currentId === item.id ? null : item.id
                    ))
                    return
                  }
                  onClose()
                  item.onSelect()
                }}
              >
                {Icon ? <Icon className="mt-0.5 h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block break-words leading-5">{item.label}</span>
                  {description ? (
                    <span className={`mt-0.5 block text-xs font-normal leading-4 ${
                      item.disabled ? 'text-slate-400' : 'text-slate-500'
                    }`}>
                      {description}
                    </span>
                  ) : null}
                </span>
                {hasChildren ? (
                  <ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                    stackSubmenus && isSubmenuOpen ? 'rotate-90' : ''
                  }`} />
                ) : null}
              </button>
              {submenu
                ? stackSubmenus
                  ? submenu
                  : createPortal(submenu, document.body)
                : null}
            </div>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}

function estimateMenuHeight(items: ContextActionMenuItem[]) {
  return items.reduce((height, item) => {
    if (item.type === 'separator') return height + 9
    if (item.type === 'label') return height + 28
    return height + (item.description || (item.disabled && item.title) ? 56 : 36)
  }, 12)
}
