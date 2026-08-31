'use client'

import { useMemo, useState } from 'react'
import { Loader2, Wind } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AIR_ROLES,
  grainsPerPound,
  dewPointF,
  dehumidifierVerdict,
  chamberVerdict,
  trendVerdict,
  type AirRole,
  type Verdict,
} from '@/lib/ops/restoration-psychrometry'

export type AirReading = {
  id: string
  role: AirRole | null
  location: string
  temp_f: number | null
  rh_pct: number | null
  taken_at: string
}

const STATUS_CLASS: Record<Verdict['status'], string> = {
  good: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  watch: 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300',
  problem: 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300',
  unknown: 'border-border/60 text-muted-foreground',
}

/**
 * Atmospheric readings, and what they mean.
 *
 * Moisture meters say the material is wet. These say whether the equipment is
 * doing anything about it — which is the half that goes missing when a job
 * stalls for four days and nobody can say why.
 */
export function AirReadingsCard({
  readings,
  busy,
  onLog,
}: {
  readings: AirReading[]
  busy: boolean
  onLog: (reading: {
    role: AirRole
    location: string
    temp_f: number
    rh_pct: number
  }) => void | Promise<unknown>
}) {
  const [role, setRole] = useState<AirRole>('affected')
  const [location, setLocation] = useState('')
  const [tempF, setTempF] = useState('')
  const [rhPct, setRhPct] = useState('')

  const previewGpp =
    Number(tempF) && Number(rhPct) ? grainsPerPound(Number(tempF), Number(rhPct)) : null
  const previewDew =
    Number(tempF) && Number(rhPct) ? dewPointF(Number(tempF), Number(rhPct)) : null

  const latestByRole = useMemo(() => {
    const map = new Map<string, AirReading>()
    for (const reading of [...readings].sort(
      (a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime(),
    )) {
      if (reading.role) map.set(reading.role, reading)
    }
    return map
  }, [readings])

  const toReading = (r: AirReading | undefined) => ({
    role: r?.role ?? null,
    tempF: r?.temp_f == null ? null : Number(r.temp_f),
    rhPct: r?.rh_pct == null ? null : Number(r.rh_pct),
    takenAt: r?.taken_at ?? '',
  })

  const verdicts: Verdict[] = [
    dehumidifierVerdict(
      toReading(latestByRole.get('dehu_intake')),
      toReading(latestByRole.get('dehu_outlet')),
    ),
    chamberVerdict(
      toReading(latestByRole.get('affected')),
      toReading(latestByRole.get('outside') ?? latestByRole.get('unaffected')),
    ),
    trendVerdict(
      readings.map((r) => ({
        role: r.role,
        tempF: r.temp_f == null ? null : Number(r.temp_f),
        rhPct: r.rh_pct == null ? null : Number(r.rh_pct),
        takenAt: r.taken_at,
      })),
    ),
  ]

  const canLog = Number(tempF) > 0 && rhPct !== '' && Number(rhPct) >= 0 && Number(rhPct) <= 100

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="air-role">Where</Label>
          <select
            id="air-role"
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as AirRole)}
          >
            {AIR_ROLES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="air-temp">Temp °F</Label>
          <Input
            id="air-temp"
            className="h-9 w-20 text-right"
            type="number"
            step="any"
            inputMode="decimal"
            value={tempF}
            onChange={(e) => setTempF(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="air-rh">RH %</Label>
          <Input
            id="air-rh"
            className="h-9 w-20 text-right"
            type="number"
            step="any"
            inputMode="decimal"
            value={rhPct}
            onChange={(e) => setRhPct(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="air-location">Label</Label>
          <Input
            id="air-location"
            className="h-9 w-36"
            placeholder={AIR_ROLES.find((r) => r.value === role)?.hint ?? ''}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
        <Button
          className="h-9 bg-sky-600 text-white hover:bg-sky-500"
          disabled={busy || !canLog}
          onClick={async () => {
            await onLog({
              role,
              location: location.trim(),
              temp_f: Number(tempF),
              rh_pct: Number(rhPct),
            })
            setTempF('')
            setRhPct('')
            setLocation('')
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Log'}
        </Button>
      </div>

      {/* The number the meter does not show you, before you commit the reading. */}
      {previewGpp != null ? (
        <p className="text-muted-foreground text-xs tabular-nums">
          {previewGpp} GPP · dew point {previewDew}°F
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {verdicts.map((verdict, index) => (
          <div
            key={index}
            className={`rounded-md border px-3 py-2 text-xs ${STATUS_CLASS[verdict.status]}`}
          >
            <span className="font-medium">{verdict.headline}</span>
            <span className="block opacity-80">{verdict.detail}</span>
          </div>
        ))}
      </div>

      {readings.length > 0 ? (
        <div className="border-border/60 max-h-56 overflow-y-auto rounded-md border text-xs">
          {[...readings]
            .sort((a, b) => new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime())
            .map((reading) => {
              const gpp =
                reading.temp_f != null && reading.rh_pct != null
                  ? grainsPerPound(Number(reading.temp_f), Number(reading.rh_pct))
                  : null
              return (
                <div
                  key={reading.id}
                  className="border-border/60 flex items-center gap-2 border-t px-3 py-1.5 first:border-t-0"
                >
                  <Wind className="text-muted-foreground h-3 w-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {AIR_ROLES.find((r) => r.value === reading.role)?.label ?? reading.location}
                    {reading.location &&
                    reading.location !== reading.role &&
                    reading.location !== ''
                      ? ` · ${reading.location}`
                      : ''}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {reading.temp_f}°F / {reading.rh_pct}%
                  </span>
                  <span className="w-16 text-right tabular-nums">
                    {gpp != null ? `${gpp} GPP` : ''}
                  </span>
                </div>
              )
            })}
        </div>
      ) : null}
    </div>
  )
}
