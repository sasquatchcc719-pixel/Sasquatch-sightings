'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Thermometer, X } from 'lucide-react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BOX_TRUCK_NAME,
  PROBE_STALE_MS,
  TEMPERATURE_HISTORY_RANGES,
  temperatureAlarm,
  type TruckTemperature,
} from '@/lib/truck-temperature'

const endpoint = '/api/admin/fleet/temperature'
type HistoryReading = {
  minute_at: string
  temperature_f: number
  low_f: number
  high_f: number
}
type TemperatureData = TruckTemperature & { history: HistoryReading[] }

async function readTemperature(days?: number): Promise<TemperatureData> {
  const response = await fetch(days ? `${endpoint}?days=${days}` : endpoint, {
    cache: 'no-store',
  })
  if (response.status === 401) throw new Error('Unauthorized')
  if (!response.ok) throw new Error('Temperature unavailable')
  return response.json()
}

const formatTime = (time: number | string, includeDate = false) =>
  new Date(time).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    ...(includeDate ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  })

export function TruckTemperatureButton({
  canEditAlarms = true,
}: {
  canEditAlarms?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: ['truck-temperature'],
    queryFn: () => readTemperature(),
    refetchInterval: 30_000,
    retry: false,
  })
  const reading = query.data
  const stale =
    query.isError ||
    !reading?.receivedAt ||
    query.dataUpdatedAt - Date.parse(reading.receivedAt) > PROBE_STALE_MS
  const alarm =
    !stale &&
    temperatureAlarm(
      reading?.temperatureF ?? null,
      reading?.lowF ?? null,
      reading?.highF ?? null,
    )

  if (
    query.error &&
    !reading &&
    (query.error as Error).message === 'Unauthorized'
  )
    return null

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          dialog.current?.showModal()
          setOpen(true)
        }}
        className={`flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition hover:bg-white/10 sm:w-auto ${alarm ? 'border-amber-400/60 bg-amber-900/30' : 'border-cyan-300/25 bg-white/5'}`}
      >
        <Thermometer
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-cyan-200"
        />
        <span className="flex-1">
          <span className="block text-xs font-medium">{BOX_TRUCK_NAME}</span>
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xl font-bold tabular-nums">
              {reading?.temperatureF != null
                ? `${reading.temperatureF.toFixed(1)}°F`
                : '—'}
            </span>
            <span
              className={`text-xs ${alarm ? 'text-amber-200' : 'text-slate-300'}`}
            >
              {alarm
                ? `${alarm === 'low' ? 'Low' : 'High'} alarm`
                : reading?.temperatureF != null
                  ? stale
                    ? `Last seen ${formatTime(reading.receivedAt!, true)} MT`
                    : 'Live'
                  : query.isPending
                    ? 'Checking…'
                    : query.isError
                      ? 'Unavailable'
                      : 'No probe reading'}
            </span>
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-slate-300"
        />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="truck-temperature-title"
        onClose={() => setOpen(false)}
        className="m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto rounded-2xl border border-cyan-300/25 bg-slate-950 text-slate-100 backdrop:bg-black/65"
      >
        <div className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 id="truck-temperature-title" className="text-lg font-semibold">
              {BOX_TRUCK_NAME} temperature
            </h2>
            <button
              type="button"
              aria-label="Close temperature history"
              onClick={() => dialog.current?.close()}
              className="rounded-lg p-2 hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {open && <TemperatureDetails canEditAlarms={canEditAlarms} />}
        </div>
      </dialog>
    </>
  )
}

