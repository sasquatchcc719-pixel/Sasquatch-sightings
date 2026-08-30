'use client'

import { useMemo, useState, type ReactNode } from 'react'
import {
  boundsOf,
  layoutFloorPlan,
  nearestWall,
  pointToPlanFeet,
  roomAtPoint,
  snapPosition,
  wallSegment,
  type Opening,
  type PlanRoom,
  type Point,
} from '@/lib/ops/restoration-floor-plan'

/**
 * The plan view of a water loss.
 *
 * Rooms start auto-arranged from the dimensions already measured, then get
 * dragged into the shape of the actual house. Walls snap flush to a neighbour
 * so rooms join up instead of leaving slivers. Doorways are drawn on the wall
 * they belong to.
 *
 * Tapping inside a room with a tool armed drops equipment or a reading point at
 * that spot; tapping a pin selects it.
 */

export type PlanPin = {
  id: string
  kind: 'equipment' | 'reading'
  label: string
  areaId: string | null
  xFt: number | null
  yFt: number | null
  value?: number | null
  atGoal?: boolean
  removed?: boolean
}

type FloorPlanProps = {
  rooms: PlanRoom[]
  pins: PlanPin[]
  openings?: Opening[]
  armed?: { kind: 'equipment' | 'reading'; label: string } | null
  /**
   * move   — drag whole rooms into the shape of the house
   * shape  — drag corners and split walls, for diagonals and L-shapes
   * doorway— tap a wall to put a door on it
   */
  mode?: 'move' | 'shape' | 'doorway'
  onMoveCorner?: (areaId: string, index: number, x: number, y: number) => void
  onSplitWall?: (areaId: string, wallIndex: number) => void
  onPlaceDoorway?: (areaId: string, wallIndex: number, offsetFt: number) => void
  onOpeningClick?: (opening: Opening) => void
  selectedPinId?: string | null
  /**
   * Editor for the selected pin, floated next to it on the plan. Editing has to
   * happen ON the map: standing in a flooded house you want to tap the point you
   * are holding the meter against and type the number, not hunt down a list.
   */
  pinEditor?: ReactNode
  onDrop?: (position: { areaId: string; xFt: number; yFt: number }) => void
  onPinClick?: (pin: PlanPin) => void
  onMoveRoom?: (areaId: string, x: number, y: number) => void
}

