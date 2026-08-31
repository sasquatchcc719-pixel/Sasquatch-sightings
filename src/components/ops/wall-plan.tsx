'use client'

import { useMemo, useState } from 'react'
import {
  draftLengthFt,
  endPointForLength,
  findNodeNear,
  formatFeetInches,
  loopAt,
  offsetNodes,
  openingPosition,
  resolveWalls,
  snapToGrid,
  wallNear,
  type PlanNode,
  type PlanWall,
  type WallOpening,
} from '@/lib/ops/restoration-walls'

/**
 * Wall-based floor plan editor.
 *
 * Walls are the thing you draw; corners are shared, so dragging one moves every
 * wall meeting there. A wall that closes nothing is a pony wall, which is what
 * the previous room-polygon version could not represent at all.
 *
 * Tools:
 *  - wall    : drag to draw a wall; ends snap to nearby corners so rooms close
 *  - corner  : drag a corner to move it, with every attached wall following
 *  - door    : tap a wall to host a door on it (never in open floor)
 *  - pin     : drop equipment or a reading point
 */

export type PlanPin = {
  id: string
  kind: 'equipment' | 'reading'
  label: string
  /** Two letters on an equipment pin, so a dehu reads differently to a fan. */
  glyph?: string
  xFt: number | null
  yFt: number | null
  value?: number | null
  atGoal?: boolean
  removed?: boolean
}

export type WallPlanTool = 'wall' | 'resize' | 'corner' | 'door' | 'pin'

type Props = {
  nodes: PlanNode[]
  walls: PlanWall[]
  openings: WallOpening[]
  pins: PlanPin[]
  tool: WallPlanTool
  /** Set when the pin tool should drop something on the next tap. */
  armedPin?: { kind: 'equipment' | 'reading'; label: string } | null
  selectedPinId?: string | null
  pinEditor?: React.ReactNode
  onDrawWall?: (segment: { x1: number; y1: number; x2: number; y2: number }) => void
  /** Typed length: move this wall's end node so it measures exactly this. */
  onSetWallLength?: (wallId: string, endNodeId: string, x: number, y: number) => void
  onMoveNode?: (nodeId: string, x: number, y: number) => void
  /** Drag a whole room: every corner of the loop moves together. */
  onMoveRoom?: (moves: Array<{ id: string; x: number; y: number }>) => void
  /** What the Door tool places, and how wide. */
  openingKind?: WallOpening['kind']
  openingWidthFt?: number
  selectedOpeningId?: string | null
  onPlaceDoor?: (wallId: string, offsetFt: number) => void
  onMoveOpening?: (openingId: string, wallId: string, offsetFt: number) => void
  onSelectOpening?: (openingId: string | null) => void
  onDeleteWall?: (wallId: string) => void
  onDeleteOpening?: (openingId: string) => void
  onDropPin?: (position: { xFt: number; yFt: number }) => void
  onPinClick?: (pin: PlanPin) => void
}

const PADDING_FT = 4

