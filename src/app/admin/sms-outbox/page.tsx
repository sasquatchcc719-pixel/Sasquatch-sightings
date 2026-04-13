'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MessageSquare, AlertCircle, CheckCircle } from 'lucide-react'

type SmsLogEntry = {
  id: string
  recipient_phone: string
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
}

export default function SmsOutboxPage() {
  const [messages, setMessages] = useState<SmsLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/comms/sms-log?limit=50')
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages || [])
        setTotal(data.total || 0)
      })
      .finally(() => setLoading(false))
  }, [])

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

      {loading ? (
        <p className="text-sm text-white/40">Loading...</p>
      ) : messages.length === 0 ? (
        <Card className="p-8 text-center text-sm text-white/40">
          No Operations SMS logged yet. If texts are sending, check Twilio logs;
          if SMS was skipped (no Twilio env), nothing is stored here.
        </Card>
      ) : (
        <div className="space-y-2">
          {messages.map((row) => (
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
                    {row.recipient_phone}
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
