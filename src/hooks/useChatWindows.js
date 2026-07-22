import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * Shared multi-window state for the Agent / Senior Agent workspaces.
 *
 * Each open ticket gets its own floating chat window. This hook is the
 * single source of truth for which windows are open, their stacking
 * (z-index) order, which one is minimized, and a stable "cascade index"
 * used to offset each window's default position so newly-opened windows
 * don't all land in exactly the same spot.
 *
 * Positions/sizes themselves stay local to each <FloatingChatWindow/>
 * instance — this hook only tracks open/closed/minimized/order, which is
 * all the surrounding dashboard chrome (sidebar highlighting, taskbar)
 * needs to know about.
 */
export default function useChatWindows() {
  // Stacking order: index 0 = bottom, last = topmost/focused.
  const [openIds, setOpenIds] = useState([])
  const [minimizedIds, setMinimizedIds] = useState(() => new Set())

  // Stable per-window cascade index, assigned once the first time a ticket
  // is ever opened and never reused, so re-opening a previously-closed
  // window still cascades sensibly relative to whatever is open now.
  const seqRef = useRef(0)
  const seqMapRef = useRef(new Map())
  const getCascadeIndex = useCallback((id) => {
    if (!seqMapRef.current.has(id)) {
      seqMapRef.current.set(id, seqRef.current++)
    }
    return seqMapRef.current.get(id)
  }, [])

  const openWindow = useCallback((id) => {
    if (!id) return
    getCascadeIndex(id)
    setOpenIds((prev) => (prev[prev.length - 1] === id ? prev : [...prev.filter((x) => x !== id), id]))
    setMinimizedIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [getCascadeIndex])

  const closeWindow = useCallback((id) => {
    setOpenIds((prev) => prev.filter((x) => x !== id))
    setMinimizedIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const focusWindow = useCallback((id) => {
    setOpenIds((prev) => {
      if (prev.length === 0 || prev[prev.length - 1] === id) return prev
      if (!prev.includes(id)) return prev
      return [...prev.filter((x) => x !== id), id]
    })
    setMinimizedIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const toggleMinimize = useCallback((id) => {
    setMinimizedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const closeAll = useCallback(() => {
    setOpenIds([])
    setMinimizedIds(new Set())
  }, [])

  // The topmost, non-minimized window — used to drive "selected" styling
  // in the sidebar lists so it still reads as "this is the ticket I'm
  // looking at" even though several windows may be open at once.
  const activeId = useMemo(() => {
    for (let i = openIds.length - 1; i >= 0; i -= 1) {
      if (!minimizedIds.has(openIds[i])) return openIds[i]
    }
    return null
  }, [openIds, minimizedIds])

  return {
    openIds,
    minimizedIds,
    activeId,
    openWindow,
    closeWindow,
    focusWindow,
    toggleMinimize,
    closeAll,
    getCascadeIndex,
  }
}
