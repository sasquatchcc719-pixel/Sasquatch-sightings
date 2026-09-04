'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CalendarPlus,
  Camera,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type ConcernStatus =
  | 'awaiting_customer'
  | 'ready_for_review'
  | 'approved_return'
  | 'resolved'
  | 'declined'

type ConcernCategory =
  | 'unclassified'
  | 'visible_spot'
  | 'odor'
  | 'excess_moisture'
  | 'texture'
  | 'pricing'
  | 'technician'
  | 'damage'
  | 'other'

type Customer = {
  full_name: string | null
  business_name: string | null
  phone: string | null
  email: string | null
}

type Address = {
  street_1: string | null
  city: string | null
  state: string | null
  zip_code: string | null
}

type Appointment = {
  appointment_date: string
  completed_at: string | null
  status: string
  ops_service_addresses: Address | Address[] | null
}

type ReturnAppointment = {
  id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: string
}

type Concern = {
  id: string
  customer_id: string
  appointment_id: string | null
  conversation_id: string | null
  status: ConcernStatus
  category: ConcernCategory
  source: string
  initial_message: string | null
  internal_notes: string | null
  resolution_notes: string | null
  intake_sms_sent_at: string | null
  last_customer_message_at: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  ops_customers: Customer | Customer[] | null
  ops_appointments: Appointment | Appointment[] | null
  return_appointments: ReturnAppointment | ReturnAppointment[] | null
  media: Array<{
    id: string
    contentType: string
    status: string
    createdAt: string
    signedUrl: string | null
  }>
}

type CustomerSearchResult = {
  id: string
  full_name: string
  business_name: string | null
  phone: string | null
  jobs?: Array<{
    id: string
    status: string
    appointment_date: string
    ops_service_addresses:
      | { street_1: string; city: string }
      | Array<{ street_1: string; city: string }>
      | null
  }>
}

const ACTIVE_STATUSES = new Set<ConcernStatus>([
  'awaiting_customer',
  'ready_for_review',
  'approved_return',
])

const STATUS_LABELS: Record<ConcernStatus, string> = {
  awaiting_customer: 'Waiting for customer',
  ready_for_review: 'Ready for review',
  approved_return: 'Return approved',
  resolved: 'Resolved',
  declined: 'Not warranty',
}

const CATEGORY_LABELS: Record<ConcernCategory, string> = {
  unclassified: 'Not classified',
  visible_spot: 'Visible spot / stain',
  odor: 'Odor',
  excess_moisture: 'Excess moisture',
  texture: 'Texture / stiffness',
  pricing: 'Pricing',
  technician: 'Technician concern',
  damage: 'Possible damage',
  other: 'Other',
}

function unwrap<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value
}

function displayDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Denver',
  }).format(new Date(value))
}

function statusClass(status: ConcernStatus): string {
  if (status === 'ready_for_review') return 'bg-amber-500 text-black'
  if (status === 'approved_return') return 'bg-blue-600 text-white'
  if (status === 'resolved') return 'bg-emerald-600 text-white'
  if (status === 'declined') return 'bg-slate-600 text-white'
  return 'bg-purple-600 text-white'
}

