import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const MIN_WIDTH = 380
const MIN_HEIGHT = 420
// Bumped up from the original 460x600 so the chat area is genuinely usable on
// smaller desktop screens without immediately having to resize/maximize —
// more messages visible at once, less scrolling.
const DEFAULT_WIDTH = 540
const DEFAULT_HEIGHT = 680
const MARGIN = 12
const CASCADE_STEP = 28
const CASCADE_WRAP = 8
export const TASKBAR_HEIGHT = 48
export const BASE_Z_INDEX = 100

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function defaultGeometry(cascadeIndex = 0) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const usableHeight = vh - TASKBAR_HEIGHT
  const width = Math.min(DEFAULT_WIDTH, vw - MARGIN * 2)
  const height = Math.min(DEFAULT_HEIGHT, usableHeight - MARGIN * 2)
  const cascade = (cascadeIndex % CASCADE_WRAP) * CASCADE_STEP
  return {
    width,
    height,
    x: clamp(vw - width - 48 - cascade, MARGIN, Math.max(MARGIN, vw - width - MARGIN)),
    y: clamp(72 + cascade, MARGIN, Math.max(MARGIN, usableHeight - height - MARGIN)),
  }
}

/**
 * Floating window chrome for a single ticket's workspace (chat, notes, QA,
 * and ticket actions all live inside `children`). Many of these can be
 * mounted at once — the Agent / Senior dashboards render one per open
 * ticket. Each instance owns its own position/size; only stacking order
 * (z-index) and minimized state are controlled by the parent so the
 * taskbar and "bring to front on click" behavior can coordinate across
 * every open window.
 */
