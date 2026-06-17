'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  CheckCircle,
  ChevronLeft,
  ClipboardList,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Repeat,
  Save,
  Trash2,
  Truck,
  User,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

// ─── Types ───────────────────────────────────────────────────────────────────

type LineItem = {
  id?: string
  service_catalog_item_id?: string | null
  name_snapshot: string
  quantity: number
  unit_price: number
  duration_minutes: number
  line_total: number
  notes?: string | null
}

type LocalLineItem = {
  id?: string
  service_catalog_item_id?: string | null
  name_snapshot: string
  quantity: string
  unit_price: string
  duration_minutes: string
  notes: string
}

type VisitData = {
  appointment: {
    id: string
    appointment_date: string
    start_time: string
    end_time: string
    status: string
    quoted_total: number
    on_my_way_at?: string | null
    completed_at?: string | null
    internal_notes?: string | null
    recurring_template_id: string
    ops_customers:
      | {
          id: string
          full_name: string
          first_name?: string | null
          last_name?: string | null
          business_name?: string | null
          email?: string | null
          phone?: string | null
          notes?: string | null
        }
      | null
      | Array<{
          id: string
          full_name: string
          first_name?: string | null
          last_name?: string | null
          business_name?: string | null
          email?: string | null
          phone?: string | null
          notes?: string | null
        }>
    ops_service_addresses:
      | {
          id: string
          label?: string | null
          street_1: string
          street_2?: string | null
          city: string
          state: string
          zip_code: string
          gate_code?: string | null
          notes?: string | null
        }
      | null
      | Array<{
          id: string
          label?: string | null
          street_1: string
          street_2?: string | null
          city: string
          state: string
          zip_code: string
          gate_code?: string | null
          notes?: string | null
        }>
    ops_appointment_line_items: LineItem[]
  }
  template: {
    id: string
    label: string
    invoice_mode: string
    internal_notes?: string | null
    line_items?: unknown[]
  }
}

type CatalogItem = {
  id: string
  name: string
  category?: string | null
  base_price?: number | null
  default_duration_minutes?: number | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function unwrapOne<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n)
}

