'use client'

import { useMemo, useState } from 'react'
import {
  findNodeNear,
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
  xFt: number | null
  yFt: number | null
  value?: number | null
  atGoal?: boolean
  removed?: boolean
}

export type WallPlanTool = 'wall' | 'corner' | 'door' | 'pin'

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
  onMoveNode?: (nodeId: string, x: number, y: number) => void
  onPlaceDoor?: (wallId: string, offsetFt: number) => void
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
  onMoveNode,
  onPlaceDoor,
  onDeleteWall,
  onDeleteOpening,
  onDropPin,
  onPinClick,
}: Props) {
  const [width, setWidth] = useState(0)
  const [draft, setDraft] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [nodeDrag, setNodeDrag] = useState<{ id: string; x: number; y: number } | null>(null)

  const liveNodes = useMemo(
    () => nodes.map((n) => (nodeDrag?.id === n.id ? { ...n, x: nodeDrag.x, y: nodeDrag.y } : n)),
    [nodes, nodeDrag],
  )
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
        tool === 'wall' || tool === 'door' || armedPin ? 'cursor-crosshair' : ''
      }`}
      style={{ height: heightPx }}
      onPointerDown={(event) => {
        if (tool !== 'wall' || scale <= 0) return
        const rect = event.currentTarget.getBoundingClientRect()
        const { xFt, yFt } = toPlan(event.clientX, event.clientY, rect)
        const start = findNodeNear(liveNodes, snapToGrid(xFt), snapToGrid(yFt))
        const x1 = start ? start.x : snapToGrid(xFt)
        const y1 = start ? start.y : snapToGrid(yFt)
        setDraft({ x1, y1, x2: x1, y2: y1 })
      }}
      onPointerMove={(event) => {
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
      onPointerUp={() => {
        if (!draft) return
        const moved = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1)
        if (moved >= 1) onDrawWall?.(draft)
        setDraft(null)
      }}
      onClick={(event) => {
        if (scale <= 0) return
        const rect = event.currentTarget.getBoundingClientRect()
        const { xFt, yFt } = toPlan(event.clientX, event.clientY, rect)

        if (tool === 'door' && onPlaceDoor) {
          const hit = wallNear(resolved, xFt, yFt)
          if (hit) onPlaceDoor(hit.wall.id, hit.offsetFt)
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

      {/* Wall lengths and a delete affordance. */}
      {scale > 0
        ? resolved.map((wall) => {
            const mid = toScreen(
              (wall.start.x + wall.end.x) / 2,
              (wall.start.y + wall.end.y) / 2,
            )
            return (
              <button
                key={`len-${wall.id}`}
                type="button"
                title={
                  wall.isPartialHeight ? 'Partial-height wall — tap to remove' : 'Tap to remove'
                }
                aria-label={`Wall ${wall.lengthFt} feet`}
                className="bg-background/90 text-muted-foreground absolute -translate-x-1/2 -translate-y-1/2 rounded px-1 text-[10px] tabular-nums hover:text-red-600"
                style={{ left: mid.left, top: mid.top }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  if (tool === 'corner') onDeleteWall?.(wall.id)
                }}
              >
                {wall.lengthFt}′
              </button>
            )
          })
        : null}

      {/* Doors, always on their wall. */}
      {scale > 0
        ? openings.map((opening) => {
            const wall = resolved.find((w) => w.id === opening.wallId)
            if (!wall) return null
            const pos = openingPosition(wall, opening)
            if (!pos) return null
            const screen = toScreen(pos.x, pos.y)
            return (
              <button
                key={opening.id}
                type="button"
                title={`${opening.kind} · ${opening.widthFt}′ — tap to remove`}
                aria-label={`${opening.kind} on wall`}
                className="absolute h-2 rounded-sm bg-amber-500 hover:bg-red-500"
                style={{
                  left: screen.left,
                  top: screen.top,
                  width: opening.widthFt * scale,
                  transform: `translateY(-50%) rotate(${pos.angleDeg}deg)`,
                  transformOrigin: '0 50%',
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onDeleteOpening?.(opening.id)
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
                  className={`absolute flex h-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[10px] font-bold text-white shadow ${
                    selectedPinId === pin.id ? 'border-slate-900 ring-2 ring-slate-900/40' : 'border-white'
                  } ${
                    pin.kind === 'equipment'
                      ? 'w-6 bg-sky-600'
                      : pin.atGoal
                        ? 'min-w-6 bg-emerald-600 px-1'
                        : 'min-w-6 bg-amber-600 px-1'
                  }`}
                  style={{ left: screen.left, top: screen.top }}
                >
                  {pin.kind === 'equipment' ? '◈' : (pin.value ?? '?')}
                </button>
              )
            })
        : null}

      {walls.length === 0 ? (
        <p className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center text-sm">
          Pick the Wall tool and drag to draw.
        </p>
      ) : null}
    </div>
  )
}