export default function FloatingChatWindow({
  title,
  subtitle,
  zIndex = BASE_Z_INDEX,
  active = false,
  minimized = false,
  cascadeIndex = 0,
  onFocus,
  onClose,
  onMinimize,
  children,
}) {
  const dragState = useRef(null)
  const resizeState = useRef(null)

  const [geometry, setGeometry] = useState(() => defaultGeometry(cascadeIndex))
  const [maximized, setMaximized] = useState(false)
  const preMaximizeGeometry = useRef(null)

  const onDragMove = useCallback((e) => {
    if (!dragState.current) return
    const { startX, startY, originX, originY } = dragState.current
    const vw = window.innerWidth
    const vh = window.innerHeight - TASKBAR_HEIGHT
    setGeometry((g) => ({
      ...g,
      x: clamp(originX + (e.clientX - startX), -g.width + 160, vw - 160),
      y: clamp(originY + (e.clientY - startY), 0, vh - 40),
    }))
  }, [])

  const onDragEnd = useCallback(() => {
    dragState.current = null
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragEnd)
  }, [onDragMove])

  const startDrag = (e) => {
    onFocus?.()
    if (maximized) return
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: geometry.x,
      originY: geometry.y,
    }
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragEnd)
  }

  const onResizeMove = useCallback((e) => {
    if (!resizeState.current) return
    const { dir, startX, startY, origin } = resizeState.current
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    const vw = window.innerWidth
    const vh = window.innerHeight - TASKBAR_HEIGHT

    let { x, y, width, height } = origin
    if (dir.includes('e')) width = clamp(origin.width + dx, MIN_WIDTH, vw - origin.x - MARGIN)
    if (dir.includes('s')) height = clamp(origin.height + dy, MIN_HEIGHT, vh - origin.y - MARGIN)
    if (dir.includes('w')) {
      const newWidth = clamp(origin.width - dx, MIN_WIDTH, origin.x + origin.width - MARGIN)
      x = origin.x + (origin.width - newWidth)
      width = newWidth
    }
    if (dir.includes('n')) {
      const newHeight = clamp(origin.height - dy, MIN_HEIGHT, origin.y + origin.height - MARGIN)
      y = origin.y + (origin.height - newHeight)
      height = newHeight
    }
    setGeometry({ x, y, width, height })
  }, [])

  const onResizeEnd = useCallback(() => {
    resizeState.current = null
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
  }, [onResizeMove])

  const startResize = (dir) => (e) => {
    if (maximized) return
    e.stopPropagation()
    e.preventDefault()
    onFocus?.()
    resizeState.current = { dir, startX: e.clientX, startY: e.clientY, origin: { ...geometry } }
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup', onResizeEnd)
  }

  useEffect(() => () => {
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragEnd)
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
  }, [onDragMove, onDragEnd, onResizeMove, onResizeEnd])

  const toggleMaximize = () => {
    onFocus?.()
    if (maximized) {
      setGeometry(preMaximizeGeometry.current ?? defaultGeometry(cascadeIndex))
      setMaximized(false)
    } else {
      preMaximizeGeometry.current = geometry
      setMaximized(true)
    }
  }

  const style = useMemo(() => {
    if (maximized) {
      return { top: MARGIN, left: MARGIN, right: MARGIN, bottom: TASKBAR_HEIGHT + MARGIN, width: 'auto', height: 'auto' }
    }
    return { top: geometry.y, left: geometry.x, width: geometry.width, height: geometry.height }
  }, [geometry, maximized])

  // Minimized windows are represented purely by their taskbar entry — no
  // point keeping the (invisible) floating chrome mounted, but the parent
  // keeps this component itself alive via the same `key`, so geometry and
  // any other local state survives a minimize/restore round trip.
  if (minimized) return null

  const RESIZE_HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

  return (
    <div
      onMouseDownCapture={onFocus}
      className={`fixed flex flex-col overflow-hidden rounded-xl border bg-[var(--panel)] shadow-2xl transition-shadow ${
        active ? 'border-[var(--brand-bright)] shadow-[0_20px_45px_-15px_rgba(27,94,91,0.35)]' : 'border-[var(--line)]'
      }`}
      style={{ ...style, zIndex }}
    >
      <div
        onMouseDown={startDrag}
        onDoubleClick={toggleMaximize}
        className={`flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 ${
          maximized ? 'cursor-default' : 'cursor-move'
        }`}
      >
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-[var(--ink)]" title={title}>{title}</div>
          {subtitle && <div className="truncate text-[10px] text-[var(--muted)]" title={subtitle}>{subtitle}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <WindowButton label="Minimize" onClick={() => onMinimize?.()}>—</WindowButton>
          <WindowButton label={maximized ? 'Restore' : 'Maximize'} onClick={toggleMaximize}>
            {maximized ? '❐' : '□'}
          </WindowButton>
          <WindowButton label="Close" onClick={() => onClose?.()} danger>✕</WindowButton>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {children}
      </div>

      {!maximized && (
        <>
          {RESIZE_HANDLES.map((dir) => (
            <div
              key={dir}
              onMouseDown={startResize(dir)}
              className={resizeHandleClass(dir)}
            />
          ))}
        </>
      )}
    </div>
  )
}

function WindowButton({ children, onClick, label, danger }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-5 w-5 items-center justify-center rounded text-[var(--muted)] text-xs leading-none hover:bg-[var(--line)] hover:text-[var(--ink)] ${
        danger ? 'hover:bg-[var(--status-escalated)] hover:text-white' : ''
      }`}
    >
      {children}
    </button>
  )
}

function resizeHandleClass(dir) {
  const base = 'absolute'
  const map = {
    n: 'top-0 left-2 right-2 h-1.5 cursor-n-resize',
    s: 'bottom-0 left-2 right-2 h-1.5 cursor-s-resize',
    e: 'top-2 bottom-2 right-0 w-1.5 cursor-e-resize',
    w: 'top-2 bottom-2 left-0 w-1.5 cursor-w-resize',
    ne: 'top-0 right-0 h-3 w-3 cursor-ne-resize',
    nw: 'top-0 left-0 h-3 w-3 cursor-nw-resize',
    se: 'bottom-0 right-0 h-3 w-3 cursor-se-resize',
    sw: 'bottom-0 left-0 h-3 w-3 cursor-sw-resize',
  }
  return `${base} ${map[dir]}`
}