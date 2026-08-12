'use client'

/**
 * Fiber checks — every rug and upholstery item identified before cleaning,
 * and every piece of work removed from an invoice with the reason and the
 * evidence attached.
 */

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Card } from '@/components/ui/card'
import { AlertTriangle, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'

type Check = {
  id: string
  item_label: string
  verdict: 'go' | 'low_moisture' | 'do_not_wet_clean'
  determined_by: string
  fiber: string | null
  confidence: string | null
  has_tag: boolean
  tag_text: string | null
  burn_result: string | null
  photo_urls: string[]
  warnings: string[]
  recommended_method: string | null
  checked_by_label: string | null
  created_at: string
  appointmentDate: string | null
  customerName: string
}

type Excluded = {
  id: string
  name_snapshot: string
  excluded_at: string
  excluded_reason: string | null
  excluded_original_total: number | null
}

const VERDICT_META: Record<
  Check['verdict'],
  { label: string; className: string }
> = {
  go: {
    label: 'Safe to clean',
    className: 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300',
  },
  low_moisture: {
    label: 'Low moisture only',
    className: 'border-amber-500/40 bg-amber-950/30 text-amber-300',
  },
  do_not_wet_clean: {
    label: 'DO NOT WET CLEAN',
    className: 'border-red-500/50 bg-red-950/40 text-red-300',
  },
}

export default function FiberChecksPage() {
  const [checks, setChecks] = useState<Check[]>([])
  const [excluded, setExcluded] = useState<Excluded[]>([])
  const [declinedValue, setDeclinedValue] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/fiber-checks', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setChecks(data.checks ?? [])
        setExcluded(data.excluded ?? [])
        setDeclinedValue(data.declinedValue ?? 0)
      })
      .finally(() => setLoading(false))
  }, [])

  const blocked = checks.filter((c) => c.verdict === 'do_not_wet_clean').length

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-bold">Fiber Checks</h1>
        <p className="text-sm text-slate-400">
          Every rug and upholstery item identified before cleaning.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Checks run
          </p>
          <p className="text-2xl font-bold">{checks.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Items we refused to wet clean
          </p>
          <p className="text-2xl font-bold text-red-400">{blocked}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Work value declined
          </p>
          <p className="text-2xl font-bold text-amber-400">
            ${declinedValue.toFixed(2)}
          </p>
        </Card>
      </div>

      {excluded.length > 0 ? (
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">Work removed from invoices</h2>
          <div className="space-y-2">
            {excluded.map((row) => (
              <div
                key={row.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/40 p-3"
              >
                <div>
                  <p className="text-sm font-medium">{row.name_snapshot}</p>
                  <p className="text-xs text-slate-400">
                    {row.excluded_reason}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(row.excluded_at).toLocaleDateString()}
                  </p>
                </div>
                <p className="font-mono text-sm text-amber-300">
                  ${Number(row.excluded_original_total ?? 0).toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="space-y-3">
        {checks.length === 0 ? (
          <Card className="p-6 text-center text-sm text-slate-400">
            No fiber checks recorded yet.
          </Card>
        ) : null}
        {checks.map((check) => {
          const meta = VERDICT_META[check.verdict]
          return (
            <Card key={check.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{check.item_label}</p>
                  <p className="text-sm text-slate-400">
                    {check.customerName}
                    {check.appointmentDate
                      ? ` · ${new Date(check.appointmentDate).toLocaleDateString()}`
                      : ''}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${meta.className}`}
                >
                  {check.verdict === 'go' ? (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5" />
                  )}
                  {meta.label}
                </span>
              </div>

              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <p>
                  <span className="text-slate-400">Fiber: </span>
                  {check.fiber ?? 'unidentified'}
                </p>
                <p>
                  <span className="text-slate-400">Determined by: </span>
                  {check.determined_by === 'stop_list'
                    ? 'care tag match (not a judgment call)'
                    : check.determined_by === 'burn_test'
                      ? 'burn test'
                      : check.determined_by.replace('_', ' ')}
                </p>
                <p>
                  <span className="text-slate-400">Confidence: </span>
                  {check.confidence ?? '—'}
                </p>
                <p>
                  <span className="text-slate-400">Checked by: </span>
                  {check.checked_by_label ?? '—'}
                </p>
              </div>

              {check.tag_text ? (
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-950/60 p-2 text-xs text-slate-300">
                  {check.tag_text}
                </pre>
              ) : null}

              {check.warnings.length > 0 ? (
                <div className="mt-3 space-y-1">
                  {check.warnings.map((warning, i) => (
                    <p
                      key={i}
                      className="flex gap-2 text-xs text-slate-300"
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                      {warning}
                    </p>
                  ))}
                </div>
              ) : null}

              {check.photo_urls.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {check.photo_urls.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      <Image
                        src={url}
                        alt="Fiber check photo"
                        width={96}
                        height={96}
                        className="h-24 w-24 rounded-lg border border-white/10 object-cover"
                        unoptimized
                      />
                    </a>
                  ))}
                </div>
              ) : null}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
