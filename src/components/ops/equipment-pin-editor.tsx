'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  grainsPerPound,
  dehumidifierVerdict,
} from '@/lib/ops/restoration-psychrometry'

const ACTION_BUTTON = 'bg-sky-600 text-white hover:bg-sky-500'

export type PlacedEquipment = {
  id: string
  catalog_code: string
  placed_at: string
  removed_at: string | null
}

export type PlacementReading = {
  id: string
  role: string | null
  equipment_placement_id: string | null
  temp_f: number | null
  rh_pct: number | null
  taken_at: string
}

/** Dehumidifiers are the only equipment with air going in and coming out. */
export function isDehumidifier(catalogCode: string): boolean {
  return catalogCode.startsWith('DHM')
}

/**
 * What a piece of equipment on the plan can tell you, and be told.
 *
 * Tapping the dehu is where its readings belong — Charles is standing in front
 * of the machine with the meter, and asking him to remember which of three
 * units he just read while he walks to a form elsewhere on the page is how
 * readings end up attached to the wrong one, or not entered at all.
 *
 * Every other piece of equipment gets the one thing worth doing at its pin:
 * pulling it, on the day it actually came out.
 */
export function EquipmentPinEditor({
  equipment,
  label,
  readings,
  busy,
  onLogPair,
  onPull,
  onClose,
}: {
  equipment: PlacedEquipment
  label: string
  readings: PlacementReading[]
  busy: boolean
  onLogPair: (pair: {
    intake: { temp_f: number; rh_pct: number }
    outlet: { temp_f: number; rh_pct: number }
  }) => void | Promise<unknown>
  onPull: () => void | Promise<unknown>
  onClose: () => void
}) {
  const [inTemp, setInTemp] = useState('')
  const [inRh, setInRh] = useState('')
  const [outTemp, setOutTemp] = useState('')
  const [outRh, setOutRh] = useState('')

  const dehu = isDehumidifier(equipment.catalog_code)

  const intakeGpp =
    Number(inTemp) && Number(inRh) ? grainsPerPound(Number(inTemp), Number(inRh)) : null
  const outletGpp =
    Number(outTemp) && Number(outRh) ? grainsPerPound(Number(outTemp), Number(outRh)) : null
  const depression =
    intakeGpp != null && outletGpp != null
      ? Math.round((intakeGpp - outletGpp) * 10) / 10
      : null

  const complete =
    Number(inTemp) > 0 && inRh !== '' && Number(outTemp) > 0 && outRh !== ''

  // The last pair logged against THIS unit, so two dehus never get confused.
  const mine = readings
    .filter((r) => r.equipment_placement_id === equipment.id)
    .sort((a, b) => new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime())
  const lastIntake = mine.find((r) => r.role === 'dehu_intake')
  const lastOutlet = mine.find((r) => r.role === 'dehu_outlet')

  const lastVerdict =
    lastIntake && lastOutlet
      ? dehumidifierVerdict(
          {
            role: 'dehu_intake',
            tempF: lastIntake.temp_f == null ? null : Number(lastIntake.temp_f),
            rhPct: lastIntake.rh_pct == null ? null : Number(lastIntake.rh_pct),
            takenAt: lastIntake.taken_at,
          },
          {
            role: 'dehu_outlet',
            tempF: lastOutlet.temp_f == null ? null : Number(lastOutlet.temp_f),
            rhPct: lastOutlet.rh_pct == null ? null : Number(lastOutlet.rh_pct),
            takenAt: lastOutlet.taken_at,
          },
        )
      : null

  return (
    <Card className="border-sky-400/60 bg-card w-64 p-3 shadow-lg dark:border-sky-500/50">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-medium">{label}</span>
        <button type="button" aria-label="Close" onClick={onClose}>
          <X className="text-muted-foreground h-4 w-4" />
        </button>
      </div>

      {dehu ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground w-12 text-xs">In</span>
            <Input
              className="h-9 flex-1 text-right"
              type="number"
              inputMode="decimal"
              placeholder="°F"
              aria-label="Intake temperature"
              value={inTemp}
              onChange={(e) => setInTemp(e.target.value)}
            />
            <Input
              className="h-9 flex-1 text-right"
              type="number"
              inputMode="decimal"
              placeholder="RH %"
              aria-label="Intake relative humidity"
              value={inRh}
              onChange={(e) => setInRh(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground w-12 text-xs">Out</span>
            <Input
              className="h-9 flex-1 text-right"
              type="number"
              inputMode="decimal"
              placeholder="°F"
              aria-label="Outlet temperature"
              value={outTemp}
              onChange={(e) => setOutTemp(e.target.value)}
            />
            <Input
              className="h-9 flex-1 text-right"
              type="number"
              inputMode="decimal"
              placeholder="RH %"
              aria-label="Outlet relative humidity"
              value={outRh}
              onChange={(e) => setOutRh(e.target.value)}
            />
          </div>

          {depression != null ? (
            <p className="text-muted-foreground text-xs tabular-nums">
              {intakeGpp} → {outletGpp} GPP · pulling {depression}
            </p>
          ) : null}

          <Button
            size="sm"
            className={ACTION_BUTTON}
            disabled={busy || !complete}
            onClick={async () => {
              await onLogPair({
                intake: { temp_f: Number(inTemp), rh_pct: Number(inRh) },
                outlet: { temp_f: Number(outTemp), rh_pct: Number(outRh) },
              })
              setInTemp('')
              setInRh('')
              setOutTemp('')
              setOutRh('')
              onClose()
            }}
          >
            Save readings
          </Button>

          {lastVerdict ? (
            <p className="text-muted-foreground border-t pt-2 text-xs">
              Last: {lastVerdict.headline}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          Running since {new Date(equipment.placed_at).toLocaleDateString()}.
        </p>
      )}

      <Button
        size="sm"
        variant="ghost"
        className="text-destructive mt-2 w-full text-xs"
        disabled={busy}
        onClick={async () => {
          await onPull()
          onClose()
        }}
      >
        Pull this one
      </Button>
    </Card>
  )
}