export function FloorPlan({
  rooms,
  pins,
  openings = [],
  armed,
  mode = 'move',
  selectedPinId,
  pinEditor,
  onDrop,
  onPinClick,
  onMoveRoom,
  onMoveCorner,
  onSplitWall,
  onPlaceDoorway,
  onOpeningClick,
}: FloorPlanProps) {
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState<{
    id: string
    grabX: number
    grabY: number
    x: number
    y: number
  } | null>(null)
  const [cornerDrag, setCornerDrag] = useState<{
    areaId: string
    index: number
    point: Point
  } | null>(null)

  const layout = useMemo(() => layoutFloorPlan(rooms), [rooms])

  // Leave room on the right and below so a dragged room is never clipped.
  const scale = width > 0 && layout.widthFt > 0 ? width / (layout.widthFt + 6) : 0
  const heightPx =
    scale > 0
      ? Math.max(220, (layout.heightFt + 6) * scale + (pinEditor ? 70 : 0))
      : 220

  if (rooms.length === 0) {
    return (
      <div className="border-border/60 text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
        Measure a room above and it will appear here.
      </div>
    )
  }

  const positionOf = (roomId: string, fallbackX: number, fallbackY: number) =>
    dragging?.id === roomId ? { x: dragging.x, y: dragging.y } : { x: fallbackX, y: fallbackY }

  const selectedPin = pins.find((pin) => pin.id === selectedPinId) ?? null
  const selectedPinRoom = selectedPin
    ? (layout.rooms.find((room) => room.id === selectedPin.areaId) ?? null)
    : null
  const selectedPinBase = selectedPinRoom
    ? positionOf(selectedPinRoom.id, selectedPinRoom.x, selectedPinRoom.y)
    : { x: 0, y: 0 }

  return (
    <div
      ref={(node) => {
        if (node && node.clientWidth !== width) setWidth(node.clientWidth)
      }}
      className={`border-border/60 relative touch-none overflow-hidden rounded-lg border bg-slate-50 select-none dark:bg-slate-900 ${
        armed || mode === 'doorway' ? 'cursor-crosshair ring-2 ring-sky-500' : ''
      }`}
      style={{ height: heightPx }}
      onClick={(event) => {
        if (scale <= 0) return
        const rect = event.currentTarget.getBoundingClientRect()
        const { xFt, yFt } = pointToPlanFeet(event.clientX, event.clientY, rect, scale)

        if (armed && onDrop) {
          const room = roomAtPoint(layout, xFt, yFt)
          if (!room) return
          onDrop({ areaId: room.id, xFt: xFt - room.x, yFt: yFt - room.y })
          return
        }

        if (mode === 'doorway' && onPlaceDoorway) {
          // Doors go on walls, so find the nearest wall rather than the room
          // under the tap — the tap will usually land just off the edge.
          for (const room of layout.rooms) {
            const hit = nearestWall(room, xFt, yFt)
            if (hit) {
              onPlaceDoorway(room.id, hit.wallIndex, hit.offsetFt)
              return
            }
          }
        }
      }}
    >
      {scale > 0
        ? layout.rooms.map((room) => {
            const b = boundsOf(room.points)
            const w = b.maxX - b.minX
            const h = b.maxY - b.minY
            const pos = positionOf(room.id, room.x, room.y)
            const isRect = room.points.length === 4
            return (
              <div
                key={room.id}
                className={`absolute ${armed ? '' : 'cursor-move'} ${
                  dragging?.id === room.id ? 'z-10 opacity-80' : ''
                }`}
                style={{ left: pos.x * scale, top: pos.y * scale, width: w * scale, height: h * scale }}
                onPointerDown={(event) => {
                  if (armed || mode !== 'move' || !onMoveRoom) return
                  event.stopPropagation()
                  const rect = event.currentTarget.parentElement?.getBoundingClientRect()
                  if (!rect) return
                  const { xFt, yFt } = pointToPlanFeet(event.clientX, event.clientY, rect, scale)
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setDragging({
                    id: room.id,
                    grabX: xFt - room.x,
                    grabY: yFt - room.y,
                    x: room.x,
                    y: room.y,
                  })
                }}
                onPointerMove={(event) => {
                  if (dragging?.id !== room.id) return
                  const rect = event.currentTarget.parentElement?.getBoundingClientRect()
                  if (!rect) return
                  const { xFt, yFt } = pointToPlanFeet(event.clientX, event.clientY, rect, scale)
                  const next = snapPosition(
                    {
                      x: Math.max(0, xFt - dragging.grabX),
                      y: Math.max(0, yFt - dragging.grabY),
                      points: room.points,
                    },
                    layout.rooms.filter((r) => r.id !== room.id),
                  )
                  setDragging({ ...dragging, x: next.x, y: next.y })
                }}
                onPointerUp={(event) => {
                  if (dragging?.id !== room.id) return
                  event.currentTarget.releasePointerCapture(event.pointerId)
                  onMoveRoom?.(room.id, dragging.x, dragging.y)
                  setDragging(null)
                }}
              >
                {isRect ? (
                  <div className="h-full w-full rounded-sm border-2 border-slate-400 bg-white/70 dark:border-slate-600 dark:bg-slate-800/60" />
                ) : (
                  <svg
                    viewBox={`0 0 ${w} ${h}`}
                    className="h-full w-full"
                    preserveAspectRatio="none"
                  >
                    <polygon
                      points={room.points.map((p) => `${p.x - b.minX},${p.y - b.minY}`).join(' ')}
                      className="fill-white/70 stroke-slate-400 dark:fill-slate-800/60 dark:stroke-slate-600"
                      strokeWidth={0.4}
                    />
                  </svg>
                )}
                <span className="text-muted-foreground pointer-events-none absolute top-1 left-1 text-[10px] leading-tight font-medium">
                  {room.name}
                  <span className="block opacity-70">
                    {Math.round(w)}′ × {Math.round(h)}′
                  </span>
                </span>
              </div>
            )
          })
        : null}

      {scale > 0 && mode === 'shape'
        ? layout.rooms.flatMap((room) => {
            const pos = positionOf(room.id, room.x, room.y)
            const handles = room.points.map((corner, index) => {
              const live =
                cornerDrag && cornerDrag.areaId === room.id && cornerDrag.index === index
                  ? cornerDrag.point
                  : corner
              return (
                <button
                  key={`c-${room.id}-${index}`}
                  type="button"
                  aria-label={`Corner ${index + 1} of ${room.name}`}
                  className="absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-sm border-2 border-white bg-slate-700 shadow active:cursor-grabbing dark:bg-slate-200"
                  style={{ left: (pos.x + live.x) * scale, top: (pos.y + live.y) * scale }}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    event.currentTarget.setPointerCapture(event.pointerId)
                    setCornerDrag({ areaId: room.id, index, point: live })
                  }}
                  onPointerMove={(event) => {
                    if (cornerDrag?.areaId !== room.id || cornerDrag.index !== index) return
                    const rect = event.currentTarget.parentElement?.getBoundingClientRect()
                    if (!rect) return
                    const { xFt, yFt } = pointToPlanFeet(event.clientX, event.clientY, rect, scale)
                    setCornerDrag({
                      areaId: room.id,
                      index,
                      // Half-foot grid: fine enough for a real wall, coarse
                      // enough that a corner does not land on 7.83 feet.
                      point: {
                        x: Math.round((xFt - pos.x) * 2) / 2,
                        y: Math.round((yFt - pos.y) * 2) / 2,
                      },
                    })
                  }}
                  onPointerUp={(event) => {
                    if (cornerDrag?.areaId !== room.id || cornerDrag.index !== index) return
                    event.currentTarget.releasePointerCapture(event.pointerId)
                    onMoveCorner?.(room.id, index, cornerDrag.point.x, cornerDrag.point.y)
                    setCornerDrag(null)
                  }}
                />
              )
            })

            const splits = room.points.map((corner, index) => {
              const next = room.points[(index + 1) % room.points.length]
              const midX = pos.x + (corner.x + next.x) / 2
              const midY = pos.y + (corner.y + next.y) / 2
              return (
                <button
                  key={`s-${room.id}-${index}`}
                  type="button"
                  title="Add a corner here"
                  aria-label={`Add a corner to wall ${index + 1} of ${room.name}`}
                  className="absolute z-10 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-sky-600 text-[9px] font-bold text-white shadow"
                  style={{ left: midX * scale, top: midY * scale }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onSplitWall?.(room.id, index)
                  }}
                >
                  +
                </button>
              )
            })

            return [...handles, ...splits]
          })
        : null}

      {/* Doorways, drawn as a gap marker on the wall they belong to. */}
      {scale > 0
        ? openings.map((opening) => {
            const room = layout.rooms.find((r) => r.id === opening.areaId)
            if (!room) return null
            const wall = wallSegment(room, opening.wallIndex)
            if (!wall) return null
            const t = wall.lengthFt > 0 ? opening.offsetFt / wall.lengthFt : 0
            const x = wall.from.x + (wall.to.x - wall.from.x) * t
            const y = wall.from.y + (wall.to.y - wall.from.y) * t
            const angle =
              (Math.atan2(wall.to.y - wall.from.y, wall.to.x - wall.from.x) * 180) / Math.PI
            return (
              <button
                key={opening.id}
                type="button"
                title={`${opening.kind} · ${opening.widthFt}′`}
                aria-label={`${opening.kind} on ${room.name}`}
                className="absolute h-1.5 rounded bg-amber-500 hover:bg-amber-400"
                style={{
                  left: x * scale,
                  top: y * scale,
                  width: opening.widthFt * scale,
                  transform: `rotate(${angle}deg)`,
                  transformOrigin: '0 50%',
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onOpeningClick?.(opening)
                }}
              />
            )
          })
        : null}

      {scale > 0 && pinEditor && selectedPin ? (
        <div
          className="absolute z-20 w-64 max-w-[calc(100%-1rem)]"
          style={{
            // Nudged away from the edges so the editor never opens off-screen.
            left: Math.min(
              Math.max(8, (selectedPinBase.x + (selectedPin.xFt ?? 0)) * scale + 16),
              Math.max(8, width - 264),
            ),
            top: Math.max(8, (selectedPinBase.y + (selectedPin.yFt ?? 0)) * scale - 8),
          }}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {pinEditor}
        </div>
      ) : null}

      {scale > 0
        ? pins
            .filter((pin) => pin.xFt != null && pin.yFt != null && !pin.removed)
            .map((pin) => {
              const room = layout.rooms.find((r) => r.id === pin.areaId)
              const base = room
                ? positionOf(room.id, room.x, room.y)
                : { x: 0, y: 0 }
              const left = (base.x + (pin.xFt ?? 0)) * scale
              const top = (base.y + (pin.yFt ?? 0)) * scale
              const selected = selectedPinId === pin.id
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
                    selected ? 'border-slate-900 ring-2 ring-slate-900/40' : 'border-white'
                  } ${
                    pin.kind === 'equipment'
                      ? 'w-6 bg-sky-600'
                      : pin.atGoal
                        ? 'min-w-6 bg-emerald-600 px-1'
                        : 'min-w-6 bg-amber-600 px-1'
                  }`}
                  style={{ left, top }}
                >
                  {pin.kind === 'equipment' ? '◈' : (pin.value ?? '?')}
                </button>
              )
            })
        : null}
    </div>
  )
}
