'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Mail, AlertCircle, CheckCircle } from 'lucide-react'

type EmailLogEntry = {
  id: string
  template_key: string
  to_email: string
  subject: string | null
  status: 'sent' | 'failed'
  error_message: string | null
  resend_id: string | null
  sent_at: string
  ops_customers: { full_name: string } | null
  ops_appointments: { appointment_date: string } | null
}

const TEMPLATE_LABELS: Record<string, string> = {
  job_scheduled_email: 'Booking Confirmation',
  job_finished_email: 'Job Completed',
  satisfaction_checkin_email: 'Satisfaction Check-in',
}

export default function EmailOutboxPage() {
  const [emails, setEmails] = useState<EmailLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/comms/email-log?limit=50')
      .then((r) => r.json())
      .then((data) => {
        setEmails(data.emails || [])
        setTotal(data.total || 0)
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Email Outbox</h1>
          <p className="text-sm text-white/50">
            {total} email{total !== 1 ? 's' : ''} sent
          </p>
        </div>
        <Mail className="h-5 w-5 text-white/30" />
      </div>

      {loading ? (
        <p className="text-sm text-white/40">Loading...</p>
      ) : emails.length === 0 ? (
        <Card className="p-8 text-center text-sm text-white/40">
          No emails sent yet
        </Card>
      ) : (
        <div className="space-y-2">
          {emails.map((email) => (
            <Card key={email.id} className="flex items-start gap-4 p-4">
              <div className="mt-0.5">
                {email.status === 'sent' ? (
                  <CheckCircle className="h-4 w-4 text-green-400" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-red-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {email.ops_customers?.full_name || email.to_email}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {TEMPLATE_LABELS[email.template_key] || email.template_key}
                  </Badge>
                  {email.status === 'failed' && (
                    <Badge variant="destructive" className="text-xs">
                      Failed
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-white/40">
                  {email.to_email}
                  {email.ops_appointments?.appointment_date
                    ? ` · Appt ${new Date(`${email.ops_appointments.appointment_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                    : ''}
                </p>
                {email.subject && (
                  <p className="mt-1 truncate text-xs text-white/50">
                    {email.subject}
                  </p>
                )}
                {email.error_message && (
                  <p className="mt-1 text-xs text-red-400">
                    {email.error_message}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs text-white/30">
                {new Date(email.sent_at).toLocaleDateString('en-US', {
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
