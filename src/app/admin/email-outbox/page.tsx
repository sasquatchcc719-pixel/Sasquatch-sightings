'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Mail,
} from 'lucide-react'

type EmailLogEntry = {
  id: string
  template_key: string
  to_email: string
  subject: string | null
  body_text: string | null
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

function EmailRow({ email }: { email: EmailLogEntry }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card
      className="cursor-pointer p-4 transition-colors hover:bg-white/5"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-start gap-4">
        <div className="mt-0.5 shrink-0">
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
            <p className="mt-1 text-xs text-red-400">{email.error_message}</p>
          )}

          {/* Expanded body */}
          {expanded && (
            <div
              className="mt-3 rounded-lg border border-white/10 bg-white/5 p-4 text-sm whitespace-pre-wrap text-white/80"
              onClick={(e) => e.stopPropagation()}
            >
              {email.body_text ? (
                email.body_text
              ) : (
                <span className="text-white/30 italic">
                  No body stored — only emails sent after this update are saved.
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs text-white/30">
            {new Date(email.sent_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-white/30" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-white/30" />
          )}
        </div>
      </div>
    </Card>
  )
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
            <EmailRow key={email.id} email={email} />
          ))}
        </div>
      )}
    </div>
  )
}
