'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, MessageSquare, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

type AppointmentDetailProps = {
  appointmentId: string
}

type AppointmentDetail = {
  id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  payment_status: string
  internal_notes: string | null
  quoted_total: number
  ops_customers:
    | {
        full_name: string
        first_name: string | null
        last_name: string | null
        business_name: string | null
        email: string | null
        phone: string
        notes: string | null
      }
    | null
    | Array<{
        full_name: string
        first_name: string | null
        last_name: string | null
        business_name: string | null
        email: string | null
        phone: string
        notes: string | null
      }>
  ops_service_addresses:
    | {
        label: string | null
        street_1: string
        street_2: string | null
        city: string
        state: string
        zip_code: string
        gate_code: string | null
        notes: string | null
      }
    | null
    | Array<{
        label: string | null
        street_1: string
        street_2: string | null
        city: string
        state: string
        zip_code: string
        gate_code: string | null
        notes: string | null
      }>
  ops_appointment_line_items: Array<{
    id: string
    name_snapshot: string
    quantity: number
    unit_price: number
    line_total: number
  }>
  ops_invoices:
    | {
        id: string
        status: string
        payment_status: string
        total: number
      }
    | null
    | Array<{
        id: string
        status: string
        payment_status: string
        total: number
      }>
}

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

function formatDriveElapsed(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function timeToMinutes(value: string): number {
  const [h, m] = String(value).slice(0, 5).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function AppointmentDetail({ appointmentId }: AppointmentDetailProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [appointment, setAppointment] = useState<AppointmentDetail | null>(null)
  const [form, setForm] = useState({
    appointment_date: '',
    start_time: '',
    end_time: '',
    status: 'booked',
    payment_status: 'unpaid',
    internal_notes: '',
  })
  type OnMyWaySmsInfo = { body: string; actuallySent: boolean }
  const [onMyWaySmsInfo, setOnMyWaySmsInfo] = useState<OnMyWaySmsInfo | null>(
    null,
  )
  const [driveStartedAtMs, setDriveStartedAtMs] = useState<number | null>(null)
  const [driveElapsedMs, setDriveElapsedMs] = useState(0)

  const loadAppointment = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true)
      setError(null)
      try {
        const response = await fetch(
          `/api/admin/ops/appointments/${appointmentId}`,
          {
            cache: 'no-store',
          },
        )
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Failed to load appointment')
        }
        setAppointment(result.appointment)
        setForm({
          appointment_date: result.appointment.appointment_date,
          start_time: String(result.appointment.start_time).slice(0, 5),
          end_time: String(result.appointment.end_time).slice(0, 5),
          status: result.appointment.status,
          payment_status: result.appointment.payment_status,
          internal_notes: result.appointment.internal_notes || '',
        })
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load appointment',
        )
      } finally {
        if (mode === 'initial') setLoading(false)
      }
    },
    [appointmentId],
  )

  useEffect(() => {
    void loadAppointment('initial')
  }, [loadAppointment])

  useEffect(() => {
    if (!appointment?.id || appointment.status !== 'on_my_way') return
    const raw = sessionStorage.getItem(`ops_onmyway_${appointment.id}`)
    if (raw && driveStartedAtMs === null) {
      const ms = Number(raw)
      if (Number.isFinite(ms)) setDriveStartedAtMs(ms)
    }
  }, [appointment, driveStartedAtMs])

  useEffect(() => {
    if (!appointment?.id || appointment.status !== 'on_my_way') return
    const raw = sessionStorage.getItem(`ops_omw_sms_${appointment.id}`)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as Partial<OnMyWaySmsInfo>
      if (typeof parsed.body === 'string') {
        setOnMyWaySmsInfo(
          (prev) =>
            prev ?? {
              body: parsed.body!,
              actuallySent:
                typeof parsed.actuallySent === 'boolean'
                  ? parsed.actuallySent
                  : true,
            },
        )
      }
    } catch {
      /* ignore */
    }
  }, [appointment])

  useEffect(() => {
    if (appointment?.id && appointment.status === 'completed') {
      sessionStorage.removeItem(`ops_onmyway_${appointment.id}`)
      sessionStorage.removeItem(`ops_omw_sms_${appointment.id}`)
      setDriveStartedAtMs(null)
      setOnMyWaySmsInfo(null)
    }
  }, [appointment])

  useEffect(() => {
    if (appointment?.status !== 'on_my_way' || driveStartedAtMs == null) return
    const tick = () => setDriveElapsedMs(Date.now() - driveStartedAtMs)
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [appointment, driveStartedAtMs])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const startM = timeToMinutes(form.start_time)
      const endM = timeToMinutes(form.end_time)
      if (endM <= startM) {
        setError('End time must be after start time.')
        setSaving(false)
        return
      }
      const response = await fetch(
        `/api/admin/ops/appointments/${appointmentId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update appointment')
      }
      if (result.appointment) {
        setAppointment(result.appointment)
        setForm({
          appointment_date: result.appointment.appointment_date,
          start_time: String(result.appointment.start_time).slice(0, 5),
          end_time: String(result.appointment.end_time).slice(0, 5),
          status: result.appointment.status,
          payment_status: result.appointment.payment_status,
          internal_notes: result.appointment.internal_notes || '',
        })
      }
      router.refresh()
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to update appointment',
      )
    } finally {
      setSaving(false)
    }
  }

  const runQuickAction = async (updates: {
    status?: string
    payment_status?: string
    label: string
  }) => {
    setActionLoading(updates.label)
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/ops/appointments/${appointmentId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(updates.status ? { status: updates.status } : {}),
            ...(updates.payment_status
              ? { payment_status: updates.payment_status }
              : {}),
          }),
        },
      )
      const result = (await response.json()) as {
        error?: string
        lifecycle_notifications?: Array<{
          channel: string
          body: string
          actually_sent?: boolean
        }>
      }
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update job status')
      }
      const sms = result.lifecycle_notifications?.find(
        (n) => n.channel === 'sms',
      )
      if (sms && typeof sms.body === 'string') {
        const actuallySent = sms.actually_sent !== false
        const next: OnMyWaySmsInfo = { body: sms.body, actuallySent }
        setOnMyWaySmsInfo(next)
        sessionStorage.setItem(
          `ops_omw_sms_${appointmentId}`,
          JSON.stringify(next),
        )
      }
      if (updates.status === 'on_my_way') {
        const t = Date.now()
        setDriveStartedAtMs(t)
        sessionStorage.setItem(`ops_onmyway_${appointmentId}`, String(t))
      }
      await loadAppointment('refresh')
      router.refresh()
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Failed to update job status',
      )
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeleteJob = async () => {
    const confirmed = window.confirm(
      'Delete this job and its invoice? This cannot be undone.',
    )
    if (!confirmed) return

    setActionLoading('Delete Job')
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/ops/appointments/${appointmentId}`,
        {
          method: 'DELETE',
        },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete job')
      }
      router.push('/admin/operations')
      router.refresh()
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Failed to delete job',
      )
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading job detail...
      </div>
    )
  }

  if (!appointment) {
    return <div className="text-muted-foreground text-sm">Job not found.</div>
  }

  const customer = unwrapRelation(appointment.ops_customers)
  const address = unwrapRelation(appointment.ops_service_addresses)
  const invoice = unwrapRelation(appointment.ops_invoices)

  return (
    <div className="space-y-6">
      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.22em] uppercase">
              Job
            </p>
            <h2 className="mt-1 text-2xl font-semibold">
              {customer?.business_name ||
                customer?.full_name ||
                'Unknown customer'}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {appointment.ops_appointment_line_items
                .map((item) => item.name_snapshot)
                .join(', ')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {appointment.status.replaceAll('_', ' ')}
            </Badge>
            <Badge variant="outline" className="capitalize">
              {appointment.payment_status}
            </Badge>
            {invoice?.id ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/admin/operations/invoices/${invoice.id}`}>
                  <Receipt className="mr-2 h-4 w-4" />
                  Open Invoice
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr,0.9fr]">
        <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
          <h3 className="text-lg font-semibold">Schedule + Status</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="job-date">Date</Label>
              <Input
                id="job-date"
                type="date"
                value={form.appointment_date}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    appointment_date: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="job-time">Start Time</Label>
              <Input
                id="job-time"
                type="time"
                value={form.start_time}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    start_time: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="job-end-time">End Time</Label>
              <Input
                id="job-end-time"
                type="time"
                value={form.end_time}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    end_time: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="job-status">Status</Label>
              <select
                id="job-status"
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
              >
                <option value="booked">Booked</option>
                <option value="confirmed">Confirmed</option>
                <option value="on_my_way">On my way</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <Label htmlFor="job-payment-status">Payment Status</Label>
              <select
                id="job-payment-status"
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                value={form.payment_status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    payment_status: event.target.value,
                  }))
                }
              >
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
                <option value="waived">Waived</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="job-notes">Internal Notes</Label>
              <Textarea
                id="job-notes"
                value={form.internal_notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    internal_notes: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save Job
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/operations">Back to Schedule</Link>
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={Boolean(actionLoading)}
              onClick={() =>
                void runQuickAction({
                  label: 'Confirm',
                  status: 'confirmed',
                })
              }
            >
              {actionLoading === 'Confirm' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Confirm
            </Button>
            <Button
              variant="outline"
              className={
                appointment.status === 'on_my_way'
                  ? 'border-green-600 bg-green-600 text-white hover:bg-green-700'
                  : ''
              }
              disabled={Boolean(actionLoading)}
              onClick={() =>
                void runQuickAction({
                  label: 'On My Way',
                  status: 'on_my_way',
                })
              }
            >
              {actionLoading === 'On My Way' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              On My Way
            </Button>
            <Button
              variant="outline"
              disabled={Boolean(actionLoading)}
              onClick={() =>
                void runQuickAction({
                  label: 'Complete',
                  status: 'completed',
                })
              }
            >
              {actionLoading === 'Complete' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Complete
            </Button>
            <Button
              variant="outline"
              disabled={Boolean(actionLoading)}
              onClick={() =>
                void runQuickAction({
                  label: 'Cancel',
                  status: 'cancelled',
                })
              }
            >
              {actionLoading === 'Cancel' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={Boolean(actionLoading)}
              onClick={() =>
                void runQuickAction({
                  label: 'Mark Paid',
                  payment_status: 'paid',
                })
              }
            >
              {actionLoading === 'Mark Paid' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Mark Paid
            </Button>
            <Button
              variant="outline"
              disabled={Boolean(actionLoading)}
              onClick={() => void handleDeleteJob()}
            >
              {actionLoading === 'Delete Job' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Delete Job
            </Button>
          </div>
          {appointment.status === 'on_my_way' && driveStartedAtMs != null ? (
            <p className="mt-3 font-mono text-sm font-semibold text-green-700">
              Drive time {formatDriveElapsed(driveElapsedMs)}
            </p>
          ) : null}
          <div className="border-border/60 bg-muted/40 mt-3 min-h-[5rem] rounded-xl border p-3">
            <p className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium uppercase">
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              Customer text (On My Way)
            </p>
            {onMyWaySmsInfo ? (
              <>
                <p className="text-foreground text-sm whitespace-pre-wrap">
                  {onMyWaySmsInfo.body || (
                    <span className="text-muted-foreground italic">
                      (Template is empty)
                    </span>
                  )}
                </p>
                <p
                  className={
                    onMyWaySmsInfo.actuallySent
                      ? 'mt-2 text-xs text-green-700'
                      : 'mt-2 text-xs text-amber-700'
                  }
                >
                  {onMyWaySmsInfo.actuallySent
                    ? 'Sent to the customer by SMS.'
                    : 'Preview only — this was not sent (template off, missing phone, or SMS not configured).'}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-sm leading-relaxed italic">
                After you tap On My Way, the exact message text appears here so
                you can confirm what customers receive (or review the preview if
                texting is turned off).
              </p>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
            <h3 className="text-lg font-semibold">Customer</h3>
            <div className="mt-4 space-y-2 text-sm">
              <div className="font-medium">
                {customer?.full_name || 'Unknown'}
              </div>
              {customer?.business_name ? (
                <div className="text-muted-foreground">
                  {customer.business_name}
                </div>
              ) : null}
              <div className="text-muted-foreground">
                {customer?.phone || 'No phone'}
              </div>
              <div className="text-muted-foreground">
                {customer?.email || 'No email'}
              </div>
              {customer?.notes ? (
                <div className="border-border/60 bg-background/70 text-muted-foreground rounded-xl border p-3">
                  {customer.notes}
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
            <h3 className="text-lg font-semibold">Service Address</h3>
            <div className="text-muted-foreground mt-4 space-y-2 text-sm">
              <div className="text-foreground font-medium">
                {address?.label || 'Service Address'}
              </div>
              <div>{address?.street_1}</div>
              {address?.street_2 ? <div>{address.street_2}</div> : null}
              <div>
                {address?.city}, {address?.state} {address?.zip_code}
              </div>
              {address?.gate_code ? (
                <div>Gate code: {address.gate_code}</div>
              ) : null}
              {address?.notes ? (
                <div className="border-border/60 bg-background/70 rounded-xl border p-3">
                  {address.notes}
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Line Items</h3>
          <Badge variant="outline">
            ${Number(appointment.quoted_total).toFixed(2)}
          </Badge>
        </div>
        <div className="mt-4 space-y-3">
          {appointment.ops_appointment_line_items.map((item) => (
            <div
              key={item.id}
              className="border-border/60 bg-background/70 rounded-2xl border p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{item.name_snapshot}</div>
                  <div className="text-muted-foreground mt-1 text-sm">
                    Qty {Number(item.quantity)} · $
                    {Number(item.unit_price).toFixed(2)} each
                  </div>
                </div>
                <div className="font-semibold">
                  ${Number(item.line_total).toFixed(2)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
