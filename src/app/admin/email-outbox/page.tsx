'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ReactivationControlCenter } from '@/components/admin/reactivation-control-center'
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Mail,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react'

type EmailLogEntry = {
  id: string
  source?: 'jobs' | 'reactivation' | 'drip'
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

const SOURCE_META: Record<string, { label: string; className: string }> = {
  jobs: { label: 'Job email', className: 'bg-slate-500/15 text-slate-300' },
  reactivation: {
    label: 'Reactivation',
    className: 'bg-emerald-500/15 text-emerald-400',
  },
  drip: { label: 'Post-job drip', className: 'bg-blue-500/15 text-blue-400' },
}

function EmailRow({ email }: { email: EmailLogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const loadPreview = async () => {
    if (previewHtml) {
      setShowPreview((v) => !v)
      return
    }
    setPreviewLoading(true)
    try {
      const res = await fetch(
        `/api/admin/comms/email-log/${email.id}/preview?source=${email.source || 'jobs'}`,
      )
      if (res.ok) {
        setPreviewHtml(await res.text())
        setShowPreview(true)
      }
    } finally {
      setPreviewLoading(false)
    }
  }

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
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_META[email.source || 'jobs']?.className || ''}`}
            >
              {SOURCE_META[email.source || 'jobs']?.label || email.source}
            </span>
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
              className="mt-3 space-y-2"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Plain-text body */}
              <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm whitespace-pre-wrap text-white/80">
                {email.body_text ? (
                  email.body_text.replace(/\\n/g, '\n')
                ) : (
                  <span className="text-white/30 italic">
                    No body stored — only emails sent after this update are
                    saved.
                  </span>
                )}
              </div>

              {/* Preview toggle */}
              {email.body_text && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={loadPreview}
                    disabled={previewLoading}
                    className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white/90 disabled:opacity-50"
                  >
                    {previewLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : showPreview ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                    {showPreview ? 'Hide email preview' : 'View as email'}
                  </button>
                </div>
              )}

              {/* HTML preview iframe */}
              {showPreview && previewHtml && (
                <div className="overflow-hidden rounded-lg border border-white/10">
                  <iframe
                    srcDoc={previewHtml}
                    sandbox="allow-same-origin"
                    className="h-[520px] w-full bg-white"
                    title="Email preview"
                  />
                </div>
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
  const [search, setSearch] = useState('')
  const [templateKey, setTemplateKey] = useState('')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('all')

  useEffect(() => {
    const query = new URLSearchParams()
    query.set('limit', '50')
    if (search.trim()) query.set('q', search.trim())
    if (templateKey) query.set('template_key', templateKey)
    if (status) query.set('status', status)
    if (source && source !== 'all') query.set('source', source)

    fetch(`/api/admin/comms/email-log?${query.toString()}`, {
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((data) => {
        setEmails(data.emails || [])
        setTotal(data.total || 0)
      })
      .finally(() => setLoading(false))
  }, [search, templateKey, status, source])

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

      <div id="reactivation" className="scroll-mt-6">
        <ReactivationControlCenter />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <input
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
            placeholder="Search customer, email, or subject"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="all">All sources</option>
            <option value="jobs">Job emails</option>
            <option value="reactivation">Reactivation</option>
            <option value="drip">Post-job drip</option>
          </select>
          <select
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value)}
          >
            <option value="">All template types</option>
            {Object.entries(TEMPLATE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
          <button
            type="button"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
            onClick={() => {
              setSearch('')
              setTemplateKey('')
              setStatus('')
              setSource('all')
            }}
          >
            Clear filters
          </button>
        </div>
      </Card>

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
