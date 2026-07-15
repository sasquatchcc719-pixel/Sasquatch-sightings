'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Loader2,
  LogIn,
  Mail,
  MessageSquare,
  Play,
  RefreshCw,
  Upload,
  User,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { QuickBooksStatus } from '@/components/admin/ops/quickbooks-status'
import { AgentApiSettings } from '@/components/admin/ops/agent-api-settings'
import { StaffPhotoCropper } from '@/components/admin/ops/staff-photo-cropper'

type QueueStats = {
  pending: number
  due_now: number
  failed: number
  sent_last_24h: number
}

type QueueStatusResponse = {
  stats: QueueStats
  cron_provider: string
  recommended_schedule: string
}

type CommunicationTemplate = {
  template_key: string
  channel: 'sms' | 'email'
  label: string
  is_enabled: boolean
}

type TemplatesResponse = {
  templates: CommunicationTemplate[]
}

type EmailLogEntry = {
  id: string
  template_key: string
  to_email: string
  subject: string | null
  status: 'sent' | 'failed'
  error_message: string | null
  sent_at: string
  ops_customers: { full_name: string } | null
  ops_appointments: { appointment_date: string } | null
}

const OPS_EMAIL_TEMPLATE_LABELS: Record<string, string> = {
  job_scheduled_email: 'Booking confirmation',
  job_rescheduled_email: 'Reschedule confirmation',
  job_finished_email: 'Job completed',
  satisfaction_checkin_email: 'Satisfaction check-in',
  quote: 'Estimate / quote',
  estimate_send: 'Estimate',
  invoice_send: 'Invoice',
  payment_request: 'Payment',
}

function formatEmailTemplateLabel(key: string) {
  return OPS_EMAIL_TEMPLATE_LABELS[key] || key.replace(/_/g, ' ')
}

type StaffMember = {
  id: string
  user_id: string | null
  display_name: string
  role: string
  profile_image_url: string | null
}

