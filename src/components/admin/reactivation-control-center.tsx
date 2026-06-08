'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Ban,
  CheckCircle,
  Clock,
  Loader2,
  Mail,
  Pause,
  Play,
  RotateCw,
  Save,
  Search,
  ShieldOff,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type Settings = {
  engine_enabled: boolean
  daily_send_cap: number
  cadence_days: number
  dormancy_months: number
  default_offer: string
  strong_offer_enabled: boolean
  strong_offer: string
  strong_offer_expires_at: string | null
}

type Template = {
  id: string
  template_key: string
  category: string
  label: string
  rotation_order: number
  subject_template: string
  body_template: string
  is_enabled: boolean
  is_strong_offer: boolean
}

type CustomerRelation =
  | {
      full_name: string | null
      first_name?: string | null
      email: string | null
      phone?: string | null
      email_opt_out?: boolean | null
    }
  | Array<{
      full_name: string | null
      first_name?: string | null
      email: string | null
      phone?: string | null
      email_opt_out?: boolean | null
    }>
  | null

type Enrollment = {
  id: string
  customer_id: string
  status: string
  enrollment_source: string
  next_send_at: string | null
  messages_sent: number
  last_sent_at: string | null
  latest_appointment_at: string | null
  paused_until: string | null
  stop_reason: string | null
  manual_suppression_reason: string | null
  override_notes: string | null
  updated_at: string
  ops_customers: CustomerRelation
}

type LogEntry = {
  id: string
  customer_id: string | null
  template_key: string | null
  event_type: string
  subject: string | null
  to_email: string | null
  status: string
  error_message: string | null
  sent_at: string
  metadata: Record<string, unknown> | null
  ops_customers:
    | { full_name: string | null; email: string | null }
    | { full_name: string | null; email: string | null }[]
    | null
}

type ReactivationData = {
  settings: Settings | null
  templates: Template[]
  enrollments: Enrollment[]
  log: LogEntry[]
  stats: Record<string, number>
}

function unwrap<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not scheduled'
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Never'
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function statusLabel(status: string) {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
  if (status === 'active') return 'default'
  if (status.startsWith('suppressed')) return 'destructive'
  return 'outline'
}

function defaultSettings(): Settings {
  return {
    engine_enabled: true,
    daily_send_cap: 35,
    cadence_days: 30,
    dormancy_months: 6,
    default_offer: '$20 off your next cleaning',
    strong_offer_enabled: false,
    strong_offer: '$35 off your next cleaning',
    strong_offer_expires_at: null,
  }
}