export function WallPlan({
  nodes,
  walls,
  openings,
  pins,
  tool,
  armedPin,
  selectedPinId,
  pinEditor,
  onDrawWall,
  onSetWallLength,
  onMoveNode,
  onMoveRoom,
  openingKind = 'doorway',
  openingWidthFt = 3,
  selectedOpeningId,
  onPlaceDoor,
  onMoveOpening,
  onSelectOpening,
  onDeleteWall,
  onDeleteOpening,
  onDropPin,
  onPinClick,
}: Props) {
  const [width, setWidth] = useState(0)
  const [draft, setDraft] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [nodeDrag, setNodeDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  const [editingWallId, setEditingWallId] = useState<string | null>(null)
  const [lengthDraft, setLengthDraft] = useState('')
  // Only the editing tools claim taps on a length label. Under the Wall tool a
  // label sitting mid-room would otherwise block the exact spot you want to
  // start a wall from — which is usually the middle of a room.
  const labelsInteractive = tool === 'resize' || tool === 'corner'

  const [openingDrag, setOpeningDrag] = useState<{
    id: string
    wallId: string
    offsetFt: number
  } | null>(null)

  const [roomDrag, setRoomDrag] = useState<{
    ids: string[]
    fromX: number
    fromY: number
    dx: number
    dy: number
  } | null>(null)

  const liveNodes = useMemo(() => {
    const withNode = nodes.map((n) =>
      nodeDrag?.id === n.id ? { ...n, x: nodeDrag.x, y: nodeDrag.y } : n,
    )
    return roomDrag ? offsetNodes(withNode, roomDrag.ids, roomDrag.dx, roomDrag.dy) : withNode
  }, [nodes, nodeDrag, roomDrag])
  const resolved = useMemo(() => resolveWalls(liveNodes, walls), [liveNodes, walls])

  const bounds = useMemo(() => {
    const xs = liveNodes.map((n) => n.x)
    const ys = liveNodes.map((n) => n.y)
    if (xs.length === 0) return { minX: 0, minY: 0, maxX: 30, maxY: 20 }
    return {
      minX: Math.min(...xs, 0),
      minY: Math.min(...ys, 0),
      maxX: Math.max(...xs, 20),
      maxY: Math.max(...ys, 15),
    }
  }, [liveNodes])

  const planWidthFt = bounds.maxX - bounds.minX + PADDING_FT * 2
  const planHeightFt = bounds.maxY - bounds.minY + PADDING_FT * 2
  const scale = width > 0 ? width / planWidthFt : 0
  const heightPx = scale > 0 ? Math.max(240, planHeightFt * scale) : 240

  /** Screen pixels -> plan feet, accounting for the padded origin. */
  const toPlan = (clientX: number, clientY: number, rect: DOMRect) => ({
    xFt: (clientX - rect.left) / (scale || 1) + bounds.minX - PADDING_FT,
    yFt: (clientY - rect.top) / (scale || 1) + bounds.minY - PADDING_FT,
  })

  const toScreen = (xFt: number, yFt: number) => ({
    left: (xFt - bounds.minX + PADDING_FT) * scale,
    top: (yFt - bounds.minY + PADDING_FT) * scale,
  })

  return (
    <div
      ref={(node) => {
        if (node && node.clientWidth !== width) setWidth(node.clientWidth)
      }}
      className={`border-border/60 relative touch-none overflow-hidden rounded-lg border bg-slate-50 select-none dark:bg-slate-900 ${
        tool === 'wall' || tool === 'door' || armedPin
          ? 'cursor-crosshair'
          : tool === 'resize'
            ? 'cursor-move'
            : ''
      }`}
      style={{ height: heightPx }}
      onPointerDown={(event) => {
        if (scale <= 0) return
        const rect = event.currentTarget.getBoundingClientRect()

        if (tool === 'resize' && onMoveRoom) {
          const { xFt, yFt } = toPlan(event.clientX, event.clientY, rect)
          const loop = loopAt(liveNodes, resolved, xFt, yFt)
          if (!loop) return
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // Capture is a nicety.
          }
          setRoomDrag({ ids: loop, fromX: xFt, fromY: yFt, dx: 0, dy: 0 })
          return
        }

        if (tool !== 'wall') return
        const { xFt, yFt } = toPlan(event.clientX, event.clientY, rect)
        const start = findNodeNear(liveNodes, snapToGrid(xFt), snapToGrid(yFt))
        const x1 = start ? start.x : snapToGrid(xFt)
        const y1 = start ? start.y : snapToGrid(yFt)
        // Capture the pointer, or the drag dies the moment it leaves this
        // element — which is most drags, especially on a phone.
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Capture is a nicety; the draft still works without it.
        }
        setDraft({ x1, y1, x2: x1, y2: y1 })
      }}
      onPointerMove={(event) => {
        if (roomDrag) {
          const rect = event.currentTarget.getBoundingClientRect()
          const { xFt, yFt } = toPlan(event.clientX, event.clientY, rect)
          setRoomDrag({
            ...roomDrag,
            dx: snapToGrid(xFt - roomDrag.fromX),
            dy: snapToGrid(yFt - roomDrag.fromY),
          })
          return
        }
        if (!draft || tool !== 'wall') return
        const rect = event.currentTarget.getBoundingClientRect()
        const { xFt, yFt } = toPlan(event.clientX, event.clientY, rect)
        const near = findNodeNear(liveNodes, snapToGrid(xFt), snapToGrid(yFt))
        setDraft({
          ...draft,
          x2: near ? near.x : snapToGrid(xFt),
          y2: near ? near.y : snapToGrid(yFt),
        })
      }}
      onPointerUp={(event) => {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          // Already released.
        }
        if (roomDrag) {
          if (roomDrag.dx !== 0 || roomDrag.dy !== 0) {
            const byId = new Map(nodes.map((n) => [n.id, n]))
            onMoveRoom?.(
              roomDrag.ids
                .map((id) => byId.get(id))
                .filter(Boolean)
                .map((node) => ({
                  id: node!.id,
                  x: Math.round((node!.x + roomDrag.dx) * 100) / 100,
                  y: Math.round((node!.y + roomDrag.dy) * 100) / 100,
                })),
            )
          }
          setRoomDrag(null)
          return
        }
        if (!draft) return
        const moved = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1)
        // Anything under a foot is a mis-tap, not a wall.
        if (moved >= 1) onDrawWall?.(draft)
        setDraft(null)
      }}
      onPointerCancel={() => {
        setDraft(null)
        setRoomDrag(null)
      }}
      onClick={(event) => {
        if (scale <= 0) return
        const rect = event.currentTarget.getBoundingClientRect()
        const { xFt, yFt } = toPlan(event.clientX, event.clientY, rect)

        if (tool === 'door' && onPlaceDoor) {
          const hit = wallNear(resolved, xFt, yFt)
          if (hit) {
            // Centre the opening on the tap rather than starting it there, so
            // it lands where it looked like it would.
            const centred = Math.max(
              0,
              Math.min(hit.wall.lengthFt - openingWidthFt, hit.offsetFt - openingWidthFt / 2),
            )
            onPlaceDoor(hit.wall.id, centred)
          } else {
            onSelectOpening?.(null)
          }
          return
        }
        if (tool === 'pin' && armedPin && onDropPin) {
          onDropPin({
            xFt: Math.round(xFt * 100) / 100,
            yFt: Math.round(yFt * 100) / 100,
          })
        }
      }}
    >
      {scale > 0 ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {/* One-foot grid, so measurements read at a glance. */}
          <defs>
            <pattern id="ft-grid" width={scale} height={scale} patternUnits="userSpaceOnUse">
              <path
                d={`M ${scale} 0 L 0 0 0 ${scale}`}
                fill="none"
                className="stroke-slate-300/50 dark:stroke-slate-700/50"
                strokeWidth={0.5}
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#ft-grid)" />

          {resolved.map((wall) => {
            const a = toScreen(wall.start.x, wall.start.y)
            const b = toScreen(wall.end.x, wall.end.y)
            return (
              <line
                key={wall.id}
                x1={a.left}
                y1={a.top}
                x2={b.left}
                y2={b.top}
                strokeWidth={wall.isPartialHeight ? 4 : 7}
                strokeLinecap="round"
                strokeDasharray={wall.isPartialHeight ? '10 5' : undefined}
                className="stroke-slate-700 dark:stroke-slate-300"
              />
            )
          })}

          {draft ? (
            <line
              x1={toScreen(draft.x1, draft.y1).left}
              y1={toScreen(draft.x1, draft.y1).top}
              x2={toScreen(draft.x2, draft.y2).left}
              y2={toScreen(draft.x2, draft.y2).top}
              strokeWidth={7}
              strokeLinecap="round"
              className="stroke-sky-500"
            />
          ) : null}
        </svg>
      ) : null}

      {/* Live length while a wall is being dragged out. */}
      {scale > 0 && draft ? (
        <span
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded bg-sky-600 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums"
          style={{
            left: toScreen((draft.x1 + draft.x2) / 2, (draft.y1 + draft.y2) / 2).left,
            top: toScreen((draft.x1 + draft.x2) / 2, (draft.y1 + draft.y2) / 2).top - 6,
          }}
        >
          {formatFeetInches(draftLengthFt(draft))}
        </span>
      ) : null}

      {/* Wall lengths — click one to type an exact figure. */}
      {scale > 0
        ? resolved.map((wall) => {
            const mid = toScreen(
              (wall.start.x + wall.end.x) / 2,
              (wall.start.y + wall.end.y) / 2,
            )
            if (editingWallId === wall.id) {
              return (
                <input
                  key={`len-${wall.id}`}
                  autoFocus
                  type="number"
                  step="any"
                  min={0.5}
                  aria-label="Wall length in feet"
                  className="border-input bg-background absolute z-20 w-16 -translate-x-1/2 -translate-y-1/2 rounded border px-1 py-0.5 text-center text-xs tabular-nums"
                  style={{ left: mid.left, top: mid.top }}
                  value={lengthDraft}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setLengthDraft(event.target.value)}
                  onBlur={() => setEditingWallId(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setEditingWallId(null)
                      return
                    }
                    if (event.key !== 'Enter') return
                    const point = endPointForLength(wall, Number(lengthDraft))
                    if (point) {
                      onSetWallLength?.(wall.id, wall.endNodeId, point.x, point.y)
                    }
                    setEditingWallId(null)
                  }}
                />
              )
            }

            return (
              <button
                key={`len-${wall.id}`}
                type="button"
                title={
                  tool === 'corner'
                    ? 'Tap to delete this wall'
                    : 'Tap to type an exact length'
                }
                aria-hidden={!labelsInteractive}
                aria-label={`Wall ${wall.lengthFt} feet`}
                className={`bg-background/90 text-muted-foreground absolute -translate-x-1/2 -translate-y-1/2 rounded px-1 text-[10px] tabular-nums ${
                  labelsInteractive
                    ? 'hover:text-foreground underline decoration-dotted'
                    : 'pointer-events-none opacity-70'
                }`}
                style={{ left: mid.left, top: mid.top }}
                tabIndex={labelsInteractive ? 0 : -1}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  if (!labelsInteractive) return
                  event.stopPropagation()
                  // Corner is the destructive tool; Resize edits the number.
                  if (tool === 'corner') {
                    onDeleteWall?.(wall.id)
                    return
                  }
                  setLengthDraft(String(wall.lengthFt))
                  setEditingWallId(wall.id)
                }}
              >
                {formatFeetInches(wall.lengthFt)}
              </button>
            )
          })
        : null}

      {/* Doors, always on their wall. */}
      {scale > 0
        ? openings.map((opening) => {
            const live =
              openingDrag?.id === opening.id
                ? { ...opening, wallId: openingDrag.wallId, offsetFt: openingDrag.offsetFt }
                : opening
            const wall = resolved.find((w) => w.id === live.wallId)
            if (!wall) return null
            const pos = openingPosition(wall, live)
            if (!pos) return null
            const screen = toScreen(pos.x, pos.y)
            const isWindow = opening.kind === 'window'
            const selected = selectedOpeningId === opening.id
            return (
              <button
                key={opening.id}
                type="button"
                title={`${opening.kind} · ${opening.widthFt}′ — drag to move, tap to select`}
                aria-label={`${opening.kind} on wall`}
                className={`absolute rounded-sm ${
                  isWindow ? 'h-1.5 bg-cyan-400' : 'h-2.5 bg-amber-500'
                } ${
                  selected ? 'ring-2 ring-slate-900 dark:ring-white' : ''
                } ${tool === 'door' ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none'}`}
                style={{
                  left: screen.left,
                  top: screen.top,
                  width: Math.max(6, opening.widthFt * scale),
                  transform: `translateY(-50%) rotate(${pos.angleDeg}deg)`,
                  transformOrigin: '0 50%',
                }}
                onPointerDown={(event) => {
                  if (tool !== 'door') return
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setOpeningDrag({
                    id: opening.id,
                    wallId: opening.wallId,
                    offsetFt: opening.offsetFt,
                  })
                }}
                onPointerMove={(event) => {
                  if (openingDrag?.id !== opening.id) return
                  const rect = event.currentTarget.parentElement?.getBoundingClientRect()
                  if (!rect) return
                  const { xFt, yFt } = toPlan(event.clientX, event.clientY, rect)
                  // Snap onto whichever wall is nearest, so a door can be moved
                  // from one wall to another, not just slid along its own.
                  const hit = wallNear(resolved, xFt, yFt, 3)
                  if (hit) {
                    setOpeningDrag({
                      id: opening.id,
                      wallId: hit.wall.id,
                      offsetFt: hit.offsetFt,
                    })
                  }
                }}
                onPointerUp={(event) => {
                  if (openingDrag?.id !== opening.id) return
                  event.currentTarget.releasePointerCapture(event.pointerId)
                  const moved =
                    openingDrag.wallId !== opening.wallId ||
                    Math.abs(openingDrag.offsetFt - opening.offsetFt) > 0.1
                  if (moved) {
                    onMoveOpening?.(opening.id, openingDrag.wallId, openingDrag.offsetFt)
                  } else {
                    onSelectOpening?.(selected ? null : opening.id)
                  }
                  setOpeningDrag(null)
                }}
              />
            )
          })
        : null}

      {/* Corner handles, only while the corner tool is active. */}
      {scale > 0 && tool === 'corner'
        ? liveNodes.map((node) => {
            const screen = toScreen(node.x, node.y)
            return (
              <button
                key={node.id}
                type="button"
                aria-label="Corner"
                className="absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white bg-slate-700 shadow active:cursor-grabbing dark:bg-slate-200"
                style={{ left: screen.left, top: screen.top }}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setNodeDrag({ id: node.id, x: node.x, y: node.y })
                }}
                onPointerMove={(event) => {
                  if (nodeDrag?.id !== node.id) return
                  const rect = event.currentTarget.parentElement?.getBoundingClientRect()
                  if (!rect) return
                  const { xFt, yFt } = toPlan(event.clientX, event.clientY, rect)
                  setNodeDrag({ id: node.id, x: snapToGrid(xFt), y: snapToGrid(yFt) })
                }}
                onPointerUp={(event) => {
                  if (nodeDrag?.id !== node.id) return
                  event.currentTarget.releasePointerCapture(event.pointerId)
                  onMoveNode?.(node.id, nodeDrag.x, nodeDrag.y)
                  setNodeDrag(null)
                }}
              />
            )
          })
        : null}

      {scale > 0 && pinEditor && selectedPinId ? (
        (() => {
          const pin = pins.find((p) => p.id === selectedPinId)
          if (!pin || pin.xFt == null || pin.yFt == null) return null
          const screen = toScreen(pin.xFt, pin.yFt)
          return (
            <div
              className="absolute z-20 w-64 max-w-[calc(100%-1rem)]"
              style={{
                left: Math.min(Math.max(8, screen.left + 16), Math.max(8, width - 264)),
                top: Math.max(8, screen.top - 8),
              }}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {pinEditor}
            </div>
          )
        })()
      ) : null}

      {scale > 0
        ? pins
            .filter((pin) => pin.xFt != null && pin.yFt != null && !pin.removed)
            .map((pin) => {
              const screen = toScreen(pin.xFt ?? 0, pin.yFt ?? 0)
              return (
                <button
                  key={pin.id}
                  type="button"
                  title={pin.label}
                  aria-label={pin.label}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onPinClick?.(pin)
                  }}
                  className={`absolute flex h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 px-1 text-[10px] font-bold text-white shadow ${
                    selectedPinId === pin.id
                      ? 'border-slate-900 ring-2 ring-slate-900/40'
                      : 'border-white'
                  } ${
                    pin.kind === 'equipment'
                      ? 'bg-sky-600'
                      : pin.atGoal
                        ? 'bg-emerald-600'
                        : 'bg-amber-600'
                  }`}
                  style={{ left: screen.left, top: screen.top }}
                >
                  {pin.kind === 'equipment' ? (pin.glyph ?? '◈') : (pin.value ?? '?')}
                </button>
              )
            })
        : null}

      {walls.length === 0 && !draft ? (
        <p className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm">
          {tool === 'wall'
            ? 'Drag anywhere here to draw your first wall.'
            : 'Switch to the Wall tool and drag to draw.'}
        </p>
      ) : null}
    </div>
  )
}
