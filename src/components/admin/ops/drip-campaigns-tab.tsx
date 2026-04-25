'use client'

import { useEffect, useState } from 'react'
import {
  Loader2,
  Save,
  Mail,
  Clock,
  Users,
  CheckCircle,
  XCircle,
  Ban,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

type DripTemplate = {
  id: string
  step_index: number
  label: string
  delay_days: number
  subject_template: string
  body_template: string
  is_enabled: boolean
}

type EnrollmentRow = {
  id: string
  customer_id: string
  appointment_id: string
  enrolled_at: string
  current_step: number
  next_send_at: string
  status: string
  created_at: string
  ops_customers:
    | { full_name: string; email: string }
    | { full_name: string; email: string }[]
    | null
  ops_appointments:
    | { appointment_date: string }
    | { appointment_date: string }[]
    | null
}

type LogRow = {
  id: string
  enrollment_id: string
  step: number
  template_label: string
  subject: string
  to_email: string
  status: string
  error_message: string | null
  sent_at: string
}

type DripStats = {
  active: number
  completed: number
  unsubscribed: number
  totalEmails: number
}

type AutoEmailLogRow = {
  id: string
  template_key: string
  to_email: string
  subject: string | null
  status: string
  error_message: string | null
  sent_at: string
  ops_customers: { full_name: string } | { full_name: string }[] | null
}

type BlockedCustomer = {
  id: string
  full_name: string | null
  email: string | null
  email_opt_out: boolean | null
}

function unwrap<T>(val: T | T[] | null): T | null {
  if (!val) return null
  return Array.isArray(val) ? val[0] || null : val
}

export function DripCampaignsTab() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<DripTemplate[]>([])
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([])
  const [log, setLog] = useState<LogRow[]>([])
  const [autoEmailLog, setAutoEmailLog] = useState<AutoEmailLogRow[]>([])
  const [blockedCustomers, setBlockedCustomers] = useState<BlockedCustomer[]>(
    [],
  )
  const [stats, setStats] = useState<DripStats>({
    active: 0,
    completed: 0,
    unsubscribed: 0,
    totalEmails: 0,
  })
  const [showEnrollments, setShowEnrollments] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [blockingCustomerId, setBlockingCustomerId] = useState<string | null>(
    null,
  )

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/ops/drip-campaigns', {
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok)
        throw new Error(data.error || 'Failed to load drip campaigns')
      setTemplates(data.templates || [])
      setEnrollments(data.enrollments || [])
      setLog(data.log || [])
      setAutoEmailLog(data.auto_email_log || [])
      setBlockedCustomers(data.blocked_customers || [])
      setStats(
        data.stats || {
          active: 0,
          completed: 0,
          unsubscribed: 0,
          totalEmails: 0,
        },
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function blockCustomerEmail(customerId: string, customerName?: string) {
    setBlockingCustomerId(customerId)
    setError(null)
    try {
      const res = await fetch('/api/admin/ops/drip-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'block_customer_email',
          customer_id: customerId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to block customer')
      await loadData()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : `Failed to block ${customerName || 'customer'}`,
      )
    } finally {
      setBlockingCustomerId(null)
    }
  }

  async function unblockCustomerEmail(customerId: string) {
    setBlockingCustomerId(customerId)
    setError(null)
    try {
      const res = await fetch('/api/admin/ops/drip-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'unblock_customer_email',
          customer_id: customerId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to unblock customer')
      await loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unblock customer')
    } finally {
      setBlockingCustomerId(null)
    }
  }

  async function saveTemplate(template: DripTemplate) {
    setSavingId(template.id)
    setError(null)
    try {
      const res = await fetch('/api/admin/ops/drip-campaigns', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: template.id,
          label: template.label,
          delay_days: template.delay_days,
          subject_template: template.subject_template,
          body_template: template.body_template,
          is_enabled: template.is_enabled,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setTemplates((prev) =>
        prev.map((t) => (t.id === template.id ? data.template : t)),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSavingId(null)
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading drip campaigns...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      )}

      {/* Overview card */}
      <Card className="animate-slide-up border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <h2 className="text-gradient-purple text-2xl font-bold tracking-tight">
          Drip Email Campaigns
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Automated follow-up emails sent after jobs are completed. Edit the
          subject, body, delay, and toggle each step on or off. Use{' '}
          <code className="text-xs">{'{{first_name}}'}</code>,{' '}
          <code className="text-xs">{'{{city}}'}</code>, and{' '}
          <code className="text-xs">{'{{service_summary}}'}</code> as merge
          tags.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="animate-slide-up card-interactive rounded-lg border border-blue-500/20 bg-blue-950/20 p-3 text-center">
            <div className="stat-value stat-glow-blue text-2xl font-bold text-blue-400">
              {stats.active}
            </div>
            <div className="text-xs font-medium tracking-wide text-blue-300/60 uppercase">
              Active
            </div>
          </div>
          <div className="animate-slide-up-delay-1 card-interactive rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-3 text-center">
            <div className="stat-value stat-glow-emerald text-2xl font-bold text-emerald-400">
              {stats.completed}
            </div>
            <div className="text-xs font-medium tracking-wide text-emerald-300/60 uppercase">
              Completed
            </div>
          </div>
          <div className="animate-slide-up-delay-2 card-interactive rounded-lg border border-amber-500/20 bg-amber-950/20 p-3 text-center">
            <div className="stat-value stat-glow-amber text-2xl font-bold text-amber-400">
              {stats.unsubscribed}
            </div>
            <div className="text-xs font-medium tracking-wide text-amber-300/60 uppercase">
              Unsubscribed
            </div>
          </div>
          <div className="animate-slide-up-delay-3 card-interactive rounded-lg border border-purple-500/20 bg-purple-950/20 p-3 text-center">
            <div className="stat-value text-2xl font-bold text-purple-400">
              {stats.totalEmails}
            </div>
            <div className="text-xs font-medium tracking-wide text-purple-300/60 uppercase">
              Emails Sent
            </div>
          </div>
        </div>
      </Card>

      {/* Templates */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          <h3 className="text-xl font-semibold">Email Steps</h3>
        </div>

        <div className="grid gap-4">
          {templates.map((template) => {
            const isSaving = savingId === template.id
            return (
              <Card
                key={template.id}
                className="accent-border-left border-border/60 bg-card/80 border-l-purple-500/50 p-5 shadow-sm backdrop-blur transition-all hover:border-l-purple-400"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500 text-sm font-bold text-white shadow-lg shadow-purple-500/20">
                      {template.step_index + 1}
                    </div>
                    <div>
                      <Input
                        value={template.label}
                        className="border-none bg-transparent p-0 text-lg font-semibold"
                        onChange={(e) =>
                          setTemplates((prev) =>
                            prev.map((t) =>
                              t.id === template.id
                                ? { ...t, label: e.target.value }
                                : t,
                            ),
                          )
                        }
                      />
                      <div className="text-muted-foreground mt-1 flex items-center gap-2 text-sm">
                        <Clock className="h-3 w-3" />
                        <span>Sends</span>
                        <Input
                          type="number"
                          className="mx-1 inline-block h-6 w-16 px-1 text-center text-sm"
                          value={String(template.delay_days)}
                          onChange={(e) =>
                            setTemplates((prev) =>
                              prev.map((t) =>
                                t.id === template.id
                                  ? {
                                      ...t,
                                      delay_days: Number(e.target.value) || 0,
                                    }
                                  : t,
                              ),
                            )
                          }
                        />
                        <span>days after job completion</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={template.is_enabled ? 'default' : 'outline'}
                    >
                      {template.is_enabled ? 'On' : 'Off'}
                    </Badge>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={template.is_enabled}
                        onChange={(e) =>
                          setTemplates((prev) =>
                            prev.map((t) =>
                              t.id === template.id
                                ? { ...t, is_enabled: e.target.checked }
                                : t,
                            ),
                          )
                        }
                      />
                      Enabled
                    </label>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <Label>Subject</Label>
                    <Input
                      value={template.subject_template}
                      onChange={(e) =>
                        setTemplates((prev) =>
                          prev.map((t) =>
                            t.id === template.id
                              ? { ...t, subject_template: e.target.value }
                              : t,
                          ),
                        )
                      }
                    />
                  </div>

                  <div>
                    <Label>Body</Label>
                    <Textarea
                      className="min-h-52 font-mono text-sm"
                      value={template.body_template}
                      onChange={(e) =>
                        setTemplates((prev) =>
                          prev.map((t) =>
                            t.id === template.id
                              ? { ...t, body_template: e.target.value }
                              : t,
                          ),
                        )
                      }
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button
                      onClick={() => void saveTemplate(template)}
                      disabled={isSaving}
                      className="gap-2"
                    >
                      {isSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Save
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Automatic Email Log */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            <h3 className="text-lg font-semibold">
              Automatic Email Log ({autoEmailLog.length})
            </h3>
          </div>
          <Badge variant="outline" className="text-xs">
            Job Scheduled / Job Finished / Satisfaction
          </Badge>
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          Running list of automatic lifecycle emails, directly under this tool.
        </p>
        <div className="mt-4 overflow-x-auto">
          {autoEmailLog.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No automatic emails logged yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Customer</th>
                  <th className="pb-2">To</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Subject</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {autoEmailLog.map((entry) => {
                  const customer = unwrap(entry.ops_customers)
                  return (
                    <tr key={entry.id} className="border-border/30 border-b">
                      <td className="py-2 text-xs">
                        {new Date(entry.sent_at).toLocaleDateString()}
                      </td>
                      <td className="py-2 text-xs">
                        {customer?.full_name || '—'}
                      </td>
                      <td className="py-2 text-xs">{entry.to_email || '—'}</td>
                      <td className="py-2 text-xs">
                        {entry.template_key === 'job_scheduled_email'
                          ? 'Job scheduled'
                          : entry.template_key === 'job_finished_email'
                            ? 'Job finished'
                            : entry.template_key ===
                                'satisfaction_checkin_email'
                              ? 'Satisfaction'
                              : entry.template_key}
                      </td>
                      <td className="max-w-56 truncate py-2 text-xs">
                        {entry.subject || '—'}
                      </td>
                      <td className="py-2">
                        {entry.status === 'sent' ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <span className="flex items-center gap-1 text-red-500">
                            <XCircle className="h-4 w-4" />
                            <span className="text-xs">
                              {entry.error_message || 'failed'}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Do Not Send List */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          <h3 className="text-lg font-semibold">
            Do Not Send Email List ({blockedCustomers.length})
          </h3>
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          Customers on this list have <code>email_opt_out=true</code> and are
          excluded from automated emails.
        </p>
        <div className="mt-4 overflow-x-auto">
          {blockedCustomers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No blocked customers yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="pb-2">Customer</th>
                  <th className="pb-2">Email</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {blockedCustomers.map((row) => (
                  <tr key={row.id} className="border-border/30 border-b">
                    <td className="py-2">{row.full_name || '—'}</td>
                    <td className="py-2 text-xs">{row.email || '—'}</td>
                    <td className="py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={blockingCustomerId === row.id}
                        onClick={() => void unblockCustomerEmail(row.id)}
                      >
                        {blockingCustomerId === row.id
                          ? 'Saving…'
                          : 'Allow Emails'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Enrollments */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <button
          className="flex w-full items-center justify-between text-left"
          onClick={() => setShowEnrollments(!showEnrollments)}
        >
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <h3 className="text-lg font-semibold">
              Enrollments ({enrollments.length})
            </h3>
          </div>
          {showEnrollments ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {showEnrollments && (
          <div className="mt-4 space-y-2">
            {enrollments.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No enrollments yet. Customers are enrolled automatically when
                jobs are completed.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left text-xs">
                      <th className="pb-2">Customer</th>
                      <th className="pb-2">Email</th>
                      <th className="pb-2">Step</th>
                      <th className="pb-2">Next Send</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollments.map((enrollment) => {
                      const customer = unwrap(enrollment.ops_customers)
                      return (
                        <tr
                          key={enrollment.id}
                          className="border-border/30 border-b"
                        >
                          <td className="py-2">{customer?.full_name || '—'}</td>
                          <td className="py-2 text-xs">
                            {customer?.email || '—'}
                          </td>
                          <td className="py-2">
                            <Badge variant="outline" className="text-xs">
                              Step {enrollment.current_step + 1}
                            </Badge>
                          </td>
                          <td className="py-2 text-xs">
                            {enrollment.status === 'active'
                              ? enrollment.next_send_at
                              : '—'}
                          </td>
                          <td className="py-2">
                            <StatusBadge status={enrollment.status} />
                          </td>
                          <td className="py-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={
                                blockingCustomerId === enrollment.customer_id
                              }
                              onClick={() =>
                                void blockCustomerEmail(
                                  enrollment.customer_id,
                                  customer?.full_name || undefined,
                                )
                              }
                            >
                              <Ban className="h-3.5 w-3.5" />
                              {blockingCustomerId === enrollment.customer_id
                                ? 'Blocking…'
                                : 'Do Not Send'}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Send Log */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <button
          className="flex w-full items-center justify-between text-left"
          onClick={() => setShowLog(!showLog)}
        >
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            <h3 className="text-lg font-semibold">Send Log ({log.length})</h3>
          </div>
          {showLog ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {showLog && (
          <div className="mt-4 space-y-2">
            {log.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No emails sent yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left text-xs">
                      <th className="pb-2">Date</th>
                      <th className="pb-2">Step</th>
                      <th className="pb-2">To</th>
                      <th className="pb-2">Subject</th>
                      <th className="pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((entry) => (
                      <tr key={entry.id} className="border-border/30 border-b">
                        <td className="py-2 text-xs">
                          {new Date(entry.sent_at).toLocaleDateString()}
                        </td>
                        <td className="py-2">
                          {entry.template_label || `Step ${entry.step + 1}`}
                        </td>
                        <td className="py-2 text-xs">
                          {entry.to_email || '—'}
                        </td>
                        <td className="max-w-48 truncate py-2 text-xs">
                          {entry.subject || '—'}
                        </td>
                        <td className="py-2">
                          {entry.status === 'sent' ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : entry.status === 'failed' ? (
                            <span className="flex items-center gap-1 text-red-500">
                              <XCircle className="h-4 w-4" />
                              <span className="text-xs">
                                {entry.error_message}
                              </span>
                            </span>
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              {entry.status}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') {
    return <Badge className="bg-blue-500/20 text-blue-400">Active</Badge>
  }
  if (status === 'completed') {
    return <Badge className="bg-green-500/20 text-green-400">Complete</Badge>
  }
  if (status === 'unsubscribed') {
    return (
      <Badge className="bg-orange-500/20 text-orange-400">Unsubscribed</Badge>
    )
  }
  if (status === 'cancelled') {
    return <Badge variant="outline">Cancelled</Badge>
  }
  return <Badge variant="outline">{status}</Badge>
}
