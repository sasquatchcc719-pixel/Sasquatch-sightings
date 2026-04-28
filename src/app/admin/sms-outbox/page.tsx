'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MessageSquare, AlertCircle, CheckCircle } from 'lucide-react'

type SmsLogEntry = {
  id: string
  recipient_phone: string
  customer_name?: string | null
  message_type: string
  message_content: string
  status: string | null
  twilio_sid: string | null
  sent_at: string
}

const TYPE_LABELS: Record<string, string> = {
  ops_job_scheduled_sms: 'Booking confirmation (SMS)',
  ops_on_my_way_sms: 'On my way',
  ops_job_finished_sms: 'Job finished',
  ops_job_rescheduled_sms: 'Rescheduled',
  ops_day_before_residential_sms: 'Day-before reminder (Residential)',
  ops_day_before_recovery_village_sms: 'Day-before reminder (Recovery Village)',
}

export default function SmsOutboxPage() {
  const [messages, setMessages] = useState<SmsLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('limit', '200')
    if (typeFilter) params.set('message_type', typeFilter)
    if (statusFilter) params.set('status', statusFilter)

    fetch(`/api/admin/comms/sms-log?${params.toString()}`, {
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages || [])
      })
      .finally(() => setLoading(false))
  }, [typeFilter, statusFilter])

  const filteredMessages = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) {
      return messages
    }
    return messages.filter((row) => {
      return (
        String(row.customer_name || '')
          .toLowerCase()
          .includes(term) ||
        String(row.recipient_phone || '')
          .toLowerCase()
          .includes(term) ||
        String(row.message_content || '')
          .toLowerCase()
          .includes(term)
      )
    })
  }, [messages, search])
  const total = filteredMessages.length

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">SMS Outbox (Operations)</h1>
          <p className="text-sm text-white/50">
            Outbound texts from booking, on-my-way, job finished, etc. {total}{' '}
            message{total !== 1 ? 's' : ''} logged
          </p>
          <p className="mt-1 max-w-2xl text-xs text-white/35">
            Inbound texts to your business number live under Comms → Direct
            Texts. This list is only automated Operations SMS (not lead/contest
            nurture).
          </p>
        </div>
        <MessageSquare className="h-5 w-5 text-white/30" />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <input
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
            placeholder="Search name, phone, or message"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All message types</option>
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="received">Received</option>
          </select>
          <button
            type="button"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
            onClick={() => {
              setSearch('')
              setTypeFilter('')
              setStatusFilter('')
            }}
          >
            Clear filters
          </button>
        </div>
      </Card>

      {loading ? (
        <p className="text-sm text-white/40">Loading...</p>
      ) : filteredMessages.length === 0 ? (
        <Card className="p-8 text-center text-sm text-white/40">
          No Operations SMS logged yet. If texts are sending, check Twilio logs;
          if SMS was skipped (no Twilio env), nothing is stored here.
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredMessages.map((row) => (
            <Card key={row.id} className="flex items-start gap-4 p-4">
              <div className="mt-0.5">
                {row.status === 'failed' ? (
                  <AlertCircle className="h-4 w-4 text-red-400" />
                ) : (
                  <CheckCircle className="h-4 w-4 text-green-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {row.customer_name
                      ? `${row.customer_name} · ${row.recipient_phone}`
                      : row.recipient_phone}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {TYPE_LABELS[row.message_type] || row.message_type}
                  </Badge>
                </div>
                <p className="mt-2 text-xs break-words whitespace-pre-wrap text-white/60">
                  {row.message_content}
                </p>
                {row.status === 'failed' ? (
                  <p className="mt-1 text-xs text-red-400">Delivery failed</p>
                ) : null}
              </div>
              <span className="shrink-0 text-xs text-white/30">
                {new Date(row.sent_at).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