function StaffPhotoCard() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [uploading, setUploading] = useState<string | null>(null)
  const [impersonating, setImpersonating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cropTarget, setCropTarget] = useState<{
    staffId: string
    imageSrc: string
  } | null>(null)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  async function openPortalAs(member: StaffMember) {
    if (!member.user_id) return
    const portalWindow = window.open('', '_blank')
    if (!portalWindow) {
      setError(
        'Popup blocked. Allow popups, then try opening the portal again.',
      )
      return
    }

    portalWindow.document.write(
      '<!doctype html><title>Opening tech portal</title><body style="margin:0;background:#020617;color:#cbd5e1;font-family:system-ui;display:grid;min-height:100vh;place-items:center"><p>Opening tech portal...</p></body>',
    )
    setImpersonating(member.id)
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: member.user_id }),
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Failed')
      if (!data.url) throw new Error('No portal link returned')
      portalWindow.location.href = data.url
    } catch (err) {
      portalWindow.close()
      setError(err instanceof Error ? err.message : 'Failed to open portal')
    } finally {
      setImpersonating(null)
    }
  }

  useEffect(() => {
    fetch('/api/admin/ops/staff')
      .then((r) => r.json())
      .then((data: { staff: StaffMember[] }) => setStaff(data.staff || []))
      .catch(() => setError('Failed to load staff'))
  }, [])

  function handleFileSelected(staffId: string, file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      setCropTarget({ staffId, imageSrc: reader.result as string })
    }
    reader.readAsDataURL(file)
  }

  async function handleCropSave(blob: Blob) {
    if (!cropTarget) return
    const { staffId } = cropTarget
    setCropTarget(null)
    setUploading(staffId)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', new File([blob], 'photo.jpg', { type: 'image/jpeg' }))
      form.append('staff_user_id', staffId)
      const res = await fetch('/api/admin/ops/staff/photo', {
        method: 'POST',
        body: form,
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setStaff((prev) =>
        prev.map((s) =>
          s.id === staffId
            ? {
                ...s,
                profile_image_url: data.url
                  ? `${data.url}?t=${Date.now()}`
                  : null,
              }
            : s,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(null)
    }
  }

  return (
    <>
      {cropTarget && (
        <StaffPhotoCropper
          imageSrc={cropTarget.imageSrc}
          onSave={(blob) => void handleCropSave(blob)}
          onCancel={() => setCropTarget(null)}
        />
      )}
      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Technician Profiles</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Profile photos are used in customer-facing notifications.
        </p>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-4 flex flex-col gap-4">
          {staff.map((member) => (
            <div key={member.id} className="flex items-center gap-4">
              <div className="border-border/60 bg-muted relative h-16 w-16 shrink-0 overflow-hidden rounded-full border">
                {member.profile_image_url ? (
                  <Image
                    key={member.profile_image_url}
                    src={member.profile_image_url}
                    alt={member.display_name}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <User className="text-muted-foreground h-7 w-7" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{member.display_name}</p>
                <p className="text-muted-foreground text-sm capitalize">
                  {member.role}
                </p>
              </div>
              <input
                ref={(el) => {
                  inputRefs.current[member.id] = el
                }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFileSelected(member.id, file)
                  e.target.value = ''
                }}
              />
              <div className="flex items-center gap-2">
                {member.user_id ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={impersonating === member.id}
                    onClick={() => void openPortalAs(member)}
                    title="Open tech portal as this user"
                  >
                    {impersonating === member.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <LogIn className="h-3.5 w-3.5" />
                    )}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploading === member.id}
                  onClick={() => inputRefs.current[member.id]?.click()}
                >
                  {uploading === member.id ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {member.profile_image_url ? 'Replace' : 'Upload'} photo
                </Button>
              </div>
            </div>
          ))}
          {staff.length === 0 && !error && (
            <p className="text-muted-foreground text-sm">Loading staff…</p>
          )}
        </div>
      </Card>
    </>
  )
}

type ClientPortalUser = {
  id: string
  user_id: string | null
  display_name: string
  email: string
  customer_label: string
}

function ClientPortalAccessCard() {
  const [clients, setClients] = useState<ClientPortalUser[]>([])
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/admin/ops/client-users')
      .then((r) => r.json())
      .then((data: { clients?: ClientPortalUser[] }) =>
        setClients(data.clients || []),
      )
      .catch(() => setError('Failed to load client users'))
      .finally(() => setLoaded(true))
  }, [])

  async function openPortalAs(member: ClientPortalUser) {
    if (!member.user_id) return
    const portalWindow = window.open('', '_blank')
    if (!portalWindow) {
      setError('Popup blocked. Allow popups, then try again.')
      return
    }
    portalWindow.document.write(
      '<!doctype html><title>Opening client portal</title><body style="margin:0;background:#020617;color:#cbd5e1;font-family:system-ui;display:grid;min-height:100vh;place-items:center"><p>Opening client portal...</p></body>',
    )
    setOpening(member.id)
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: member.user_id, portal: 'client' }),
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || !data.url) throw new Error(data.error || 'Failed')
      portalWindow.location.href = data.url
    } catch (err) {
      portalWindow.close()
      setError(err instanceof Error ? err.message : 'Failed to open portal')
    } finally {
      setOpening(null)
    }
  }

  // Hide the card when there are no client-portal users yet.
  if (loaded && clients.length === 0 && !error) return null

  return (
    <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
      <h3 className="text-lg font-semibold">Client Portal Access</h3>
      <p className="text-muted-foreground mt-1 text-sm">
        Commercial contacts with a scoped login. Open their portal to see
        exactly what they see (preview for maintenance).
      </p>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-4 flex flex-col gap-3">
        {clients.map((member) => (
          <div key={member.id} className="flex items-center gap-4">
            <div className="border-border/60 bg-muted flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border">
              <User className="text-muted-foreground h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{member.display_name}</p>
              <p className="text-muted-foreground truncate text-sm">
                {member.customer_label
                  ? `${member.customer_label} · ${member.email}`
                  : member.email}
              </p>
            </div>
            {member.user_id && (
              <Button
                variant="outline"
                size="sm"
                disabled={opening === member.id}
                onClick={() => void openPortalAs(member)}
                title="Open client portal as this user"
              >
                {opening === member.id ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LogIn className="mr-1.5 h-3.5 w-3.5" />
                )}
                Open portal
              </Button>
            )}
          </div>
        ))}
        {!loaded && <p className="text-muted-foreground text-sm">Loading…</p>}
      </div>
    </Card>
  )
}

