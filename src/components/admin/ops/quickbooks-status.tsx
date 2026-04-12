'use client'

import { useEffect, useState } from 'react'

type QBStatus = {
  connected: boolean
  realmId: string | null
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  pending: number
  failed: number
  last_synced_at: string | null
}

export function QuickBooksStatus() {
  const [status, setStatus] = useState<QBStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/quickbooks/status')
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false))
  }, [])

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
        <div className="space-y-1 text-xs text-white/50">
          <div className="flex justify-between">
            <span>Pending sync jobs</span>
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
          {status.last_synced_at && (
            <div className="flex justify-between">
              <span>Last synced</span>
              <span className="text-white/40">
                {new Date(status.last_synced_at).toLocaleString()}
              </span>
            </div>
          )}
        </div>
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
