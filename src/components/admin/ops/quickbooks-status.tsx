'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'

type QBInvoiceDetail = {
  id: string
  invoice_number: number | string | null
  label: string
  customer_name: string
  appointment_date: string | null
  start_time: string | null
  appointment_status: string | null
  invoice_status: string | null
  payment_method: string | null
  total: number | null
  location: string | null
  created_at: string | null
  url: string
}

type QBPendingJob = {
  id: string
  entity_type: string
  entity_id: string
  label: string
  customer_name: string | null
  appointment_date: string | null
  start_time: string | null
  total: number | null
  location: string | null
  created_at: string | null
  updated_at: string | null
  url: string | null
}

type QBStatus = {
  connected: boolean
  sync_enabled: boolean
  realmId: string | null
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  pending: number
  failed: number
  stuck: number
  pending_jobs: QBPendingJob[]
  stuck_invoices: QBInvoiceDetail[]
  last_synced_at: string | null
}

function formatCurrency(amount: number | null) {
  if (amount == null || Number.isNaN(amount)) return null
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
  })
}

function formatDateTime(date: string | null, time?: string | null) {
  if (!date) return null
  const value = time ? `${date}T${time}` : date
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return date

  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: time ? 'numeric' : undefined,
    minute: time ? '2-digit' : undefined,
  })
}

