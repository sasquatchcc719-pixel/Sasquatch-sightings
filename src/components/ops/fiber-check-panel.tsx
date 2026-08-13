'use client'

/**
 * Self-contained fiber check panel for the admin invoice screen.
 *
 * The admin screen keeps its own line-item state and has no fiber data, so
 * this component fetches its own and reports gate status upward. Both screens
 * share the gate rules in `@/lib/fiber/gate` so they cannot drift apart.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { FiberCheckModal } from '@/components/tech/fiber-check-modal'
import { unitLabel, unitsForLine } from '@/lib/fiber/gate'
import type { TechAppointment, TechFiberCheck } from '@/lib/tech/appointments'

type GateResponse = {
  lines: TechAppointment['lineItems']
  checks: TechFiberCheck[]
  allowed: boolean
  blocked: string[]
}

export function FiberCheckPanel({
  appointmentId,
  onGateChange,
  onInvoiceChanged,
  refreshKey = 0,
}: {
  appointmentId: string
  onGateChange?: (allowed: boolean) => void
  /**
   * Called when a check changes the invoice (an item was removed), so the
   * screen around this panel can reload its line items and total. Without it
   * the price box keeps the old amount and saving would write it back.
   */
  onInvoiceChanged?: () => void
  /**
   * Bump to force a reload. The admin invoice screen adds and removes line
   * items after this panel has mounted, and router.refresh() does not re-run a
   * client component's fetch — so without this a rug added to a saved invoice
   * never appeared here.
   */
  refreshKey?: number
}) {
  const [data, setData] = useState<GateResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [target, setTarget] = useState<{
    lineId: string
    unitIndex: number
  } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/tech/appointments/${appointmentId}/fiber-check`,
        { cache: 'no-store' },
      )
      if (!res.ok) return
      const json = (await res.json()) as GateResponse
      setData(json)
      onGateChange?.(json.allowed)
    } finally {
      setLoading(false)
    }
  }, [appointmentId, onGateChange])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking fibers…
      </div>
    )
  }
  if (!data) return null

  const gated = data.lines.filter(
    (line) => line.requiresFiberCheck && !line.excludedAt,
  )
  const excluded = data.lines.filter((line) => line.excludedAt)
  if (gated.length === 0 && excluded.length === 0) return null

  const checkFor = (lineId: string, unit: number) =>
    data.checks.find(
      (c) => c.appointmentLineItemId === lineId && (c.unitIndex ?? 1) === unit,
    ) ?? null

  return (
    <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-50/60 p-3 dark:bg-amber-950/20">
      <div className="mb-2 flex items-center gap-2">
        <ShieldQuestion className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-semibold">Fiber checks</h3>
      </div>
      <p className="text-muted-foreground mb-3 text-xs">
        Rugs and upholstery must be identified before the customer signs. Each
        piece is checked separately — three rugs on one line can be three
        different fibers.
      </p>

      <div className="space-y-2">
        {gated.map((line) => {
          const units = unitsForLine(line)
          return Array.from({ length: units }, (_, i) => i + 1).map((unit) => {
            const check = checkFor(line.id, unit)
            const label = unitLabel(line.name, unit, units)
            const tone = !check
              ? 'border-amber-500/50 bg-amber-100/60 dark:bg-amber-950/40'
              : check.verdict === 'do_not_wet_clean'
                ? 'border-red-500/50 bg-red-100/60 dark:bg-red-950/40'
                : check.verdict === 'low_moisture'
                  ? 'border-amber-500/50 bg-amber-100/60 dark:bg-amber-950/40'
                  : 'border-emerald-500/40 bg-emerald-100/60 dark:bg-emerald-950/30'
            return (
              <button
                key={`${line.id}-${unit}`}
                onClick={() => setTarget({ lineId: line.id, unitIndex: unit })}
                className={`w-full rounded-lg border p-2 text-left ${tone}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{label}</span>
                  {!check ? (
                    <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
                      IDENTIFY →
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-bold">
                      {check.verdict === 'go' ? (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      ) : (
                        <ShieldAlert className="h-3.5 w-3.5" />
                      )}
                      {check.verdict === 'do_not_wet_clean'
                        ? 'DO NOT WET CLEAN'
                        : check.verdict === 'low_moisture'
                          ? 'LOW MOISTURE'
                          : 'SAFE'}
                    </span>
                  )}
                </div>
                {check?.fiber ? (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {check.fiber}
                  </p>
                ) : null}
              </button>
            )
          })
        })}

        {excluded.map((line) => (
          <div
            key={line.id}
            className="rounded-lg border border-red-500/40 bg-red-100/60 p-2 dark:bg-red-950/30"
          >
            <p className="text-xs font-bold uppercase text-red-700 dark:text-red-300">
              Not performed — {line.name}
            </p>
            <p className="text-muted-foreground text-xs">
              {line.excludedReason}
            </p>
          </div>
        ))}
      </div>

      {target ? (
        <FiberCheckModal
          isOpen
          onClose={() => {
            setTarget(null)
            void load()
          }}
          onInvoiceChanged={onInvoiceChanged}
          appointmentId={appointmentId}
          lineItemId={target.lineId}
          unitIndex={target.unitIndex}
          lineItemName={(() => {
            const line = data.lines.find((l) => l.id === target.lineId)
            if (!line) return 'Item'
            return unitLabel(line.name, target.unitIndex, unitsForLine(line))
          })()}
          existingCheck={checkFor(target.lineId, target.unitIndex)}
          onAppointmentUpdate={() => void load()}
        />
      ) : null}
    </div>
  )
}