function ChannelSwitch({
  label,
  enabled,
  disabled,
  onToggle,
}: {
  label: string
  enabled: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground w-12 text-xs font-medium">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={disabled}
        onClick={() => onToggle()}
        className={`focus-visible:ring-ring relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
          enabled ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition ${
            enabled ? 'translate-x-6' : 'translate-x-0.5'
          }`}
        />
      </button>
      <span className="text-xs font-medium">{enabled ? 'On' : 'Off'}</span>
    </div>
  )
}

export function OperationsSettings() {
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<QueueStatusResponse | null>(null)
  const [templates, setTemplates] = useState<CommunicationTemplate[]>([])
  const [lastRunMessage, setLastRunMessage] = useState<string | null>(null)
  const [emailLog, setEmailLog] = useState<EmailLogEntry[]>([])
  const [emailLogTotal, setEmailLogTotal] = useState(0)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [queueResponse, templatesResponse, logResponse] = await Promise.all(
        [
          fetch('/api/admin/ops/communications/queue', {
            cache: 'no-store',
          }),
          fetch('/api/admin/ops/communications/templates', {
            cache: 'no-store',
          }),
          fetch('/api/admin/comms/email-log?limit=40', { cache: 'no-store' }),
        ],
      )

      const [queueResult, templatesResult] = (await Promise.all([
        queueResponse.json(),
        templatesResponse.json(),
      ])) as [
        QueueStatusResponse & { error?: string },
        TemplatesResponse & { error?: string },
      ]

      if (!queueResponse.ok) {
        throw new Error(queueResult.error || 'Failed to load settings')
      }
      if (!templatesResponse.ok) {
        throw new Error(templatesResult.error || 'Failed to load templates')
      }
      setStatus(queueResult)
      setTemplates(templatesResult.templates || [])

      if (logResponse.ok) {
        const logData = (await logResponse.json()) as {
          emails?: EmailLogEntry[]
          total?: number
        }
        setEmailLog(logData.emails || [])
        setEmailLogTotal(logData.total ?? 0)
      } else {
        setEmailLog([])
        setEmailLogTotal(0)
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load settings',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const runNow = async () => {
    setRunning(true)
    setError(null)
    setLastRunMessage(null)
    try {
      const response = await fetch('/api/admin/ops/communications/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to process queue')
      }
      setLastRunMessage(
        `Processed ${result.result.processed}, sent ${result.result.sent}, failed ${result.result.failed}.`,
      )
      await loadStatus()
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : 'Failed to process queue',
      )
    } finally {
      setRunning(false)
    }
  }

  const [togglingKey, setTogglingKey] = useState<string | null>(null)

  const templateByKey = new Map(
    templates.map((template) => [template.template_key, template]),
  )
  const jobScheduledSmsEnabled =
    templateByKey.get('job_scheduled_sms')?.is_enabled || false
  const jobScheduledEmailEnabled =
    templateByKey.get('job_scheduled_email')?.is_enabled || false
  const onMyWaySmsEnabled =
    templateByKey.get('on_my_way_sms')?.is_enabled || false
  const jobFinishedSmsEnabled =
    templateByKey.get('job_finished_sms')?.is_enabled || false
  const jobFinishedEmailEnabled =
    templateByKey.get('job_finished_email')?.is_enabled || false

  const setTemplateEnabled = async (
    templateKey: string,
    is_enabled: boolean,
  ) => {
    setTogglingKey(templateKey)
    setError(null)
    try {
      const response = await fetch('/api/admin/ops/communications/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_key: templateKey, is_enabled }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update template')
      }
      await loadStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update template')
    } finally {
      setTogglingKey(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <h2 className="text-2xl font-semibold">Operations Settings</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Delayed communications are handled with Vercel Cron plus the queue in
          Supabase. Immediate lifecycle messages send instantly and do not wait
          for cron.
        </p>
      </Card>

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">QuickBooks Integration</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect to QuickBooks Online to sync customers and invoices
          automatically. Use the toggle to pause syncing without disconnecting.
        </p>
        <div className="mt-4">
          <QuickBooksStatus />
        </div>
      </Card>

      <StaffPhotoCard />

      <ClientPortalAccessCard />

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">AI Agent Booking API</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Allow AI assistants like ChatGPT, Gemini, Claude, Grok, and Perplexity
          to check availability, view pricing, and book jobs on your behalf.
        </p>
        <div className="mt-4">
          <AgentApiSettings />
        </div>
      </Card>

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">
              Lifecycle Messaging Status
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              This controls whether customer messages go out automatically
              during job lifecycle events. If a template is OFF, that message is
              skipped.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/operations/communications">
              <MessageSquare className="mr-2 h-4 w-4" />
              Open Communications
            </Link>
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          <div className="border-border/60 bg-background/70 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div>
              <div className="font-medium">On Job Create (Scheduled)</div>
              <div className="text-muted-foreground text-sm">
                Triggered when a dispatcher creates a job in Operations.
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
              <ChannelSwitch
                label="SMS"
                enabled={jobScheduledSmsEnabled}
                disabled={togglingKey === 'job_scheduled_sms'}
                onToggle={() =>
                  void setTemplateEnabled(
                    'job_scheduled_sms',
                    !jobScheduledSmsEnabled,
                  )
                }
              />
              <ChannelSwitch
                label="Email"
                enabled={jobScheduledEmailEnabled}
                disabled={togglingKey === 'job_scheduled_email'}
                onToggle={() =>
                  void setTemplateEnabled(
                    'job_scheduled_email',
                    !jobScheduledEmailEnabled,
                  )
                }
              />
            </div>
          </div>

          <div className="border-border/60 bg-background/70 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div>
              <div className="font-medium">On My Way</div>
              <div className="text-muted-foreground text-sm">
                Triggered when job status is changed to <code>on_my_way</code>.
              </div>
            </div>
            <ChannelSwitch
              label="SMS"
              enabled={onMyWaySmsEnabled}
              disabled={togglingKey === 'on_my_way_sms'}
              onToggle={() =>
                void setTemplateEnabled('on_my_way_sms', !onMyWaySmsEnabled)
              }
            />
          </div>

          <div className="border-border/60 bg-background/70 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div>
              <div className="font-medium">On Job Complete</div>
              <div className="text-muted-foreground text-sm">
                Triggered when job status is changed to <code>completed</code>.
                Email sends only if the customer has an email, has not opted
                out, <code className="mx-1">RESEND_API_KEY</code> is set, and
                this template is enabled. See{' '}
                <Link
                  href="/admin/email-outbox"
                  className="text-primary font-medium underline-offset-4 hover:underline"
                >
                  Email outbox
                </Link>{' '}
                or <code>ops_email_log</code> for delivery rows.
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
              <ChannelSwitch
                label="SMS"
                enabled={jobFinishedSmsEnabled}
                disabled={togglingKey === 'job_finished_sms'}
                onToggle={() =>
                  void setTemplateEnabled(
                    'job_finished_sms',
                    !jobFinishedSmsEnabled,
                  )
                }
              />
              <ChannelSwitch
                label="Email"
                enabled={jobFinishedEmailEnabled}
                disabled={togglingKey === 'job_finished_email'}
                onToggle={() =>
                  void setTemplateEnabled(
                    'job_finished_email',
                    !jobFinishedEmailEnabled,
                  )
                }
              />
            </div>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      {lastRunMessage ? (
        <Card className="border-border/60 bg-card/80 p-4 text-sm shadow-sm backdrop-blur">
          {lastRunMessage}
        </Card>
      ) : null}

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Communications Queue</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Monitor delayed follow-up emails and trigger processing manually.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void loadStatus()}
              disabled={loading || running}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button onClick={() => void runNow()} disabled={running || loading}>
              {running ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Run Due Now
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-border/60 bg-background/70 p-4">
            <div className="text-muted-foreground text-xs uppercase">
              Pending
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {status?.stats.pending ?? 0}
            </div>
          </Card>
          <Card className="border-border/60 bg-background/70 p-4">
            <div className="text-muted-foreground text-xs uppercase">
              Due now
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {status?.stats.due_now ?? 0}
            </div>
          </Card>
          <Card className="border-border/60 bg-background/70 p-4">
            <div className="text-muted-foreground text-xs uppercase">
              Failed
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {status?.stats.failed ?? 0}
            </div>
          </Card>
          <Card className="border-border/60 bg-background/70 p-4">
            <div className="text-muted-foreground text-xs uppercase">
              Sent (24h)
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {status?.stats.sent_last_24h ?? 0}
            </div>
          </Card>
        </div>
      </Card>

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Recent emails sent</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Logged in <code>ops_email_log</code> (
              {emailLogTotal.toLocaleString()} total
              {emailLog.length < emailLogTotal
                ? ` — showing last ${emailLog.length}`
                : ''}
              ). Bodies are stored for messages sent after the email-log update;
              we cannot backfill Resend or mail history from before that.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/email-outbox">Full log &amp; preview</Link>
            </Button>
            <Mail className="text-muted-foreground h-5 w-5" />
          </div>
        </div>

        <div className="mt-4 max-h-[min(28rem,50vh)] overflow-auto rounded-lg border">
          {loading && emailLog.length === 0 ? (
            <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              Loading…
            </div>
          ) : emailLog.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              No logged emails yet. After the next send (booking, job finished,
              queue follow-up, etc.), rows appear here.
            </p>
          ) : (
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10 text-xs uppercase">
                <tr>
                  <th className="p-2.5 pl-3 font-medium">When</th>
                  <th className="p-2.5 font-medium">To / customer</th>
                  <th className="p-2.5 font-medium">Type</th>
                  <th className="p-2.5 font-medium">Subject</th>
                  <th className="p-2.5 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {emailLog.map((row) => (
                  <tr
                    key={row.id}
                    className="border-border/60 border-b last:border-0"
                  >
                    <td className="text-muted-foreground p-2.5 pl-3 font-mono text-xs whitespace-nowrap">
                      {new Date(row.sent_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="max-w-[200px] p-2.5">
                      <div className="truncate text-xs" title={row.to_email}>
                        {row.ops_customers?.full_name
                          ? `${row.ops_customers.full_name} · `
                          : ''}
                        {row.to_email}
                      </div>
                    </td>
                    <td className="p-2.5">
                      <Badge variant="secondary" className="font-normal">
                        {formatEmailTemplateLabel(row.template_key)}
                      </Badge>
                    </td>
                    <td
                      className="max-w-[220px] truncate p-2.5 text-xs"
                      title={row.subject || ''}
                    >
                      {row.subject || '—'}
                    </td>
                    <td className="p-2.5 pr-3">
                      {row.status === 'sent' ? (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">
                          Sent
                        </span>
                      ) : (
                        <span
                          className="text-destructive max-w-[140px] truncate text-xs"
                          title={row.error_message || undefined}
                        >
                          Failed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Cron Configuration</h3>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Provider:</span>
            <Badge variant="outline">{status?.cron_provider || 'vercel'}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Schedule:</span>
            <code>{status?.recommended_schedule || '*/15 * * * *'}</code>
          </div>
          <div className="text-muted-foreground">
            Route: <code>/api/cron/ops-communications</code>
          </div>
        </div>
      </Card>
    </div>
  )
}