function timeToMinutes(value: string): number {
  const [h, m] = String(value).slice(0, 5).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RecurringVisitDetail({
  appointmentId,
}: {
  appointmentId: string
}) {
  const router = useRouter()

  const [data, setData] = useState<VisitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [status, setStatus] = useState('')
  const [lineItems, setLineItems] = useState<LocalLineItem[]>([])
  const [editingLines, setEditingLines] = useState(false)
  const [savingLines, setSavingLines] = useState(false)
  const [scheduleForm, setScheduleForm] = useState({
    appointment_date: '',
    start_time: '',
    end_time: '',
  })
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [notifyingSchedule, setNotifyingSchedule] = useState(false)
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [visitNotes, setVisitNotes] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const [driveStartMs, setDriveStartMs] = useState<number | null>(null)
  const [driveElapsed, setDriveElapsed] = useState(0)

  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [pickerCategory, setPickerCategory] = useState<string | null>(null)

  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Load visit data ───────────────────────────────────────────────────────

  const loadVisit = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/ops/recurring/visit/${appointmentId}`)
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to load visit')
      }
      const d: VisitData = await res.json()
      setData(d)
      setStatus(d.appointment.status)
      setVisitNotes(d.appointment.internal_notes ?? '')
      setScheduleForm({
        appointment_date: d.appointment.appointment_date,
        start_time: String(d.appointment.start_time).slice(0, 5),
        end_time: String(d.appointment.end_time).slice(0, 5),
      })
      setLineItems(
        (d.appointment.ops_appointment_line_items || []).map((l) => ({
          id: l.id,
          service_catalog_item_id: l.service_catalog_item_id ?? null,
          name_snapshot: l.name_snapshot,
          quantity: String(l.quantity),
          unit_price: String(l.unit_price),
          duration_minutes: String(l.duration_minutes),
          notes: l.notes ?? '',
        })),
      )
      // Restore drive timer from session
      if (d.appointment.status === 'on_my_way') {
        const raw = sessionStorage.getItem(`omw_recurring_${d.appointment.id}`)
        if (raw && Number.isFinite(Number(raw))) {
          setDriveStartMs(Number(raw))
        } else if (d.appointment.on_my_way_at) {
          setDriveStartMs(new Date(d.appointment.on_my_way_at).getTime())
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [appointmentId])

  useEffect(() => {
    void loadVisit()
  }, [loadVisit])

  // Catalog
  useEffect(() => {
    fetch('/api/admin/ops/services')
      .then((r) => r.json())
      .then((d) => setCatalog(d.services || []))
      .catch(() => {})
  }, [])

  // Drive timer
  useEffect(() => {
    if (status !== 'on_my_way' || driveStartMs == null) {
      setDriveElapsed(0)
      return
    }
    const tick = () => setDriveElapsed(Date.now() - driveStartMs)
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [status, driveStartMs])

  // ─── Actions ───────────────────────────────────────────────────────────────

  const patchAppointment = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/ops/appointments/${appointmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const d = await res.json()
      throw new Error(d.error || 'Update failed')
    }
    return res.json()
  }

  const handleSaveSchedule = async () => {
    setSavingSchedule(true)
    setScheduleError(null)
    setScheduleMessage(null)
    try {
      if (!scheduleForm.appointment_date) {
        throw new Error('Pick a new date for this visit.')
      }
      if (!scheduleForm.start_time || !scheduleForm.end_time) {
        throw new Error('Start and end time are required.')
      }
      if (
        timeToMinutes(scheduleForm.end_time) <=
        timeToMinutes(scheduleForm.start_time)
      ) {
        throw new Error('End time must be after start time.')
      }

      const result = (await patchAppointment(scheduleForm)) as {
        appointment?: Partial<VisitData['appointment']>
      }

      setData((current) =>
        current
          ? {
              ...current,
              appointment: {
                ...current.appointment,
                ...result.appointment,
                appointment_date: scheduleForm.appointment_date,
                start_time: scheduleForm.start_time,
                end_time: scheduleForm.end_time,
              },
            }
          : current,
      )
      setScheduleMessage('Schedule updated for this visit only.')
      router.refresh()
    } catch (e) {
      setScheduleError(
        e instanceof Error ? e.message : 'Failed to update schedule',
      )
    } finally {
      setSavingSchedule(false)
    }
  }

  const handleNotifyScheduleChange = async () => {
    setNotifyingSchedule(true)
    setScheduleError(null)
    setScheduleMessage(null)
    try {
      const saved = data?.appointment
      if (
        !saved ||
        saved.appointment_date !== scheduleForm.appointment_date ||
        String(saved.start_time).slice(0, 5) !== scheduleForm.start_time ||
        String(saved.end_time).slice(0, 5) !== scheduleForm.end_time
      ) {
        throw new Error(
          'Save the schedule change before notifying the customer.',
        )
      }

      const res = await fetch(
        `/api/admin/ops/appointments/${appointmentId}/notify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'job_rescheduled' }),
        },
      )
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to notify customer')
      }
      setScheduleMessage('Customer notified of the schedule change.')
    } catch (e) {
      setScheduleError(
        e instanceof Error ? e.message : 'Failed to notify customer',
      )
    } finally {
      setNotifyingSchedule(false)
    }
  }

  const handleOnMyWay = async () => {
    const nextStatus = status === 'on_my_way' ? 'booked' : 'on_my_way'
    setActionLoading(nextStatus)
    try {
      await patchAppointment({
        status: nextStatus,
        ...(nextStatus === 'booked' ? { on_my_way_at: null } : {}),
      })
      setStatus(nextStatus)
      if (nextStatus === 'on_my_way') {
        const now = Date.now()
        setDriveStartMs(now)
        sessionStorage.setItem(`omw_recurring_${appointmentId}`, String(now))
      } else {
        setDriveStartMs(null)
        sessionStorage.removeItem(`omw_recurring_${appointmentId}`)
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCloseOut = async (skipCustomerCommunications = false) => {
    setActionLoading(
      skipCustomerCommunications ? 'quiet_completed' : 'completed',
    )
    try {
      await patchAppointment({
        status: 'completed',
        ...(skipCustomerCommunications
          ? { skip_customer_communications: true }
          : {}),
      })
      setStatus('completed')
      if (driveStartMs != null) {
        const driveMin = Math.round((Date.now() - driveStartMs) / 60000)
        sessionStorage.setItem(
          `omw_drive_min_recurring_${appointmentId}`,
          String(driveMin),
        )
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    } finally {
      setActionLoading(null)
    }
  }

  const handleSaveLines = async () => {
    setSavingLines(true)
    try {
      await patchAppointment({
        line_items: lineItems.map((l) => ({
          service_catalog_item_id: l.service_catalog_item_id || null,
          name_snapshot: l.name_snapshot,
          quantity: Number(l.quantity) || 1,
          unit_price: Number(l.unit_price) || 0,
          duration_minutes: Number(l.duration_minutes) || 60,
          notes: l.notes || null,
        })),
      })
      setEditingLines(false)
      void loadVisit()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSavingLines(false)
    }
  }

  const handleSaveNotes = async (value: string) => {
    try {
      await patchAppointment({ internal_notes: value })
    } catch {
      // silent — notes auto-save
    }
  }

  const debounceSaveNotes = (value: string) => {
    setVisitNotes(value)
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => void handleSaveNotes(value), 1000)
  }

  // ─── Derived ───────────────────────────────────────────────────────────────

  const subtotal = lineItems.reduce(
    (s, l) => s + (Number(l.unit_price) || 0) * (Number(l.quantity) || 0),
    0,
  )

  const formatElapsed = (ms: number) => {
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-3 p-8">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading visit…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-destructive p-8 text-sm">
        {error ?? 'Visit not found.'}
      </div>
    )
  }

  const { appointment, template } = data
  const customer = unwrapOne(appointment.ops_customers)
  const address = unwrapOne(appointment.ops_service_addresses)
  const isBatch = template.invoice_mode === 'batch_monthly'

  const dateStr = new Date(
    appointment.appointment_date + 'T12:00:00',
  ).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const timeStr = `${appointment.start_time?.slice(0, 5)} – ${appointment.end_time?.slice(0, 5)}`

  const statusLabel: Record<string, string> = {
    booked: 'Scheduled',
    confirmed: 'Confirmed',
    on_my_way: 'En Route',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }

  const statusColor: Record<string, string> = {
    booked: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    confirmed: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    on_my_way: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    completed: 'bg-green-500/20 text-green-300 border-green-500/30',
    cancelled: 'bg-red-500/20 text-red-300 border-red-500/30',
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
      {/* ── Back + Header ─────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.back()}
          className="shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Repeat className="h-3 w-3" />
              Recurring Visit
            </Badge>
            {isBatch && (
              <Badge variant="outline" className="text-xs">
                Batch Monthly
              </Badge>
            )}
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusColor[status] ?? ''}`}
            >
              {statusLabel[status] ?? status}
            </span>
          </div>
          <h1 className="mt-1.5 text-xl leading-tight font-bold">
            {template.label}
          </h1>
          <p className="text-muted-foreground text-sm">
            {dateStr} · {timeStr}
          </p>
        </div>
      </div>

      {/* ── Customer + Address ────────────────────────────── */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="grid gap-4 sm:grid-cols-2">
          {customer && (
            <div className="flex gap-3">
              <User className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="text-xs font-medium tracking-wide text-emerald-400/80 uppercase">
                  Customer
                </p>
                <p className="font-semibold">
                  {customer.business_name || customer.full_name}
                </p>
                {customer.business_name && (
                  <p className="text-muted-foreground text-sm">
                    {customer.full_name}
                  </p>
                )}
                {customer.phone && (
                  <a
                    href={`tel:${customer.phone}`}
                    className="text-sm text-emerald-400 hover:underline"
                  >
                    {customer.phone}
                  </a>
                )}
              </div>
            </div>
          )}
          {address && (
            <div className="flex gap-3">
              <MapPin className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="text-xs font-medium tracking-wide text-emerald-400/80 uppercase">
                  Address
                </p>
                <p className="font-semibold">{address.street_1}</p>
                {address.street_2 && (
                  <p className="text-muted-foreground text-sm">
                    {address.street_2}
                  </p>
                )}
                <p className="text-muted-foreground text-sm">
                  {address.city}, {address.state} {address.zip_code}
                </p>
                {address.gate_code && (
                  <p className="mt-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                    Gate / Access: {address.gate_code}
                  </p>
                )}
                {address.notes && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {address.notes}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ── Schedule Change ───────────────────────────────── */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Schedule Change</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Move this individual recurring visit without changing the rest of
            the series.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              Date
            </span>
            <input
              type="date"
              className="border-input bg-background h-10 w-full rounded-lg border px-3 text-sm"
              value={scheduleForm.appointment_date}
              onChange={(event) => {
                setScheduleMessage(null)
                setScheduleError(null)
                setScheduleForm((current) => ({
                  ...current,
                  appointment_date: event.target.value,
                }))
              }}
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              Start Time
            </span>
            <input
              type="time"
              className="border-input bg-background h-10 w-full rounded-lg border px-3 text-sm"
              value={scheduleForm.start_time}
              onChange={(event) => {
                setScheduleMessage(null)
                setScheduleError(null)
                setScheduleForm((current) => ({
                  ...current,
                  start_time: event.target.value,
                }))
              }}
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              End Time
            </span>
            <input
              type="time"
              className="border-input bg-background h-10 w-full rounded-lg border px-3 text-sm"
              value={scheduleForm.end_time}
              onChange={(event) => {
                setScheduleMessage(null)
                setScheduleError(null)
                setScheduleForm((current) => ({
                  ...current,
                  end_time: event.target.value,
                }))
              }}
            />
          </label>
        </div>
        {scheduleError && (
          <p className="text-destructive mt-3 text-sm">{scheduleError}</p>
        )}
        {scheduleMessage && (
          <p className="mt-3 text-sm text-emerald-400">{scheduleMessage}</p>
        )}
        {isBatch && (
          <p className="text-muted-foreground mt-3 text-xs">
            For monthly batch invoices, the visit is included based on the
            scheduled month it is completed in.
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button
            className="w-full gap-2 sm:w-auto"
            onClick={() => void handleSaveSchedule()}
            disabled={savingSchedule || notifyingSchedule}
          >
            {savingSchedule && <Loader2 className="h-4 w-4 animate-spin" />}
            {savingSchedule ? 'Saving Schedule…' : 'Save Schedule Change'}
          </Button>
          <Button
            variant="outline"
            className="w-full gap-2 sm:w-auto"
            onClick={() => void handleNotifyScheduleChange()}
            disabled={savingSchedule || notifyingSchedule}
          >
            {notifyingSchedule && <Loader2 className="h-4 w-4 animate-spin" />}
            {notifyingSchedule
              ? 'Notifying Customer…'
              : 'Notify Customer of Change'}
          </Button>
        </div>
      </Card>

      {/* ── Standing Instructions ─────────────────────────── */}
      {template.internal_notes && (
        <Card className="border-blue-500/30 bg-blue-500/10 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wide text-blue-400 uppercase">
                Standing Instructions
              </p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-blue-100">
                {template.internal_notes}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ── On My Way ─────────────────────────────────────── */}
      {status !== 'completed' && (
        <div className="border-border/60 bg-muted/30 rounded-xl border p-4">
          <Button
            variant="outline"
            className={`h-14 w-full text-base font-semibold ${
              status === 'on_my_way'
                ? 'border-blue-500 bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
                : ''
            }`}
            disabled={actionLoading !== null}
            onClick={() => void handleOnMyWay()}
          >
            {actionLoading === 'on_my_way' || actionLoading === 'booked' ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Truck className="mr-2 h-5 w-5" />
            )}
            {actionLoading === 'on_my_way' || actionLoading === 'booked'
              ? 'Updating…'
              : status === 'on_my_way'
                ? 'Back to Scheduled'
                : 'On My Way'}
          </Button>
          {status === 'on_my_way' && driveStartMs != null && (
            <p className="text-muted-foreground mt-2 text-center font-mono text-sm">
              {formatElapsed(driveElapsed)}
            </p>
          )}
        </div>
      )}

      {/* ── Job Completion ────────────────────────────────── */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">
          {status === 'completed' ? 'Job Closed Out' : 'Close Out Job'}
        </h3>
        {status === 'completed' ? (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-green-400">
            <CheckCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Job closed out</p>
              {appointment.completed_at && (
                <p className="text-sm opacity-75">
                  Completed at{' '}
                  {new Date(appointment.completed_at).toLocaleTimeString(
                    'en-US',
                    { hour: 'numeric', minute: '2-digit' },
                  )}
                  {appointment.on_my_way_at && (
                    <>
                      {' · '}
                      {Math.round(
                        (new Date(appointment.completed_at).getTime() -
                          new Date(appointment.on_my_way_at).getTime()) /
                          60000,
                      )}{' '}
                      min drive
                    </>
                  )}
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            {isBatch && (
              <p className="text-muted-foreground mt-2 text-sm">
                Marks this visit complete and logs it for the monthly batch
                invoice.
              </p>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Button
                className="h-14 border-green-600 bg-green-600 text-base font-semibold text-white hover:bg-green-700"
                disabled={actionLoading !== null}
                onClick={() => void handleCloseOut()}
              >
                {actionLoading === 'completed' ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <CheckCircle className="mr-2 h-5 w-5" />
                )}
                {actionLoading === 'completed'
                  ? 'Closing out…'
                  : 'Close Out Job'}
              </Button>
              <Button
                variant="outline"
                className="h-14 text-base font-semibold"
                disabled={actionLoading !== null}
                onClick={() => void handleCloseOut(true)}
              >
                {actionLoading === 'quiet_completed' ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <CheckCircle className="mr-2 h-5 w-5" />
                )}
                Quiet Close
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* ── Service Picker Modal ──────────────────────────── */}
      {showPicker && (
        <div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/50 sm:items-center">
          <div className="bg-card w-full max-w-sm rounded-t-2xl p-5 shadow-xl sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-base font-semibold">
                {pickerCategory ? pickerCategory : 'Select a category'}
              </h4>
              <button
                type="button"
                onClick={() => {
                  setShowPicker(false)
                  setPickerCategory(null)
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {pickerCategory === null ? (
              /* Step 1 — category list */
              <div className="max-h-[60vh] space-y-2 overflow-y-auto">
                {catalog.some((s) => s.category)
                  ? Array.from(
                      new Set(catalog.map((s) => s.category).filter(Boolean)),
                    )
                      .sort()
                      .map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          className="border-border/60 hover:bg-accent w-full rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors"
                          onClick={() => setPickerCategory(cat!)}
                        >
                          {cat}
                          <span className="text-muted-foreground ml-2 text-xs font-normal">
                            ({catalog.filter((s) => s.category === cat).length})
                          </span>
                        </button>
                      ))
                  : /* No categories — flat list */
                    catalog.map((svc) => (
                      <button
                        key={svc.id}
                        type="button"
                        className="border-border/60 hover:bg-accent flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-colors"
                        onClick={() => {
                          setLineItems((prev) => [
                            ...prev,
                            {
                              service_catalog_item_id: svc.id,
                              name_snapshot: svc.name,
                              quantity: '1',
                              unit_price:
                                svc.base_price != null
                                  ? String(svc.base_price)
                                  : '',
                              duration_minutes:
                                svc.default_duration_minutes != null
                                  ? String(svc.default_duration_minutes)
                                  : '60',
                              notes: '',
                            },
                          ])
                          setEditingLines(true)
                          setShowPicker(false)
                        }}
                      >
                        <span className="font-medium">{svc.name}</span>
                        {svc.base_price != null && (
                          <span className="text-muted-foreground text-xs">
                            ${svc.base_price}
                          </span>
                        )}
                      </button>
                    ))}
              </div>
            ) : (
              /* Step 2 — services in category */
              <div className="max-h-[60vh] space-y-2 overflow-y-auto">
                <button
                  type="button"
                  className="text-muted-foreground mb-1 flex items-center gap-1 text-xs hover:underline"
                  onClick={() => setPickerCategory(null)}
                >
                  <ChevronLeft className="h-3 w-3" />
                  Back
                </button>
                {catalog
                  .filter((s) => s.category === pickerCategory)
                  .map((svc) => (
                    <button
                      key={svc.id}
                      type="button"
                      className="border-border/60 hover:bg-accent flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-colors"
                      onClick={() => {
                        setLineItems((prev) => [
                          ...prev,
                          {
                            service_catalog_item_id: svc.id,
                            name_snapshot: svc.name,
                            quantity: '1',
                            unit_price:
                              svc.base_price != null
                                ? String(svc.base_price)
                                : '',
                            duration_minutes:
                              svc.default_duration_minutes != null
                                ? String(svc.default_duration_minutes)
                                : '60',
                            notes: '',
                          },
                        ])
                        setEditingLines(true)
                        setShowPicker(false)
                        setPickerCategory(null)
                      }}
                    >
                      <span className="font-medium">{svc.name}</span>
                      {svc.base_price != null && (
                        <span className="text-muted-foreground text-xs">
                          ${svc.base_price}
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Line Items ────────────────────────────────────── */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Line Items</h2>
          <div className="flex gap-2">
            {catalog.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => {
                  setPickerCategory(null)
                  setShowPicker(true)
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Service
              </Button>
            )}
            {!editingLines ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setEditingLines(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingLines(false)
                    setLineItems(
                      (data.appointment.ops_appointment_line_items || []).map(
                        (l) => ({
                          id: l.id,
                          service_catalog_item_id:
                            l.service_catalog_item_id ?? null,
                          name_snapshot: l.name_snapshot,
                          quantity: String(l.quantity),
                          unit_price: String(l.unit_price),
                          duration_minutes: String(l.duration_minutes),
                          notes: l.notes ?? '',
                        }),
                      ),
                    )
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void handleSaveLines()}
                  disabled={savingLines}
                >
                  {savingLines ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Save
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {lineItems.map((item, idx) => (
            <div key={idx} className="rounded-xl border bg-black/20 p-4">
              {editingLines ? (
                /* ── Edit mode ── */
                <div className="space-y-2">
                  {catalog.length > 0 && (
                    <select
                      className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
                      value={item.service_catalog_item_id ?? ''}
                      onChange={(e) => {
                        const svc = catalog.find((s) => s.id === e.target.value)
                        setLineItems((prev) =>
                          prev.map((l, i) =>
                            i !== idx
                              ? l
                              : {
                                  ...l,
                                  service_catalog_item_id:
                                    e.target.value || null,
                                  name_snapshot: svc?.name ?? l.name_snapshot,
                                  unit_price:
                                    svc?.base_price != null
                                      ? String(svc.base_price)
                                      : l.unit_price,
                                  duration_minutes:
                                    svc?.default_duration_minutes != null
                                      ? String(svc.default_duration_minutes)
                                      : l.duration_minutes,
                                },
                          ),
                        )
                      }}
                    >
                      <option value="">— Pick from catalog —</option>
                      {catalog.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.base_price != null ? ` — $${s.base_price}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
                    placeholder="Service name"
                    value={item.name_snapshot}
                    onChange={(e) =>
                      setLineItems((prev) =>
                        prev.map((l, i) =>
                          i !== idx
                            ? l
                            : { ...l, name_snapshot: e.target.value },
                        ),
                      )
                    }
                  />
                  {/* Description / notes */}
                  <textarea
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                    rows={2}
                    placeholder="Work description (e.g. Ramp between A and B building)"
                    value={item.notes}
                    onChange={(e) =>
                      setLineItems((prev) =>
                        prev.map((l, i) =>
                          i !== idx ? l : { ...l, notes: e.target.value },
                        ),
                      )
                    }
                  />
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label className="text-muted-foreground mb-1 block text-xs">
                        Qty
                      </label>
                      <input
                        type="number"
                        className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
                        value={item.quantity}
                        onChange={(e) =>
                          setLineItems((prev) =>
                            prev.map((l, i) =>
                              i !== idx
                                ? l
                                : { ...l, quantity: e.target.value },
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-muted-foreground mb-1 block text-xs">
                        Unit Price ($)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
                        value={item.unit_price}
                        onChange={(e) =>
                          setLineItems((prev) =>
                            prev.map((l, i) =>
                              i !== idx
                                ? l
                                : { ...l, unit_price: e.target.value },
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground mb-1 text-xs">
                        Total
                      </p>
                      <p className="font-semibold tabular-nums">
                        {fmt(
                          (Number(item.quantity) || 0) *
                            (Number(item.unit_price) || 0),
                        )}
                      </p>
                    </div>
                    {lineItems.length > 1 && (
                      <button
                        type="button"
                        className="hover:text-destructive mt-4"
                        onClick={() =>
                          setLineItems((prev) =>
                            prev.filter((_, i) => i !== idx),
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* ── View mode ── */
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <p className="leading-snug font-medium">
                      {item.name_snapshot}
                    </p>
                    <p className="shrink-0 font-semibold tabular-nums">
                      {fmt(
                        (Number(item.quantity) || 0) *
                          (Number(item.unit_price) || 0),
                      )}
                    </p>
                  </div>
                  {item.notes && (
                    <p className="mt-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200">
                      {item.notes}
                    </p>
                  )}
                  <p className="text-muted-foreground mt-1 text-xs">
                    {item.quantity} × {fmt(Number(item.unit_price))}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        {editingLines && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full gap-1.5"
            onClick={() =>
              setLineItems((prev) => [
                ...prev,
                {
                  name_snapshot: '',
                  quantity: '1',
                  unit_price: '',
                  duration_minutes: '60',
                  notes: '',
                  service_catalog_item_id: null,
                },
              ])
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add Blank Line
          </Button>
        )}

        <div className="mt-4 flex items-center justify-between border-t pt-4">
          <span className="font-semibold">
            {isBatch ? 'Visit Subtotal' : 'Subtotal'}
          </span>
          <span className="text-xl font-bold tabular-nums">
            {fmt(editingLines ? subtotal : appointment.quoted_total)}
          </span>
        </div>
      </Card>

      {/* ── Visit Notes ───────────────────────────────────── */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <h2 className="mb-3 text-lg font-semibold">Visit Notes</h2>
        <p className="text-muted-foreground mb-3 text-xs">
          Notes for this specific visit only — not shared with the customer.
          Auto-saved.
        </p>
        <textarea
          className="border-input bg-background/70 w-full rounded-xl border p-3 text-sm"
          rows={4}
          placeholder="Anything unusual about this visit? Extra work done? Notes for billing?"
          value={visitNotes}
          onChange={(e) => debounceSaveNotes(e.target.value)}
        />
      </Card>

      {/* ── Back link + Delete ────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() => router.back()}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Schedule
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            router.push(`/admin/operations/recurring/${template.id}`)
          }
          className="gap-2"
        >
          <Repeat className="h-4 w-4" />
          View Template
        </Button>
        {appointment.status !== 'completed' && (
          <Button
            variant="destructive"
            className="gap-2"
            onClick={async () => {
              if (!confirm('Delete this visit? This cannot be undone.')) return
              try {
                const res = await fetch(
                  `/api/admin/ops/appointments/${appointment.id}`,
                  { method: 'DELETE' },
                )
                if (!res.ok) {
                  const d = await res.json()
                  alert(d.error || 'Failed to delete')
                  return
                }
                router.push('/admin/operations')
              } catch {
                alert('Failed to delete visit')
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete Visit
          </Button>
        )}
      </div>
    </div>
  )
}