export function ReactivationControlCenter() {
  const [data, setData] = useState<ReactivationData | null>(null)
  const [settings, setSettings] = useState<Settings>(defaultSettings())
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  )
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  )
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [overrideReason, setOverrideReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedTemplate = useMemo(
    () =>
      data?.templates.find((template) => template.id === selectedTemplateId),
    [data?.templates, selectedTemplateId],
  )

  const selectedCustomer = useMemo(
    () =>
      data?.enrollments.find(
        (enrollment) => enrollment.customer_id === selectedCustomerId,
      ),
    [data?.enrollments, selectedCustomerId],
  )

  const filteredEnrollments = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.enrollments || []).filter((enrollment) => {
      const customer = unwrap(enrollment.ops_customers)
      const haystack = [
        customer?.full_name || '',
        customer?.email || '',
        customer?.phone || '',
        enrollment.status,
        enrollment.enrollment_source,
      ]
        .join(' ')
        .toLowerCase()
      return (
        (!q || haystack.includes(q)) &&
        (!statusFilter || enrollment.status === statusFilter)
      )
    })
  }, [data?.enrollments, search, statusFilter])

  async function loadData() {
    setError(null)
    const res = await fetch('/api/admin/comms/reactivation', {
      cache: 'no-store',
    })
    const next = await res.json()
    if (!res.ok) throw new Error(next.error || 'Failed to load reactivation')
    setData(next)
    setSettings(next.settings || defaultSettings())
    if (!selectedTemplateId && next.templates?.[0]?.id) {
      setSelectedTemplateId(next.templates[0].id)
    }
  }

  useEffect(() => {
    loadData()
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveSettings() {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/comms/reactivation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'settings', ...settings }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save settings')
      setNotice('Reactivation settings saved.')
      await loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function saveTemplate(template: Template) {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/comms/reactivation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'template', ...template }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save template')
      setNotice('Template saved.')
      await loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  async function runAction(action: string) {
    setRunning(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/comms/reactivation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Action failed')
      setNotice(
        action === 'run_now'
          ? `Run complete: ${result.result?.sent || 0} sent, ${result.result?.skipped || 0} skipped.`
          : 'Audience recalculated.',
      )
      await loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setRunning(false)
    }
  }

  async function overrideCustomer(
    overrideAction: 'pause' | 'suppress' | 'resume' | 'unsubscribe',
    customerId = selectedCustomerId,
    reason = overrideReason,
  ) {
    if (!customerId) return
    setRunning(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/comms/reactivation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'manual_override',
          override_action: overrideAction,
          customer_id: customerId,
          reason,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Override failed')
      setNotice('Customer reactivation status updated.')
      setOverrideReason('')
      await loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Override failed')
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return (
      <Card className="p-6 text-sm text-white/50">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Loading reactivation controls...
      </Card>
    )
  }

  const stats = data?.stats || {}

  return (
    <div className="space-y-4">
      <Card className="border-emerald-500/20 bg-emerald-500/5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">
                Reactivation Control Center
              </h2>
              <Badge variant={settings.engine_enabled ? 'default' : 'outline'}>
                {settings.engine_enabled ? 'Active' : 'Paused'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-white/50">
              Automatic monthly email nurture for dormant customers.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={settings.engine_enabled ? 'outline' : 'default'}
              size="sm"
              disabled={saving}
              onClick={() =>
                setSettings((prev) => ({
                  ...prev,
                  engine_enabled: !prev.engine_enabled,
                }))
              }
            >
              {settings.engine_enabled ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {settings.engine_enabled ? 'Pause Engine' : 'Resume Engine'}
            </Button>
            <Button size="sm" onClick={saveSettings} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Controls
            </Button>
          </div>
        </div>

        {(error || notice) && (
          <div
            className={`mt-4 rounded-md border p-3 text-sm ${
              error
                ? 'border-red-500/30 bg-red-500/10 text-red-200'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
            }`}
          >
            {error || notice}
          </div>
        )}

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <Users className="mb-2 h-4 w-4 text-emerald-300" />
            <div className="text-2xl font-semibold">{stats.active || 0}</div>
            <div className="text-xs text-white/45">Active customers</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <Clock className="mb-2 h-4 w-4 text-cyan-300" />
            <div className="text-2xl font-semibold">
              {stats.paused_recent_booking || 0}
            </div>
            <div className="text-xs text-white/45">Paused after booking</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <Ban className="mb-2 h-4 w-4 text-red-300" />
            <div className="text-2xl font-semibold">
              {(stats.suppressed_unsubscribed || 0) +
                (stats.suppressed_manual || 0)}
            </div>
            <div className="text-xs text-white/45">Suppressed</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <Mail className="mb-2 h-4 w-4 text-amber-300" />
            <div className="text-2xl font-semibold">
              {settings.daily_send_cap}
            </div>
            <div className="text-xs text-white/45">Daily send cap</div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-4">
          <label className="space-y-1 text-xs text-white/50">
            Daily send cap
            <Input
              type="number"
              min={0}
              max={500}
              value={settings.daily_send_cap}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  daily_send_cap: Number(e.target.value),
                }))
              }
            />
          </label>
          <label className="space-y-1 text-xs text-white/50">
            Cadence days
            <Input
              type="number"
              min={7}
              max={120}
              value={settings.cadence_days}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  cadence_days: Number(e.target.value),
                }))
              }
            />
          </label>
          <label className="space-y-1 text-xs text-white/50">
            Dormancy months
            <Input
              type="number"
              min={1}
              max={36}
              value={settings.dormancy_months}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  dormancy_months: Number(e.target.value),
                }))
              }
            />
          </label>
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              className="w-full"
              disabled={running}
              onClick={() => runAction('recalculate_audience')}
            >
              <RotateCw className="h-4 w-4" />
              Recalculate
            </Button>
            <Button
              className="w-full"
              disabled={running}
              onClick={() => runAction('run_now')}
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              Run Now
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-semibold">Offer Controls</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs text-white/50">
              Default offer
              <Input
                value={settings.default_offer}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    default_offer: e.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-xs text-white/50">
              Strong offer
              <Input
                value={settings.strong_offer}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    strong_offer: e.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-xs text-white/50">
              Strong offer expires
              <Input
                type="date"
                value={settings.strong_offer_expires_at || ''}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    strong_offer_expires_at: e.target.value || null,
                  }))
                }
              />
            </label>
            <label className="flex items-center gap-2 pt-6 text-sm text-white/70">
              <Checkbox
                checked={settings.strong_offer_enabled}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    strong_offer_enabled: checked === true,
                  }))
                }
              />
              Use stronger schedule-fill offer
            </label>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold">Recent Reactivation Activity</h3>
          <div className="mt-4 space-y-2">
            {(data?.log || []).slice(0, 6).map((entry) => {
              const customer = unwrap(entry.ops_customers)
              return (
                <div
                  key={entry.id}
                  className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">
                      {customer?.full_name || entry.to_email || 'System event'}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white/35">
                        {formatDateTime(entry.sent_at)}
                      </span>
                      {entry.customer_id && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={running}
                          onClick={() =>
                            overrideCustomer(
                              'suppress',
                              entry.customer_id,
                              'Suppressed from recent activity',
                            )
                          }
                        >
                          Suppress
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-white/50">
                    {entry.event_type} · {entry.status}
                    {entry.template_key ? ` · ${entry.template_key}` : ''}
                  </p>
                </div>
              )
            })}
            {(data?.log || []).length === 0 && (
              <p className="text-sm text-white/40">
                No reactivation activity logged yet.
              </p>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Message Rotation</h3>
            <Badge variant="outline">
              {(data?.templates || []).filter((t) => t.is_enabled).length}{' '}
              active
            </Badge>
          </div>
          <div className="mt-4 space-y-2">
            {(data?.templates || []).map((template) => (
              <button
                key={template.id}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  selectedTemplateId === template.id
                    ? 'border-emerald-400/60 bg-emerald-500/10'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
                onClick={() => setSelectedTemplateId(template.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{template.label}</span>
                  <Badge variant={template.is_enabled ? 'default' : 'outline'}>
                    {template.is_enabled ? 'On' : 'Off'}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-xs text-white/45">
                  {template.subject_template}
                </p>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          {selectedTemplate ? (
            <TemplateEditor
              template={selectedTemplate}
              saving={saving}
              onChange={(next) => {
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        templates: prev.templates.map((template) =>
                          template.id === next.id ? next : template,
                        ),
                      }
                    : prev,
                )
              }}
              onSave={saveTemplate}
            />
          ) : (
            <p className="text-sm text-white/40">Select a template to edit.</p>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="font-semibold">Dynamic Customer Pool</h3>
            <p className="text-sm text-white/45">
              Showing active sendable customers by default. Use the status
              filter to review paused, suppressed, or excluded customers.
            </p>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-white/35" />
              <Input
                className="pl-8"
                placeholder="Search customer or email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="active">Active - getting emails</option>
              <option value="paused_recent_booking">
                Paused - recent booking
              </option>
              <option value="post_job_drip">Post-job drip</option>
              <option value="suppressed_manual">Suppressed manually</option>
              <option value="suppressed_blacklisted">
                Suppressed blacklisted
              </option>
              <option value="suppressed_unsubscribed">
                Suppressed unsubscribed
              </option>
              {Array.from(
                new Set((data?.enrollments || []).map((row) => row.status)),
              )
                .filter(
                  (status) =>
                    ![
                      'active',
                      'paused_recent_booking',
                      'post_job_drip',
                      'suppressed_manual',
                      'suppressed_blacklisted',
                      'suppressed_unsubscribed',
                    ].includes(status),
                )
                .map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="max-h-[520px] space-y-2 overflow-auto pr-1">
            {filteredEnrollments.map((enrollment) => {
              const customer = unwrap(enrollment.ops_customers)
              return (
                <div
                  key={enrollment.id}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selectedCustomerId === enrollment.customer_id
                      ? 'border-cyan-400/60 bg-cyan-500/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                  onClick={() => setSelectedCustomerId(enrollment.customer_id)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {customer?.full_name || customer?.email || 'Unknown'}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusVariant(enrollment.status)}>
                        {statusLabel(enrollment.status)}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={running}
                        onClick={(event) => {
                          event.stopPropagation()
                          overrideCustomer(
                            'suppress',
                            enrollment.customer_id,
                            'Suppressed from customer pool',
                          )
                        }}
                      >
                        Suppress
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-white/45 md:grid-cols-3">
                    <span>{customer?.email || 'No email'}</span>
                    <span>Next: {formatDate(enrollment.next_send_at)}</span>
                    <span>
                      Latest job: {formatDate(enrollment.latest_appointment_at)}
                    </span>
                  </div>
                </div>
              )
            })}
            {filteredEnrollments.length === 0 && (
              <p className="rounded-lg border border-white/10 p-8 text-center text-sm text-white/40">
                No customers match these filters.
              </p>
            )}
          </div>

          <CustomerDrawer
            enrollment={selectedCustomer}
            reason={overrideReason}
            onReasonChange={setOverrideReason}
            running={running}
            onOverride={(action) => overrideCustomer(action)}
          />
        </div>
      </Card>
    </div>
  )
}

function TemplateEditor({
  template,
  saving,
  onChange,
  onSave,
}: {
  template: Template
  saving: boolean
  onChange: (template: Template) => void
  onSave: (template: Template) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Edit Template</h3>
          <p className="text-sm text-white/45">{template.template_key}</p>
        </div>
        <Button size="sm" disabled={saving} onClick={() => onSave(template)}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Template
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_120px]">
        <label className="space-y-1 text-xs text-white/50">
          Label
          <Input
            value={template.label}
            onChange={(e) => onChange({ ...template, label: e.target.value })}
          />
        </label>
        <label className="space-y-1 text-xs text-white/50">
          Order
          <Input
            type="number"
            value={template.rotation_order}
            onChange={(e) =>
              onChange({ ...template, rotation_order: Number(e.target.value) })
            }
          />
        </label>
      </div>

      <label className="space-y-1 text-xs text-white/50">
        Subject
        <Input
          value={template.subject_template}
          onChange={(e) =>
            onChange({ ...template, subject_template: e.target.value })
          }
        />
      </label>

      <label className="space-y-1 text-xs text-white/50">
        Body
        <Textarea
          className="min-h-[260px]"
          value={template.body_template}
          onChange={(e) =>
            onChange({ ...template, body_template: e.target.value })
          }
        />
      </label>

      <div className="flex flex-wrap gap-4 text-sm text-white/70">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={template.is_enabled}
            onCheckedChange={(checked) =>
              onChange({ ...template, is_enabled: checked === true })
            }
          />
          Enabled
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={template.is_strong_offer}
            onCheckedChange={(checked) =>
              onChange({ ...template, is_strong_offer: checked === true })
            }
          />
          Strong offer template
        </label>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/45">
        Variables: {'{{first_name}}'}, {'{{full_name}}'}, {'{{city}}'},{' '}
        {'{{booking_url}}'}, {'{{default_offer}}'}, {'{{strong_offer}}'}
      </div>
    </div>
  )
}

function CustomerDrawer({
  enrollment,
  reason,
  onReasonChange,
  running,
  onOverride,
}: {
  enrollment: Enrollment | undefined
  reason: string
  onReasonChange: (value: string) => void
  running: boolean
  onOverride: (action: 'pause' | 'suppress' | 'resume' | 'unsubscribe') => void
}) {
  if (!enrollment) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-5 text-sm text-white/40">
        Select a customer to see controls and hidden history details.
      </div>
    )
  }

  const customer = unwrap(enrollment.ops_customers)

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold">
            {customer?.full_name || customer?.email || 'Customer'}
          </h4>
          <p className="text-xs text-white/45">{customer?.email}</p>
        </div>
        <Badge variant={statusVariant(enrollment.status)}>
          {statusLabel(enrollment.status)}
        </Badge>
      </div>

      <div className="mt-4 space-y-2 text-xs text-white/55">
        <div className="flex justify-between gap-3">
          <span>Messages sent</span>
          <span>{enrollment.messages_sent}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Last sent</span>
          <span>{formatDateTime(enrollment.last_sent_at)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Next send</span>
          <span>{formatDate(enrollment.next_send_at)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Paused until</span>
          <span>{formatDate(enrollment.paused_until)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Latest job</span>
          <span>{formatDate(enrollment.latest_appointment_at)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Source</span>
          <span className="text-right">{enrollment.enrollment_source}</span>
        </div>
      </div>

      {(enrollment.stop_reason ||
        enrollment.manual_suppression_reason ||
        enrollment.override_notes) && (
        <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3 text-xs text-white/60">
          {enrollment.stop_reason && <p>Stop: {enrollment.stop_reason}</p>}
          {enrollment.manual_suppression_reason && (
            <p>Manual reason: {enrollment.manual_suppression_reason}</p>
          )}
          {enrollment.override_notes && (
            <p>Note: {enrollment.override_notes}</p>
          )}
        </div>
      )}

      <label className="mt-4 block space-y-1 text-xs text-white/50">
        Override note
        <Textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Why are we changing this customer's status?"
        />
      </label>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={running}
          onClick={() => onOverride('pause')}
        >
          <Pause className="h-4 w-4" />
          Pause
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={running}
          onClick={() => onOverride('resume')}
        >
          <CheckCircle className="h-4 w-4" />
          Resume
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={running}
          onClick={() => onOverride('suppress')}
        >
          <ShieldOff className="h-4 w-4" />
          Suppress
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={running}
          onClick={() => onOverride('unsubscribe')}
        >
          <Ban className="h-4 w-4" />
          Unsubscribe
        </Button>
      </div>
    </div>
  )
}