function DetailRow({
  title,
  subtitle,
  amount,
  url,
  tone = 'neutral',
}: {
  title: string
  subtitle: string
  amount: string | null
  url: string | null
  tone?: 'neutral' | 'danger'
}) {
  const content = (
    <div
      className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 ${
        tone === 'danger'
          ? 'border-red-500/20 bg-red-500/10'
          : 'border-white/10 bg-black/20'
      }`}
    >
      <div className="min-w-0">
        <div
          className={`truncate text-xs font-semibold ${
            tone === 'danger' ? 'text-red-100' : 'text-white/80'
          }`}
        >
          {title}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-white/45">
          {subtitle}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-right">
        {amount && <span className="text-xs text-white/60">{amount}</span>}
        {url && <ExternalLink className="h-3.5 w-3.5 text-white/35" />}
      </div>
    </div>
  )

  if (!url) return content

  return (
    <a href={url} className="block transition-opacity hover:opacity-85">
      {content}
    </a>
  )
}

export function QuickBooksStatus() {
  const [status, setStatus] = useState<QBStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [showPending, setShowPending] = useState(false)

  useEffect(() => {
    fetch('/api/admin/quickbooks/status')
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false))
  }, [])

  async function handleToggle() {
    if (!status) return
    setToggling(true)
    try {
      const res = await fetch('/api/admin/quickbooks/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !status.sync_enabled }),
      })
      if (res.ok) {
        setStatus((prev) =>
          prev ? { ...prev, sync_enabled: !prev.sync_enabled } : prev,
        )
      }
    } finally {
      setToggling(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect QuickBooks? You can reconnect anytime.')) return
    setDisconnecting(true)
    try {
      const res = await fetch('/api/admin/quickbooks/disconnect', {
        method: 'POST',
      })
      if (res.ok) {
        setStatus((prev) =>
          prev
            ? { ...prev, connected: false, sync_enabled: false, realmId: null }
            : prev,
        )
      }
    } finally {
      setDisconnecting(false)
    }
  }

  async function handleRetry() {
    setRetrying(true)
    try {
      const res = await fetch('/api/admin/quickbooks/retry', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                failed: 0,
                pending:
                  prev.pending +
                  (data.retried || 0) +
                  (data.promoted_from_held || 0),
              }
            : prev,
        )
      }
    } finally {
      setRetrying(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/40">
        Loading QuickBooks status...
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white/70">
          QuickBooks Online
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            status?.connected
              ? 'bg-green-500/20 text-green-400'
              : 'bg-red-500/20 text-red-400'
          }`}
        >
          {status?.connected ? 'Connected' : 'Not Connected'}
        </span>
      </div>

      {status?.connected ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50">Auto-sync invoices</span>
            <button
              onClick={handleToggle}
              disabled={toggling}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                status.sync_enabled ? 'bg-green-500' : 'bg-white/20'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  status.sync_enabled ? 'translate-x-4' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="space-y-1 text-xs text-white/50">
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => setShowPending((value) => !value)}
                disabled={status.pending === 0}
                className="inline-flex items-center gap-1 text-left transition-colors hover:text-white/70 disabled:cursor-default disabled:hover:text-white/50"
              >
                {status.pending > 0 ? (
                  showPending ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )
                ) : (
                  <span className="h-3 w-3" />
                )}
                <span>Pending sync jobs</span>
              </button>
              <span
                className={
                  status.pending > 0 ? 'text-yellow-400' : 'text-white/40'
                }
              >
                {status.pending}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Failed jobs</span>
              <span
                className={status.failed > 0 ? 'text-red-400' : 'text-white/40'}
              >
                {status.failed}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Stuck invoices</span>
              <span
                className={status.stuck > 0 ? 'text-red-400' : 'text-white/40'}
              >
                {status.stuck}
              </span>
            </div>
            {status.last_synced_at && (
              <div className="flex justify-between">
                <span>Last synced</span>
                <span className="text-white/40">
                  {new Date(status.last_synced_at).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {status.stuck_invoices.length > 0 && (
            <div className="space-y-2 rounded-md border border-red-500/20 bg-red-500/5 p-3">
              <div className="text-xs font-semibold text-red-300">
                Stuck invoices needing attention
              </div>
              <div className="space-y-2">
                {status.stuck_invoices.map((invoice) => {
                  const when = formatDateTime(
                    invoice.appointment_date,
                    invoice.start_time,
                  )
                  const pieces = [
                    invoice.customer_name,
                    when,
                    invoice.location,
                    invoice.invoice_status
                      ? `Status: ${invoice.invoice_status}`
                      : null,
                    invoice.payment_method
                      ? `Paid by ${invoice.payment_method}`
                      : null,
                  ].filter(Boolean)

                  return (
                    <DetailRow
                      key={invoice.id}
                      title={invoice.label}
                      subtitle={pieces.join(' - ')}
                      amount={formatCurrency(invoice.total)}
                      url={invoice.url}
                      tone="danger"
                    />
                  )
                })}
              </div>
            </div>
          )}

          {showPending && status.pending > 0 && (
            <div className="space-y-2 rounded-md border border-yellow-500/20 bg-yellow-500/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-yellow-300">
                  Pending sync jobs
                </span>
                {status.pending > status.pending_jobs.length && (
                  <span className="text-[11px] text-white/35">
                    Showing first {status.pending_jobs.length}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {status.pending_jobs.map((job) => {
                  const when = formatDateTime(
                    job.appointment_date,
                    job.start_time,
                  )
                  const pieces = [
                    job.entity_type === 'invoice' ? 'Invoice' : 'Customer',
                    job.customer_name,
                    when,
                    job.location,
                  ].filter(Boolean)

                  return (
                    <DetailRow
                      key={job.id}
                      title={job.label}
                      subtitle={pieces.join(' - ')}
                      amount={formatCurrency(job.total)}
                      url={job.url}
                    />
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {status.failed > 0 && (
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="rounded-md bg-yellow-600/20 px-3 py-1.5 text-xs font-medium text-yellow-400 transition-colors hover:bg-yellow-600/30 disabled:opacity-50"
              >
                {retrying ? 'Retrying...' : `Retry ${status.failed} failed`}
              </button>
            )}
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="rounded-md bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-600/30 disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        </>
      ) : (
        <a
          href="/api/admin/quickbooks/connect"
          className="block w-full rounded-md bg-[#2CA01C] py-2 text-center text-xs font-medium text-white transition-colors hover:bg-[#259018]"
        >
          Connect QuickBooks
        </a>
      )}
    </div>
  )
}
