'use client'

import { useMemo, useState } from 'react'
import { Loader2, Wind, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AIR_ROLES,
  grainsPerPound,
  dewPointF,
  dehumidifierVerdict,
  dryGoalVerdict,
  ventilationNote,
  trendVerdict,
  type AirRole,
  type Verdict,
} from '@/lib/ops/restoration-psychrometry'

export type AirReading = {
  id: string
  appointment_id: string | null
  role: AirRole | null
  location: string
  equipment_placement_id: string | null
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
  activeVisitId,
  visitLabel,
  busy,
  onLog,
  onEdit,
  onRemove,
}: {
  readings: AirReading[]
  /** The visit being viewed. Readings are shown and judged per visit. */
  activeVisitId: string | null
  visitLabel: string
  busy: boolean
  /** Resolve to false when the reading did not save, so the numbers are kept. */
  onLog: (reading: {
    role: AirRole
    location: string
    temp_f: number
    rh_pct: number
  }) => Promise<boolean | void> | void
  onEdit: (
    readingId: string,
    patch: { temp_f?: number; rh_pct?: number },
  ) => void | Promise<unknown>
  onRemove: (readingId: string) => void | Promise<unknown>
}) {
  const [role, setRole] = useState<AirRole>('affected')
  const [location, setLocation] = useState('')
  const [tempF, setTempF] = useState('')
  const [rhPct, setRhPct] = useState('')
  const [failed, setFailed] = useState(false)

  const previewGpp =
    Number(tempF) && Number(rhPct) ? grainsPerPound(Number(tempF), Number(rhPct)) : null
  const previewDew =
    Number(tempF) && Number(rhPct) ? dewPointF(Number(tempF), Number(rhPct)) : null

  /**
   * This visit's readings, not the job's.
   *
   * The verdicts describe one moment: what the room held, what came out of the
   * dehu, how that compared to the unaffected air. Mixing Tuesday's outlet with
   * Saturday's room reading describes a machine and a room that never existed
   * together, and reads as confidently as a true one.
   */
  const mine = useMemo(
    () => readings.filter((r) => r.appointment_id === activeVisitId),
    [readings, activeVisitId],
  )

  const latestByRole = useMemo(() => {
    const map = new Map<string, AirReading>()
    for (const reading of [...mine].sort(
      (a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime(),
    )) {
      if (reading.role) map.set(reading.role, reading)
    }
    return map
  }, [mine])

  const toReading = (r: AirReading | undefined) => ({
    role: r?.role ?? null,
    tempF: r?.temp_f == null ? null : Number(r.temp_f),
    rhPct: r?.rh_pct == null ? null : Number(r.rh_pct),
    takenAt: r?.taken_at ?? '',
  })

  // The air going into a dehu is the room air, so the affected-area reading is
  // the intake. One reading, used twice, instead of asking for the same number
  // under two names.
  const verdicts: Verdict[] = [
    dehumidifierVerdict(
      toReading(latestByRole.get('affected')),
      toReading(latestByRole.get('dehu_outlet')),
    ),
    // The goal is the unaffected air in the same building, never outside.
    dryGoalVerdict(
      toReading(latestByRole.get('affected')),
      toReading(latestByRole.get('unaffected')),
    ),
    // The trend is the one thing that SHOULD span every visit.
    trendVerdict(
      readings.map((r) => ({
        role: r.role,
        tempF: r.temp_f == null ? null : Number(r.temp_f),
        rhPct: r.rh_pct == null ? null : Number(r.rh_pct),
        takenAt: r.taken_at,
      })),
    ),
    // Only when it actually says something: outside is worth acting on when it
    // is markedly drier than the chamber, and silent otherwise.
    ventilationNote(
      toReading(latestByRole.get('affected')),
      toReading(latestByRole.get('outside')),
    ),
  ].filter((v): v is Verdict => v != null)

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
            // Only clear the boxes once the reading is actually saved. Clearing
            // regardless is how a failed log looks exactly like a successful
            // one, and a reading Charles took in the field quietly disappears.
            setFailed(false)
            const saved = await onLog({
              role,
              location: location.trim(),
              temp_f: Number(tempF),
              rh_pct: Number(rhPct),
            })
            if (saved === false) {
              setFailed(true)
              return
            }
            setTempF('')
            setRhPct('')
            setLocation('')
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Log'}
        </Button>
      </div>

      {failed ? (
        <p className="text-xs text-red-600 dark:text-red-400">
          That reading did not save — your numbers are still here. Try again.
        </p>
      ) : null}

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

      <p className="text-muted-foreground text-xs">{visitLabel}</p>

      {mine.length > 0 ? (
        <div className="border-border/60 max-h-56 overflow-y-auto rounded-md border text-xs">
          {[...mine]
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
                  {/* Editable in place: a wrong temp or RH gives a confident
                      wrong verdict about a machine or a room. */}
                  <input
                    className="w-10 bg-transparent text-right tabular-nums outline-none"
                    type="number"
                    step="any"
                    aria-label="Temperature"
                    defaultValue={reading.temp_f ?? ''}
                    onBlur={(e) => {
                      const tempF = Number(e.target.value)
                      if (Number.isFinite(tempF) && tempF !== Number(reading.temp_f)) {
                        void onEdit(reading.id, { temp_f: tempF })
                      }
                    }}
                  />
                  <span className="text-muted-foreground">°F</span>
                  <input
                    className="w-10 bg-transparent text-right tabular-nums outline-none"
                    type="number"
                    step="any"
                    min={0}
                    max={100}
                    aria-label="Relative humidity"
                    defaultValue={reading.rh_pct ?? ''}
                    onBlur={(e) => {
                      const rhPct = Number(e.target.value)
                      if (
                        Number.isFinite(rhPct) &&
                        rhPct >= 0 &&
                        rhPct <= 100 &&
                        rhPct !== Number(reading.rh_pct)
                      ) {
                        void onEdit(reading.id, { rh_pct: rhPct })
                      }
                    }}
                  />
                  <span className="text-muted-foreground">%</span>
                  <span className="w-16 text-right tabular-nums">
                    {gpp != null ? `${gpp} GPP` : ''}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove this reading"
                    onClick={() => void onRemove(reading.id)}
                  >
                    <X className="text-muted-foreground h-3 w-3" />
                  </button>
                </div>
              )
            })}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          Nothing logged on this visit yet.
        </p>
      )}

      {readings.length > mine.length ? (
        <p className="text-muted-foreground text-xs">
          {readings.length - mine.length} more from other visits — pick that visit
          above to see or correct them.
        </p>
      ) : null}
    </div>
  )
}