function PhoneConcernIntake({
  onCreated,
}: {
  onCreated: (concern: Concern) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerSearchResult[]>([])
  const [customer, setCustomer] = useState<CustomerSearchResult | null>(null)
  const [appointmentId, setAppointmentId] = useState('')
  const [category, setCategory] = useState<ConcernCategory>('unclassified')
  const [summary, setSummary] = useState('')
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const completedJobs = (customer?.jobs || []).filter(
    (job) => job.status === 'completed',
  )

  useEffect(() => {
    if (!query.trim() || customer) {
      setResults([])
      return
    }
    const timeout = window.setTimeout(async () => {
      setSearching(true)
      try {
        const response = await fetch(
          `/api/admin/ops/customers?q=${encodeURIComponent(query)}`,
          { cache: 'no-store' },
        )
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Search failed')
        setResults(payload.customers || [])
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Search failed')
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [customer, query])

  const chooseCustomer = (next: CustomerSearchResult) => {
    const jobs = (next.jobs || []).filter((job) => job.status === 'completed')
    setCustomer(next)
    setQuery(next.business_name || next.full_name)
    setAppointmentId(jobs[0]?.id || '')
    setResults([])
    setMessage(null)
  }

  const submit = async () => {
    if (!customer || !appointmentId || !summary.trim()) {
      setMessage(
        'Choose the customer, original completed job, and add a call summary.',
      )
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch('/api/admin/ops/service-concerns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customer.id,
          appointment_id: appointmentId,
          category,
          summary,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'The phone call could not be logged.')
      }
      onCreated(payload.concern)
      setMessage(
        payload.intake_error
          ? `Case saved, but the photo-request text failed: ${payload.intake_error}`
          : payload.created
            ? 'Case saved and the photo-request text was sent.'
            : 'This customer already had an open case. It is shown below; the intake text was not duplicated.',
      )
      setCustomer(null)
      setQuery('')
      setAppointmentId('')
      setCategory('unclassified')
      setSummary('')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The phone call could not be logged.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-cyan-500/25 bg-cyan-500/5 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-cyan-500/15 p-2 text-cyan-300">
          <PhoneCall className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-semibold">Log a concern from a phone call</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Link the original job and send the standard photo-request text from
            the business line.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="relative">
          <label
            htmlFor="concern-customer"
            className="mb-1 block text-xs font-medium"
          >
            Customer
          </label>
          <Input
            id="concern-customer"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setCustomer(null)
              setAppointmentId('')
            }}
            placeholder="Search name, phone, or email"
          />
          {searching ? (
            <Loader2 className="text-muted-foreground absolute top-8 right-3 h-4 w-4 animate-spin" />
          ) : null}
          {results.length > 0 ? (
            <div className="bg-popover absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border shadow-lg">
              {results.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  className="hover:bg-accent block w-full px-3 py-2 text-left text-sm"
                  onClick={() => chooseCustomer(result)}
                >
                  <span className="font-medium">
                    {result.business_name || result.full_name}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {result.phone || 'No phone'}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="concern-job"
            className="mb-1 block text-xs font-medium"
          >
            Original completed job
          </label>
          <select
            id="concern-job"
            value={appointmentId}
            onChange={(event) => setAppointmentId(event.target.value)}
            disabled={!customer}
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
          >
            <option value="">
              {customer && completedJobs.length === 0
                ? 'No completed jobs found'
                : 'Select completed job'}
            </option>
            {completedJobs.map((job) => {
              const address = unwrap(job.ops_service_addresses)
              return (
                <option key={job.id} value={job.id}>
                  {job.appointment_date}
                  {address ? ` · ${address.street_1}, ${address.city}` : ''}
                </option>
              )
            })}
          </select>
        </div>

        <div>
          <label
            htmlFor="concern-category"
            className="mb-1 block text-xs font-medium"
          >
            Concern type
          </label>
          <select
            id="concern-category"
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as ConcernCategory)
            }
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-2">
          <label
            htmlFor="concern-summary"
            className="mb-1 block text-xs font-medium"
          >
            What the customer reported
          </label>
          <Textarea
            id="concern-summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Capture the area, symptom, timing, and anything already tried."
          />
        </div>
      </div>
      {message ? <p className="mt-3 text-sm text-cyan-100">{message}</p> : null}
      <Button className="mt-4" onClick={submit} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Save case and request photos
      </Button>
    </Card>
  )
}

function ConcernCard({
  concern,
  onSaved,
}: {
  concern: Concern
  onSaved: (next: Concern) => void
}) {
  const [status, setStatus] = useState<ConcernStatus>(concern.status)
  const [category, setCategory] = useState<ConcernCategory>(concern.category)
  const [internalNotes, setInternalNotes] = useState(
    concern.internal_notes || '',
  )
  const [resolutionNotes, setResolutionNotes] = useState(
    concern.resolution_notes || '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const customer = unwrap(concern.ops_customers)
  const appointment = unwrap(concern.ops_appointments)
  const returnAppointment = unwrap(concern.return_appointments)
  const address = unwrap(appointment?.ops_service_addresses || null)
  const customerName =
    customer?.business_name || customer?.full_name || 'Unknown customer'
  const dirty =
    status !== concern.status ||
    category !== concern.category ||
    internalNotes !== (concern.internal_notes || '') ||
    resolutionNotes !== (concern.resolution_notes || '')

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/ops/service-concerns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: concern.id,
          status,
          category,
          internal_notes: internalNotes,
          resolution_notes: resolutionNotes,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'The concern could not be saved.')
      }
      onSaved({ ...concern, ...payload.concern, media: concern.media })
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'The concern could not be saved.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="overflow-hidden border-white/10 bg-slate-950/70 shadow-xl">
      <div className="border-b border-white/10 bg-gradient-to-r from-slate-900 to-slate-950 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-white">
                {customerName}
              </h2>
              <Badge className={statusClass(concern.status)}>
                {STATUS_LABELS[concern.status]}
              </Badge>
              {concern.media.length > 0 ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-cyan-400/40 text-cyan-200"
                >
                  <Camera className="h-3 w-3" /> {concern.media.length} photo
                  {concern.media.length === 1 ? '' : 's'}
                </Badge>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              <span>Opened {displayDate(concern.created_at)}</span>
              {appointment ? (
                <span>Job {appointment.appointment_date}</span>
              ) : (
                <span className="text-amber-300">No completed job linked</span>
              )}
              {address ? (
                <span>
                  {[address.street_1, address.city].filter(Boolean).join(', ')}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {concern.appointment_id ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={`/admin/operations/appointments/${concern.appointment_id}`}
                >
                  Original job <ExternalLink className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null}
            {customer?.phone ? (
              <Button asChild size="sm" variant="outline">
                <a href={`sms:${customer.phone}`}>Text customer</a>
              </Button>
            ) : null}
            {concern.status === 'approved_return' && !returnAppointment ? (
              <Button asChild size="sm">
                <Link
                  href={`/admin/operations/new-job?service_concern_id=${concern.id}`}
                >
                  <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Schedule return
                </Link>
              </Button>
            ) : null}
            {returnAppointment ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={`/admin/operations/appointments/${returnAppointment.id}`}
                >
                  Return {returnAppointment.appointment_date}{' '}
                  {returnAppointment.start_time.slice(0, 5)}
                  <ExternalLink className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
              Customer concern
            </p>
            <p className="mt-1 text-sm leading-6 whitespace-pre-wrap text-slate-100">
              {concern.initial_message || 'No message was captured.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Category
              </label>
              <Select
                value={category}
                onValueChange={(value) => setCategory(value as ConcernCategory)}
              >
                <SelectTrigger className="border-white/15 bg-slate-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Decision
              </label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as ConcernStatus)}
              >
                <SelectTrigger className="border-white/15 bg-slate-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              Internal assessment
            </label>
            <Textarea
              value={internalNotes}
              onChange={(event) => setInternalNotes(event.target.value)}
              placeholder="What the photos and original job show; questions still outstanding…"
              className="border-white/15 bg-slate-900"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              Resolution / reason
            </label>
            <Textarea
              value={resolutionNotes}
              onChange={(event) => setResolutionNotes(event.target.value)}
              placeholder="Why a return was approved, declined, or how the concern was resolved…"
              className="border-white/15 bg-slate-900"
            />
          </div>

          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save assessment
          </Button>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
              Intake status
            </p>
            <div className="mt-3 space-y-2 text-sm text-slate-200">
              <p className="flex items-center gap-2">
                {concern.intake_sms_sent_at ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                )}
                {concern.intake_sms_sent_at
                  ? `Intake requested ${displayDate(concern.intake_sms_sent_at)}`
                  : 'Intake text has not been sent'}
              </p>
              <p className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-cyan-400" />
                {concern.last_customer_message_at
                  ? `Customer replied ${displayDate(concern.last_customer_message_at)}`
                  : 'Waiting for the customer to reply'}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
              Customer evidence
            </p>
            {concern.media.length === 0 ? (
              <div className="mt-2 rounded-xl border border-dashed border-white/15 p-6 text-center text-sm text-slate-400">
                No photos attached yet.
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {concern.media.map((media) => (
                  <a
                    key={media.id}
                    href={media.signedUrl || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-lg border border-white/10 bg-slate-900"
                  >
                    {media.signedUrl &&
                    media.contentType.startsWith('image/') ? (
                      // Customer evidence is private and uses a short-lived signed URL.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={media.signedUrl}
                        alt="Customer-provided service concern"
                        className="aspect-square w-full object-cover transition group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex aspect-square items-center justify-center text-xs text-slate-400">
                        Attachment
                      </div>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

export default function ServiceConcernsPage() {
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [filter, setFilter] = useState<'open' | 'all' | 'closed'>('open')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/ops/service-concerns', {
        cache: 'no-store',
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(
          payload.error || 'Service concerns could not be loaded.',
        )
      }
      setConcerns(payload.concerns || [])
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Service concerns could not be loaded.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    if (filter === 'all') return concerns
    if (filter === 'open') {
      return concerns.filter((concern) => ACTIVE_STATUSES.has(concern.status))
    }
    return concerns.filter((concern) => !ACTIVE_STATUSES.has(concern.status))
  }, [concerns, filter])

  const awaiting = concerns.filter(
    (concern) => concern.status === 'awaiting_customer',
  ).length
  const ready = concerns.filter(
    (concern) => concern.status === 'ready_for_review',
  ).length
  const approved = concerns.filter(
    (concern) => concern.status === 'approved_return',
  ).length

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pb-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldCheck className="h-6 w-6 text-emerald-400" /> Service
            Concerns
          </h1>
          <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
            Review the customer&apos;s explanation and evidence before approving
            a warranty return. Nothing here places a visit on the calendar.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw
            className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-purple-500/30 bg-purple-500/10 p-4">
          <p className="text-xs font-medium text-purple-200">
            Waiting on customer
          </p>
          <p className="mt-1 text-3xl font-bold">{awaiting}</p>
        </Card>
        <Card className="border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-xs font-medium text-amber-200">Ready for review</p>
          <p className="mt-1 text-3xl font-bold">{ready}</p>
        </Card>
        <Card className="border-blue-500/30 bg-blue-500/10 p-4">
          <p className="text-xs font-medium text-blue-200">Returns approved</p>
          <p className="mt-1 text-3xl font-bold">{approved}</p>
        </Card>
      </div>

      <PhoneConcernIntake
        onCreated={(concern) =>
          setConcerns((current) => [
            concern,
            ...current.filter((item) => item.id !== concern.id),
          ])
        }
      />

      <div className="flex gap-2">
        {(['open', 'all', 'closed'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? 'default' : 'outline'}
            onClick={() => setFilter(value)}
          >
            {value === 'open' ? 'Open' : value === 'closed' ? 'Closed' : 'All'}
          </Button>
        ))}
      </div>

      {error ? (
        <Card className="border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </Card>
      ) : loading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading service concerns…
        </p>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed p-8 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-emerald-400" />
          <p className="mt-3 font-medium">No {filter} service concerns</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Use the phone-call form above, or click “Start service concern” in a
            customer&apos;s Telegram topic.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((concern) => (
            <ConcernCard
              key={concern.id}
              concern={concern}
              onSaved={(next) =>
                setConcerns((current) =>
                  current.map((item) => (item.id === next.id ? next : item)),
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