function TemperatureDetails({ canEditAlarms }: { canEditAlarms: boolean }) {
  const [range, setRange] = useState<
    (typeof TEMPERATURE_HISTORY_RANGES)[number]
  >(TEMPERATURE_HISTORY_RANGES[0])
  const { days, bucketMinutes, interval } = range
  const showExtremes = days >= 30
  const query = useQuery({
    queryKey: ['truck-temperature', days],
    queryFn: () => readTemperature(days),
    refetchInterval: 60_000,
  })
  const data = query.data
  const history = data?.history ?? []
  const bucketMs = bucketMinutes * 60_000
  const showDatesOnly =
    showExtremes &&
    history.length > 1 &&
    Date.parse(history[history.length - 1].minute_at) -
      Date.parse(history[0].minute_at) >=
      2 * 86_400_000
  const points = history.flatMap((reading, index) => {
    const time = Date.parse(reading.minute_at)
    const previous = index > 0 ? Date.parse(history[index - 1].minute_at) : time
    const point = {
      time,
      temperature: Number(reading.temperature_f.toFixed(1)),
      extremes: [
        Number(reading.low_f.toFixed(1)),
        Number(reading.high_f.toFixed(1)),
      ],
    }
    return time - previous > bucketMs
      ? [
          { time: previous + bucketMs, temperature: null, extremes: null },
          point,
        ]
      : [point]
  })

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Temperature history</h3>
        <div className="flex gap-1 rounded-lg bg-slate-900 p-1">
          {TEMPERATURE_HISTORY_RANGES.map((option) => (
            <button
              key={option.days}
              type="button"
              onClick={() => setRange(option)}
              aria-pressed={days === option.days}
              className={`rounded-md px-2 py-1.5 text-xs ${days === option.days ? 'bg-cyan-900 text-white' : 'text-slate-300'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 h-56 rounded-xl border border-white/10 bg-slate-900/70 pt-3">
        {points.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              margin={{ top: 6, right: 18, bottom: 8, left: 0 }}
              accessibilityLayer
            >
              <CartesianGrid stroke="#334155" vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(value) =>
                  showDatesOnly
                    ? new Date(value).toLocaleDateString('en-US', {
                        timeZone: 'America/Denver',
                        month: 'short',
                        day: 'numeric',
                      })
                    : formatTime(value, days > 1)
                }
                tick={{ fill: '#cbd5e1', fontSize: 11 }}
                minTickGap={28}
              />
              <YAxis
                width={48}
                tickFormatter={(value) => `${Number(value.toFixed(1))}°F`}
                domain={['auto', 'auto']}
                tick={{ fill: '#cbd5e1', fontSize: 11 }}
              />
              <Tooltip
                labelFormatter={(value) =>
                  `${formatTime(Number(value), true)} MT`
                }
                formatter={(value) =>
                  Array.isArray(value)
                    ? [`${value[0]}–${value[1]}°F`, 'Low to high']
                    : [`${value}°F`, 'Average']
                }
                contentStyle={{
                  background: '#0f172a',
                  borderColor: '#475569',
                  color: '#f8fafc',
                }}
              />
              {data?.lowF != null && (
                <ReferenceLine
                  y={data.lowF}
                  stroke="#38bdf8"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                />
              )}
              {data?.highF != null && (
                <ReferenceLine
                  y={data.highF}
                  stroke="#fb923c"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                />
              )}
              {showExtremes && (
                <Area
                  dataKey="extremes"
                  stroke="none"
                  fill="#5eead4"
                  fillOpacity={0.24}
                  isAnimationActive={false}
                />
              )}
              <Line
                dataKey="temperature"
                stroke="#5eead4"
                strokeWidth={2}
                isAnimationActive={false}
                dot={{ r: 2, strokeWidth: 0, fill: '#5eead4' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <p role="status" className="p-4 text-sm text-slate-300">
            {query.isError
              ? 'Unable to load temperature history.'
              : query.isPending
                ? 'Loading history…'
                : 'No readings in this time range.'}
          </p>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Mountain Time · {interval} averages
        {showExtremes && ' with highs and lows'}
      </p>
      {canEditAlarms && data && (
        <AlarmSettings
          key={`${data.lowF}:${data.highF}`}
          lowF={data.lowF}
          highF={data.highF}
        />
      )}
    </>
  )
}

function AlarmSettings({
  lowF,
  highF,
}: Pick<TruckTemperature, 'lowF' | 'highF'>) {
  const cache = useQueryClient()
  const [low, setLow] = useState(lowF?.toString() ?? '')
  const [high, setHigh] = useState(highF?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lowF: low === '' ? null : Number(low),
          highF: high === '' ? null : Number(high),
        }),
      })
      if (!response.ok)
        throw new Error(
          (await response.json()).error || 'Unable to save alarm settings',
        )
      const updated = await response.json()
      cache.setQueriesData<TemperatureData>(
        { queryKey: ['truck-temperature'] },
        (current) =>
          current
            ? { ...current, lowF: updated.lowF, highF: updated.highF }
            : current,
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to save alarm settings',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="mt-5 border-t border-white/10 pt-4">
      <h3 className="text-sm font-semibold">Temperature alarms</h3>
      <p className="mt-1 text-xs text-slate-300">
        Alerts go to your admin Telegram. Leave a limit blank to turn it off.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex-1 text-sm">
          Low limit (°F)
          <input
            className="mt-1 block w-full min-w-24 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2"
            type="number"
            step="any"
            min="-67"
            max="257"
            value={low}
            onChange={(event) => setLow(event.target.value)}
          />
        </label>
        <label className="flex-1 text-sm">
          High limit (°F)
          <input
            className="mt-1 block w-full min-w-24 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2"
            type="number"
            step="any"
            min="-67"
            max="257"
            value={high}
            onChange={(event) => setHigh(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={
            saving ||
            (low === (lowF?.toString() ?? '') &&
              high === (highF?.toString() ?? ''))
          }
          className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save limits'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-300">
          {error}
        </p>
      )}
    </form>
  )
}
