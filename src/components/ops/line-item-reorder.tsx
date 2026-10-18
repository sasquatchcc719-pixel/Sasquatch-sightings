'use client'

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { GripVertical } from 'lucide-react'

export function useLineItemReorder<T>(
  items: T[],
  setItems: Dispatch<SetStateAction<T[]>>,
  getId: (item: T) => string,
) {
  const listId = useId()
  const latest = useRef({ items, getId })
  const stopDrag = useRef<(() => void) | null>(null)
  const refreshDrag = useRef<(() => void) | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  useLayoutEffect(() => {
    latest.current = { items, getId }
    // React moves the keyed card when its order changes. Keep its grabbed
    // corner under the pointer instead of jumping to its new layout position.
    refreshDrag.current?.()
  }, [items, getId])
  useEffect(() => () => stopDrag.current?.(), [])

  function move(id: string, targetId: string) {
    const current = latest.current
    const from = current.items.findIndex((item) => current.getId(item) === id)
    const to = current.items.findIndex(
      (item) => current.getId(item) === targetId,
    )
    if (from < 0 || to < 0 || from === to) return
    setItems((rows) => {
      const start = rows.findIndex((item) => latest.current.getId(item) === id)
      const end = rows.findIndex(
        (item) => latest.current.getId(item) === targetId,
      )
      // Several pointer/scroll events can be batched before React commits.
      // Once this requested position is reached, do not swap it back again.
      if (start === to) return rows
      if (start < 0 || end < 0 || start === end) return rows
      const next = [...rows]
      const [row] = next.splice(start, 1)
      next.splice(end, 0, row)
      return next
    })
    setAnnouncement(
      `Line moved to position ${to + 1} of ${current.items.length}. Save to keep this order.`,
    )
  }

  return {
    cardProps(id: string) {
      return { 'data-reorder-list': listId, 'data-reorder-key': id }
    },
    status: (
      <>
        <span id={`${listId}-help`} className="sr-only">
          Drag the corner grip with your mouse or finger to change order, or use
          the Up and Down arrow keys. Press Escape to cancel a drag.
        </span>
        <span
          className="sr-only"
          role={announcement ? 'status' : undefined}
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </span>
      </>
    ),
    handle(id: string, index: number, label: string) {
      return (
        <button
          type="button"
          aria-label={`Reorder line ${index + 1}: ${label || 'Custom service'}`}
          aria-describedby={`${listId}-help`}
          title="Drag with mouse or finger · Up/Down arrow keys also work"
          disabled={items.length < 2}
          className={`absolute top-1 right-1 z-10 flex h-11 w-11 cursor-grab touch-none items-center justify-center rounded-md border focus-visible:ring-2 focus-visible:ring-emerald-500 active:cursor-grabbing disabled:cursor-default disabled:opacity-30 ${draggingId === id ? 'border-emerald-500 bg-emerald-100 text-emerald-800' : 'border-slate-300 bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
          style={{ touchAction: 'none' }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            const next = index + (event.key === 'ArrowUp' ? -1 : 1)
            if (next < 0 || next >= items.length) return
            move(id, getId(items[next]))
            const button = event.currentTarget
            requestAnimationFrame(() => {
              button.focus({ preventScroll: true })
              button.scrollIntoView({ block: 'nearest' })
            })
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || event.isPrimary === false) return
            event.preventDefault()
            event.stopPropagation()
            stopDrag.current?.()
            const button = event.currentTarget
            const card = button.closest<HTMLElement>('[data-reorder-key]')
            const container = card?.parentElement
            if (!card || !container) return
            button.focus({ preventScroll: true })
            // Capture on the stable list, not the card React will move.
            container.setPointerCapture?.(event.pointerId)
            const pointerId = event.pointerId
            const initialOrder = latest.current.items.map(latest.current.getId)
            const initialStyle = card.getAttribute('style')
            const bounds = card.getBoundingClientRect()
            const start = { x: event.clientX, y: event.clientY }
            const grab = { x: start.x - bounds.left, y: start.y - bounds.top }
            let point = { x: event.clientX, y: event.clientY }
            let frame = 0
            let active = false
            let finished = false
            // A translated card can extend scrollable overflow. Use the real
            // content limits from before lifting it, so edge scrolling stops.
            const windowScrollLimit = Math.max(
              0,
              document.documentElement.scrollHeight - window.innerHeight,
            )
            const scrollParents: { element: HTMLElement; limit: number }[] = []
            for (
              let node: HTMLElement | null = container;
              node;
              node = node.parentElement
            ) {
              if (/(auto|scroll)/.test(getComputedStyle(node).overflowY))
                scrollParents.push({
                  element: node,
                  limit: Math.max(0, node.scrollHeight - node.clientHeight),
                })
            }
            const draw = () => {
              if (!active || finished) return
              card.style.transform = 'none'
              const layout = card.getBoundingClientRect()
              card.style.transform = `translate3d(${point.x - grab.x - layout.left}px, ${point.y - grab.y - layout.top}px, 0)`
            }
            const hitTest = () => {
              if (!active) return
              const target = document
                .elementFromPoint(point.x, point.y)
                ?.closest<HTMLElement>('[data-reorder-key]')
              if (
                !target ||
                target.dataset.reorderList !== listId ||
                target.dataset.reorderKey === id
              )
                return
              const current = latest.current
              const from = current.items.findIndex(
                (item) => current.getId(item) === id,
              )
              const to = current.items.findIndex(
                (item) => current.getId(item) === target.dataset.reorderKey,
              )
              const bounds = target.getBoundingClientRect()
              if (
                (from < to && point.y < bounds.top + bounds.height / 2) ||
                (from > to && point.y > bounds.top + bounds.height / 2)
              )
                return
              move(id, target.dataset.reorderKey!)
            }
            const onMove = (pointer: PointerEvent) => {
              if (pointer.pointerId !== pointerId) return
              if (pointer.cancelable) pointer.preventDefault()
              point = { x: pointer.clientX, y: pointer.clientY }
              if (!active) {
                if (Math.hypot(point.x - start.x, point.y - start.y) < 5) return
                active = true
                setDraggingId(id)
                card.dataset.reorderDragging = 'true'
                const background = getComputedStyle(card).backgroundColor
                Object.assign(card.style, {
                  position: 'relative',
                  zIndex: '100',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  willChange: 'transform',
                  transition: 'none',
                  animation: 'none',
                  backgroundColor:
                    background === 'rgba(0, 0, 0, 0)' ||
                    background === 'transparent'
                      ? 'var(--card, white)'
                      : background,
                  boxShadow: '0 18px 45px rgba(0, 0, 0, 0.3)',
                  outline: '2px solid #34d399',
                })
                refreshDrag.current = draw
              }
              draw()
              hitTest()
            }
            const onScroll = () => {
              draw()
              hitTest()
            }
            const tick = () => {
              if (active) {
                let scrolled = false
                for (const { element: parent, limit } of scrollParents) {
                  const rect = parent.getBoundingClientRect()
                  const top = Math.max(0, rect.top)
                  const bottom = Math.min(window.innerHeight, rect.bottom)
                  const delta =
                    point.y < top + 64 ? -12 : point.y > bottom - 64 ? 12 : 0
                  const previous = parent.scrollTop
                  parent.scrollTop = Math.max(
                    0,
                    Math.min(limit, previous + delta),
                  )
                  if (parent.scrollTop !== previous) {
                    scrolled = true
                    break
                  }
                }
                if (!scrolled) {
                  const delta =
                    point.y < 64
                      ? -12
                      : point.y > window.innerHeight - 64
                        ? 12
                        : 0
                  const boundedDelta =
                    Math.max(
                      0,
                      Math.min(windowScrollLimit, window.scrollY + delta),
                    ) - window.scrollY
                  if (boundedDelta)
                    window.scrollBy({ top: boundedDelta, behavior: 'instant' })
                }
                draw()
                hitTest()
              }
              frame = requestAnimationFrame(tick)
            }
            const finish = (cancelled = false) => {
              if (finished) return
              finished = true
              cancelAnimationFrame(frame)
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
              window.removeEventListener('pointercancel', onCancel)
              window.removeEventListener('keydown', onKey)
              window.removeEventListener('blur', cancel)
              window.removeEventListener('scroll', onScroll, true)
              window.removeEventListener('resize', cancel)
              container.removeEventListener('lostpointercapture', onLostCapture)
              if (container.hasPointerCapture?.(pointerId))
                container.releasePointerCapture(pointerId)
              if (active) {
                if (initialStyle === null) card.removeAttribute('style')
                else card.setAttribute('style', initialStyle)
                delete card.dataset.reorderDragging
              }
              if (cancelled && active) {
                setItems((rows) => [
                  ...initialOrder.flatMap((key) =>
                    rows.filter((row) => latest.current.getId(row) === key),
                  ),
                  ...rows.filter(
                    (row) => !initialOrder.includes(latest.current.getId(row)),
                  ),
                ])
                setAnnouncement('Reorder cancelled. Original order restored.')
              }
              setDraggingId(null)
              refreshDrag.current = null
              stopDrag.current = null
            }
            const onUp = (pointer: PointerEvent) => {
              if (pointer.pointerId === pointerId) finish()
            }
            const onCancel = (pointer: PointerEvent) => {
              if (pointer.pointerId === pointerId) finish(true)
            }
            const onLostCapture = (pointer: PointerEvent) => {
              // Touch starts with implicit capture on the grip. Its bubbled
              // loss when capture transfers to the list is not a cancelled drag.
              if (pointer.target === container) onCancel(pointer)
            }
            const cancel = () => finish(true)
            const onKey = (key: KeyboardEvent) => {
              if (key.key === 'Escape') {
                key.preventDefault()
                cancel()
              }
            }
            stopDrag.current = () => finish()
            window.addEventListener('pointermove', onMove, { passive: false })
            window.addEventListener('pointerup', onUp)
            window.addEventListener('pointercancel', onCancel)
            window.addEventListener('keydown', onKey)
            window.addEventListener('blur', cancel)
            window.addEventListener('scroll', onScroll, true)
            window.addEventListener('resize', cancel)
            container.addEventListener('lostpointercapture', onLostCapture)
            frame = requestAnimationFrame(tick)
          }}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      )
    },
  }
}
