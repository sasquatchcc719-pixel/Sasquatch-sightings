'use client'

import { useMemo, useRef, useState } from 'react'
import {
  layoutFloorPlan,
  pointToPlanFeet,
  roomAtPoint,
  type PlanRoom,
} from '@/lib/ops/restoration-floor-plan'

/**
 * The plan view of a water loss.
 *
 * Rooms are drawn from the dimensions already measured — nobody has to draw
 * anything. Tapping inside a room drops whatever tool is armed at that spot, so
 * an air mover or a reading point gets a real location, and the readings can be
 * seen where they were actually taken.
 */

export type PlanPin = {
  id: string
  kind: 'equipment' | 'reading'
  label: string
  areaId: string | null
  xFt: number | null
  yFt: number | null
  /** Latest reading value, shown on the pin so a stalled spot is obvious. */
  value?: number | null
  atGoal?: boolean
  removed?: boolean
}

type FloorPlanProps = {
  rooms: PlanRoom[]
  pins: PlanPin[]
  /** When set, a tap inside a room drops a pin instead of doing nothing. */
  armed?: { kind: 'equipment' | 'reading'; label: string } | null
  onDrop?: (position: { areaId: string; xFt: number; yFt: number }) => void
  onPinClick?: (pin: PlanPin) => void
}

export function FloorPlan({ rooms, pins, armed, onDrop, onPinClick }: FloorPlanProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  const layout = useMemo(() => layoutFloorPlan(rooms), [rooms])

  // Fit the plan to the container, so it works at phone width without pinching.
  const scale = width > 0 && layout.widthFt > 0 ? width / (layout.widthFt + 4) : 0
  const heightPx = scale > 0 ? (layout.heightFt + 4) * scale : 160

  if (rooms.length === 0) {
    return (
      <div className="border-border/60 text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
        Measure a room above and it will appear here.
      </div>
    )
  }

  return (
    <div
      ref={(node) => {
        containerRef.current = node
        if (node && node.clientWidth !== width) setWidth(node.clientWidth)
      }}
      className={`border-border/60 relative overflow-hidden rounded-lg border bg-slate-50 dark:bg-slate-900 ${
        armed ? 'cursor-crosshair ring-2 ring-sky-500' : ''
      }`}
      style={{ height: heightPx }}
      onClick={(event) => {
        if (!armed || !onDrop || scale <= 0) return
        const rect = event.currentTarget.getBoundingClientRect()
        const { xFt, yFt } = pointToPlanFeet(event.clientX, event.clientY, rect, scale)
        const room = roomAtPoint(layout, xFt, yFt)
        if (!room) return
        onDrop({ areaId: room.id, xFt, yFt })
      }}
      role={armed ? 'button' : undefined}
      aria-label={armed ? `Tap a room to place ${armed.label}` : 'Floor plan'}
    >
      {scale > 0
        ? layout.rooms.map((room) => (
            <div
              key={room.id}
              className="absolute rounded-sm border-2 border-slate-400 bg-white/70 dark:border-slate-600 dark:bg-slate-800/60"
              style={{
                left: room.x * scale,
                top: room.y * scale,
                width: room.lengthFt * scale,
                height: room.widthFt * scale,
              }}
            >
              <span className="text-muted-foreground absolute top-1 left-1 text-[10px] leading-tight font-medium">
                {room.name}
                <span className="block opacity-70">
                  {room.lengthFt}′ × {room.widthFt}′
                </span>
              </span>
            </div>
          ))
        : null}

      {scale > 0
        ? pins
            .filter((pin) => pin.xFt != null && pin.yFt != null && !pin.removed)
            .map((pin) => (
              <button
                key={pin.id}
                type="button"
                title={pin.label}
                aria-label={pin.label}
                onClick={(event) => {
                  event.stopPropagation()
                  onPinClick?.(pin)
                }}
                className={`absolute flex h-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white shadow ${
                  pin.kind === 'equipment'
                    ? 'w-6 bg-sky-600'
                    : pin.atGoal
                      ? 'min-w-6 bg-emerald-600 px-1'
                      : 'min-w-6 bg-amber-600 px-1'
                }`}
                style={{ left: (pin.xFt ?? 0) * scale, top: (pin.yFt ?? 0) * scale }}
              >
                {pin.kind === 'equipment' ? '◈' : (pin.value ?? '?')}
              </button>
            ))
        : null}
    </div>
  )
}
