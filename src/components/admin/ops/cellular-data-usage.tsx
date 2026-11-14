'use client'

import { useQuery } from '@tanstack/react-query'
import { Radio } from 'lucide-react'
import type { CellularUsage } from '@/lib/hologram-usage'

const endpoint = '/api/admin/fleet/cellular-usage'
const bytesPerMegabyte = 1_000_000

async function readUsage(): Promise<CellularUsage> {
  const response = await fetch(endpoint, { cache: 'no-store' })
  if (response.status === 401) throw new Error('Unauthorized')
  if (!response.ok) throw new Error('Usage unavailable')
  return response.json()
}

function megabytes(bytes: number) {
  return bytes / bytesPerMegabyte
}

function formatMegabytes(bytes: number, compact = false) {
  const value = megabytes(bytes)
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: compact || value >= 1_000 ? 0 : 2,
    minimumFractionDigits: compact ? 0 : value < 10 ? 2 : 0,
  }).format(value)
}

function resetLabel(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
  })
}

export function CellularDataUsage() {
  const query = useQuery({
    queryKey: ['cellular-data-usage'],
    queryFn: readUsage,
    refetchInterval: 5 * 60_000,
    retry: false,
  })
  const usage = query.data

  if (
    query.error &&
    !usage &&
    (query.error as Error).message === 'Unauthorized'
  )
    return null

  const used = usage ? formatMegabytes(usage.usedBytes) : null
  const limit =
    usage?.limitBytes == null ? null : formatMegabytes(usage.limitBytes, true)
  const remaining =
    usage?.remainingBytes == null ? null : formatMegabytes(usage.remainingBytes)
  const percent = usage?.percentUsed ?? null
  const reset = resetLabel(usage?.billingPeriodEnd ?? null)
  const barWidth = percent == null ? 0 : Math.max(1, Math.min(100, percent))

  return (
    <section className="min-h-16 w-full min-w-64 rounded-xl border border-cyan-300/25 bg-white/5 px-3 py-2 sm:w-auto">
      <div className="flex items-center gap-2">
        <Radio aria-hidden="true" className="h-4 w-4 text-cyan-200" />
        <h3 className="text-xs font-medium">Cellular data</h3>
        {percent != null && (
          <span className="ml-auto text-xs text-slate-300 tabular-nums">
            {percent.toFixed(1)}%
          </span>
        )}
      </div>
      {usage ? (
        <>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums">
            {used} MB{limit ? ` / ${limit} MB` : ''}
          </p>
          <div
            role="progressbar"
            aria-label="Cellular data used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent == null ? undefined : Math.round(percent)}
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-700"
          >
            <div
              className={`h-full rounded-full ${percent != null && percent >= 80 ? 'bg-amber-400' : 'bg-cyan-400'}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-300">
            {remaining ? `${remaining} MB left` : 'No data cap'}
            {reset ? ` · Resets ${reset}` : ''}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-300">
          {query.isPending ? 'Checking carrier usage…' : 'Usage unavailable'}
        </p>
      )}
    </section>
  )
}
