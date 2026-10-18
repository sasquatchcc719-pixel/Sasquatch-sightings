'use client'

import {
  useEffect,
  useId,
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
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    latest.current = { items, getId }
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
          Drag to change order, or use the Up and Down arrow keys.
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
          title="Drag to reorder · Up/Down arrow keys also work"
          disabled={items.length < 2}
          className={`absolute top-2 right-2 z-10 flex h-8 w-8 cursor-grab touch-none items-center justify-center rounded-md border focus-visible:ring-2 focus-visible:ring-emerald-500 active:cursor-grabbing disabled:cursor-default disabled:opacity-30 ${draggingId === id ? 'border-emerald-500 bg-emerald-100 text-emerald-800' : 'border-slate-300 bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
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
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            stopDrag.current?.()
            const button = event.currentTarget
            button.focus({ preventScroll: true })
            button.setPointerCapture?.(event.pointerId)
            setDraggingId(id)
            let point = { x: event.clientX, y: event.clientY }
            let frame = 0
            const hitTest = () => {
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
              point = { x: pointer.clientX, y: pointer.clientY }
              hitTest()
            }
            const tick = () => {
              const delta =
                point.y < 64 ? -12 : point.y > window.innerHeight - 64 ? 12 : 0
              if (delta) {
                window.scrollBy(0, delta)
                hitTest()
              }
              frame = requestAnimationFrame(tick)
            }
            const finish = () => {
              cancelAnimationFrame(frame)
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', finish)
              window.removeEventListener('pointercancel', finish)
              if (button.hasPointerCapture?.(event.pointerId))
                button.releasePointerCapture(event.pointerId)
              setDraggingId(null)
              stopDrag.current = null
            }
            stopDrag.current = finish
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', finish)
            window.addEventListener('pointercancel', finish)
            frame = requestAnimationFrame(tick)
          }}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      )
    },
  }
}
