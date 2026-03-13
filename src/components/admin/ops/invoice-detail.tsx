'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarClock,
  Camera,
  CreditCard,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

type JobPhoto = {
  id: string
  appointment_id: string
  storage_path: string
  public_url: string
  label: 'before' | 'after' | 'general'
  watermarked: boolean
  created_at: string
}

type InvoiceDetailProps = {
  invoiceId: string
}

type InvoiceDetail = {
  id: string
  status: string
  payment_status: string
  subtotal: number
  total: number
  discount_amount: number | null
  ops_appointments:
    | {
        id: string
        appointment_date: string
        start_time: string
        end_time: string
        status: string
        lead_source: string | null
        ops_customers:
          | {
              full_name: string
              business_name: string | null
              phone: string | null
              email: string | null
            }
          | {
              full_name: string
              business_name: string | null
              phone: string | null
              email: string | null
            }[]
          | null
        ops_service_addresses:
          | {
              street_1: string
              city: string
              state: string
              zip_code: string
            }
          | {
              street_1: string
              city: string
              state: string
              zip_code: string
            }[]
          | null
      }
    | null
    | Array<{
        id: string
        appointment_date: string
        start_time: string
        end_time: string
        status: string
        lead_source: string | null
        ops_customers:
          | {
              full_name: string
              business_name: string | null
              phone: string | null
              email: string | null
            }
          | {
              full_name: string
              business_name: string | null
              phone: string | null
              email: string | null
            }[]
          | null
        ops_service_addresses:
          | {
              street_1: string
              city: string
              state: string
              zip_code: string
            }
          | {
              street_1: string
              city: string
              state: string
              zip_code: string
            }[]
          | null
      }>
  ops_invoice_line_items: Array<{
    id: string
    appointment_line_item_id: string | null
    description: string
    quantity: number
    unit_price: number
    line_total: number
  }>
}

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

export function InvoiceDetail({ invoiceId }: InvoiceDetailProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [status, setStatus] = useState('draft')
  const [paymentStatus, setPaymentStatus] = useState('unpaid')
  const [discount, setDiscount] = useState('0')
  const [sendLoading, setSendLoading] = useState<'sms' | 'email' | null>(null)
  const [sendFeedback, setSendFeedback] = useState<{
    channel: 'sms' | 'email'
    ok: boolean
    message: string
  } | null>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [serviceCatalog, setServiceCatalog] = useState<
    Array<{
      id: string
      name: string
      category: string
      base_price: number | null
    }>
  >([])
  const [photos, setPhotos] = useState<JobPhoto[]>([])
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoWatermark, setPhotoWatermark] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [lineItems, setLineItems] = useState<
    Array<{
      id: string
      appointment_line_item_id: string | null
      description: string
      quantity: number
      unit_price: string
    }>
  >([])

  useEffect(() => {
    async function loadInvoice() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/admin/ops/invoices/${invoiceId}`, {
          cache: 'no-store',
        })
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Failed to load invoice')
        }
        setInvoice(result.invoice)
        setStatus(result.invoice.status)
        setDiscount(String(result.invoice.discount_amount || 0))
        setPaymentStatus(result.invoice.payment_status)

        // Load photos for this appointment
        const appt = Array.isArray(result.invoice.ops_appointments)
          ? result.invoice.ops_appointments[0]
          : result.invoice.ops_appointments
        if (appt?.id) {
          const photosRes = await fetch(
            `/api/admin/ops/appointments/${appt.id}/photos`,
            { cache: 'no-store' },
          )
          if (photosRes.ok) {
            const photosData = await photosRes.json()
            setPhotos(photosData.photos ?? [])
          }
        }
        setLineItems(
          (result.invoice.ops_invoice_line_items || []).map(
            (item: {
              id: string
              appointment_line_item_id: string | null
              description: string
              quantity: number
              unit_price: number
            }) => ({
              id: item.id,
              appointment_line_item_id: item.appointment_line_item_id,
              description: item.description,
              quantity: Number(item.quantity),
              unit_price: String(item.unit_price),
            }),
          ),
        )
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load invoice',
        )
      } finally {
        setLoading(false)
      }
    }

    void loadInvoice()
  }, [invoiceId])

  useEffect(() => {
    fetch('/api/admin/ops/services', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.services)) setServiceCatalog(data.services)
      })
      .catch(() => {
        /* non-fatal */
      })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/ops/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          payment_status: paymentStatus,
          discount_amount: Number(discount || 0),
          line_items: lineItems.map((item) => ({
            id: item.id,
            appointment_line_item_id: item.appointment_line_item_id,
            description: item.description,
            quantity: item.quantity,
            unit_price: Number(item.unit_price || 0),
          })),
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update invoice')
      }
      router.refresh()
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to update invoice',
      )
    } finally {
      setSaving(false)
    }
  }

  const runAppointmentAction = async (updates: {
    status?: string
    payment_status?: string
    label: string
  }) => {
    const appointment = unwrapRelation(invoice?.ops_appointments)
    if (!appointment?.id) return
    setActionLoading(updates.label)
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/ops/appointments/${appointment.id}`,
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
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update job')
      }
      router.refresh()
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Failed to update job',
      )
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeleteJob = async () => {
    const confirmed = window.confirm(
      'Delete this job? The appointment and invoice will both be permanently removed.',
    )
    if (!confirmed) return

    const apptId = unwrapRelation(invoice?.ops_appointments)?.id
    if (!apptId) {
      setError('No appointment linked to this invoice.')
      return
    }

    setActionLoading('Delete Job')
    setError(null)
    try {
      const response = await fetch(`/api/admin/ops/appointments/${apptId}`, {
        method: 'DELETE',
      })
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

  const handleSend = async (channel: 'sms' | 'email') => {
    setSendLoading(channel)
    setSendFeedback(null)
    try {
      const response = await fetch(
        `/api/admin/ops/invoices/${invoiceId}/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel }),
        },
      )
      const result = await response.json()
      if (!response.ok) {
        setSendFeedback({
          channel,
          ok: false,
          message: result.error || 'Failed to send',
        })
      } else {
        setSendFeedback({
          channel,
          ok: true,
          message: channel === 'sms' ? 'Text sent!' : 'Email sent!',
        })
        setTimeout(() => setSendFeedback(null), 4000)
      }
    } catch {
      setSendFeedback({ channel, ok: false, message: 'Failed to send' })
    } finally {
      setSendLoading(null)
    }
  }

  const handlePhotoUpload = async (file: File) => {
    const apptId = unwrapRelation(invoice?.ops_appointments)?.id
    if (!apptId) return
    setPhotoUploading(true)
    setPhotoError(null)
    try {
      const fd = new FormData()
      fd.append('image', file)
      fd.append('label', 'general')
      fd.append('watermark', String(photoWatermark))
      const res = await fetch(`/api/admin/ops/appointments/${apptId}/photos`, {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setPhotos((prev) => [...prev, data.photo])
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handlePhotoDelete = async (photoId: string) => {
    const apptId = unwrapRelation(invoice?.ops_appointments)?.id
    if (!apptId) return
    try {
      const res = await fetch(
        `/api/admin/ops/appointments/${apptId}/photos?photoId=${photoId}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error('Delete failed')
      setPhotos((prev) => prev.filter((p) => p.id !== photoId))
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const handleFinishJob = async () => {
    const appt = unwrapRelation(invoice?.ops_appointments)
    if (!appt?.id) return
    setActionLoading('Complete')
    setError(null)
    try {
      const response = await fetch(`/api/admin/ops/appointments/${appt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to update job')

      // Compute hours worked from start/end times
      let hoursWorked = ''
      if (appt.start_time && appt.end_time) {
        const [sh, sm] = appt.start_time.split(':').map(Number)
        const [eh, em] = appt.end_time.split(':').map(Number)
        const mins = eh * 60 + em - (sh * 60 + sm)
        if (mins > 0) hoursWorked = (mins / 60).toFixed(2)
      }

      // Compute invoice total from current line items
      const subtotal = lineItems.reduce(
        (sum, item) => sum + item.quantity * Number(item.unit_price || 0),
        0,
      )
      const invoiceTotal = Math.max(
        0,
        subtotal - Math.max(0, Number(discount || 0)),
      )

      // Pass invoice data to the jobs upload form via sessionStorage
      const preloadData = {
        invoiceAmount: invoiceTotal.toFixed(2),
        hoursWorked,
        description: lineItems
          .map((li) => li.description)
          .filter(Boolean)
          .join(', '),
      }
      sessionStorage.setItem(
        'preloadedInvoiceData',
        JSON.stringify(preloadData),
      )
      router.push('/admin?fromInvoice=1')
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Failed to update job',
      )
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading invoice...
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="text-muted-foreground text-sm">Invoice not found.</div>
    )
  }

  const appointment = unwrapRelation(invoice.ops_appointments)
  const customer = unwrapRelation(appointment?.ops_customers)
  const address = unwrapRelation(appointment?.ops_service_addresses)
  const subtotalCalc = lineItems.reduce(
    (sum, item) => sum + item.quantity * Number(item.unit_price || 0),
    0,
  )
  const discountAmount = Math.max(0, Number(discount || 0))
  const total = Math.max(0, subtotalCalc - discountAmount)

  return (
    <div className="space-y-6">
      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      {/* ── Customer header card ───────────────────────────── */}
      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        {/* Name + total */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase">
              Invoice
            </p>
            <h2 className="mt-1 text-3xl font-bold">
              {customer?.business_name || customer?.full_name || 'Customer'}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {appointment?.appointment_date} ·{' '}
              {appointment?.start_time.slice(0, 5)} –{' '}
              {appointment?.end_time.slice(0, 5)}
            </p>
          </div>
          <p className="text-3xl font-bold tabular-nums">${total.toFixed(2)}</p>
        </div>

        {/* Contact info */}
        <div className="mt-5 space-y-2 text-sm">
          {customer?.phone ? (
            <div className="flex items-center gap-3">
              <Phone className="text-muted-foreground h-4 w-4 shrink-0" />
              <span className="flex-1 text-base tabular-nums">
                {customer.phone}
              </span>
              <Button className="gap-2" asChild>
                <a href={`tel:${customer.phone}`}>
                  <Phone className="h-4 w-4" />
                  Call
                </a>
              </Button>
              <Button variant="outline" className="gap-2" asChild>
                <a href={`sms:${customer.phone}`}>
                  <MessageSquare className="h-4 w-4" />
                  Text
                </a>
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">No phone on file</p>
          )}
          {customer?.email ? (
            <div className="text-muted-foreground flex items-center gap-2">
              <Mail className="h-4 w-4 shrink-0" />
              <span>{customer.email}</span>
            </div>
          ) : null}
          {address ? (
            <div className="flex items-center gap-2">
              <MapPin className="text-muted-foreground h-4 w-4 shrink-0" />
              <span className="text-muted-foreground flex-1">
                {address.street_1}, {address.city}, {address.state}{' '}
                {address.zip_code}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5"
                asChild
              >
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MapPin className="h-3.5 w-3.5" />
                  Route
                </a>
              </Button>
            </div>
          ) : null}
          {appointment?.lead_source ? (
            <p className="text-muted-foreground">
              Source: {appointment.lead_source}
            </p>
          ) : null}
        </div>

        {/* Divider + invoice delivery actions */}
        <div className="border-border/60 mt-6 border-t pt-5">
          <p className="text-muted-foreground mb-3 text-xs font-semibold tracking-widest uppercase">
            Send Invoice
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => setShowPaymentModal(true)}
            >
              <CreditCard className="h-4 w-4" />
              Venmo
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              disabled={sendLoading !== null}
              onClick={() => void handleSend('sms')}
            >
              {sendLoading === 'sms' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send Invoice
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              disabled={sendLoading !== null}
              onClick={() => void handleSend('email')}
            >
              {sendLoading === 'email' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              Email Invoice
            </Button>
          </div>
          {sendFeedback ? (
            <p
              className={`mt-2 text-sm ${sendFeedback.ok ? 'text-green-600' : 'text-red-500'}`}
            >
              {sendFeedback.message}
            </p>
          ) : null}
        </div>
      </Card>

      {/* ── Invoice status card ─────────────────────────────── */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Invoice Status</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="invoice-status">Status</Label>
            <select
              id="invoice-status"
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="draft">Draft</option>
              <option value="ready">Ready</option>
              <option value="sent">Sent</option>
              <option value="paid">Paid</option>
              <option value="void">Void</option>
            </select>
          </div>
          <div>
            <Label htmlFor="invoice-payment-status">Payment Status</Label>
            <select
              id="invoice-payment-status"
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={paymentStatus}
              onChange={(event) => setPaymentStatus(event.target.value)}
            >
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="waived">Waived</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Invoice
          </Button>
          {appointment?.id ? (
            <>
              <Button
                variant="outline"
                disabled={Boolean(actionLoading)}
                onClick={() =>
                  void runAppointmentAction({
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
                disabled={Boolean(actionLoading)}
                onClick={() =>
                  void runAppointmentAction({
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
                onClick={() => void handleFinishJob()}
              >
                {actionLoading === 'Complete' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Finished
              </Button>
              <Button
                variant="outline"
                disabled={Boolean(actionLoading)}
                onClick={() =>
                  void runAppointmentAction({
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
            </>
          ) : null}
          <Button
            variant="destructive"
            disabled={Boolean(actionLoading)}
            onClick={() => void handleDeleteJob()}
          >
            {actionLoading === 'Delete Job' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Delete Job
          </Button>
          {appointment?.id ? (
            <Button
              variant="outline"
              disabled={Boolean(actionLoading)}
              className="gap-2"
              onClick={() =>
                router.push(
                  `/admin/operations?date=${appointment.appointment_date}`,
                )
              }
            >
              <CalendarClock className="h-4 w-4" />
              Reschedule
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Line Items</h3>
          <select
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            value=""
            onChange={(e) => {
              const serviceId = e.target.value
              if (!serviceId) return
              const service = serviceCatalog.find((s) => s.id === serviceId)
              if (!service) return
              setLineItems((current) => [
                ...current,
                {
                  id: `new-${Date.now()}`,
                  appointment_line_item_id: null,
                  description: service.name,
                  quantity: 1,
                  unit_price:
                    service.base_price != null
                      ? String(service.base_price)
                      : '0',
                },
              ])
            }}
          >
            <option value="">+ Add service…</option>
            {serviceCatalog.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.base_price != null ? ` — $${s.base_price}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 space-y-2">
          {lineItems.map((item, index) => (
            <div
              key={item.id}
              className="border-border/60 bg-background/70 rounded-xl border p-3"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <Label
                      htmlFor={`line-description-${index}`}
                      className="text-xs"
                    >
                      Description
                    </Label>
                    <Input
                      id={`line-description-${index}`}
                      value={item.description}
                      className="h-8 text-sm"
                      onChange={(event) =>
                        setLineItems((current) =>
                          current.map((line, lineIndex) =>
                            lineIndex === index
                              ? { ...line, description: event.target.value }
                              : line,
                          ),
                        )
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive mt-5 p-1"
                    onClick={() =>
                      setLineItems((current) =>
                        current.filter((_, lineIndex) => lineIndex !== index),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label
                      htmlFor={`line-quantity-${index}`}
                      className="text-xs"
                    >
                      Qty
                    </Label>
                    <Input
                      id={`line-quantity-${index}`}
                      type="number"
                      min="1"
                      step="1"
                      value={String(item.quantity)}
                      className="h-8 text-sm"
                      onChange={(event) =>
                        setLineItems((current) =>
                          current.map((line, lineIndex) =>
                            lineIndex === index
                              ? {
                                  ...line,
                                  quantity: Math.max(
                                    1,
                                    Number(event.target.value) || 1,
                                  ),
                                }
                              : line,
                          ),
                        )
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor={`line-price-${index}`} className="text-xs">
                      Unit Price
                    </Label>
                    <Input
                      id={`line-price-${index}`}
                      type="number"
                      step="0.01"
                      value={item.unit_price}
                      className="h-8 text-sm"
                      onChange={(event) =>
                        setLineItems((current) =>
                          current.map((line, lineIndex) =>
                            lineIndex === index
                              ? { ...line, unit_price: event.target.value }
                              : line,
                          ),
                        )
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="border-border/60 mt-3 space-y-1 border-t pt-3">
          {discountAmount > 0 ? (
            <div className="flex items-center justify-end gap-6 text-sm text-slate-600">
              <span>Subtotal</span>
              <span className="tabular-nums">${subtotalCalc.toFixed(2)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-4">
            <div className="flex items-center gap-2">
              <Label
                htmlFor="invoice-discount"
                className="text-sm whitespace-nowrap text-slate-500"
              >
                Discount ($)
              </Label>
              <Input
                id="invoice-discount"
                type="number"
                min="0"
                step="0.01"
                value={discount}
                className="h-8 w-24 text-right text-sm"
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-6 text-lg font-bold">
            <span>Total</span>
            <span className="tabular-nums">${total.toFixed(2)}</span>
          </div>
        </div>
      </Card>
      {/* Job Photos */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex items-center gap-2">
          <Camera className="text-muted-foreground h-5 w-5" />
          <h3 className="text-lg font-semibold">Job Photos</h3>
          {photos.length > 0 ? (
            <Badge variant="outline">{photos.length}</Badge>
          ) : null}
        </div>

        {/* Photo gallery */}
        {photos.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((photo) => (
              <div key={photo.id} className="group relative">
                <a
                  href={photo.public_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={photo.public_url}
                    alt="Job photo"
                    className="aspect-square w-full rounded-xl object-cover shadow-sm transition group-hover:opacity-90"
                  />
                </a>
                <div className="mt-1 flex justify-end px-0.5">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive p-1"
                    onClick={() => void handlePhotoDelete(photo.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground mt-3 text-sm">
            No photos yet. These will be included in the invoice email.
          </p>
        )}

        {/* Upload controls */}
        <div className="border-border/60 mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={photoWatermark}
              onChange={(e) => setPhotoWatermark(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            Add Sasquatch watermark
          </label>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handlePhotoUpload(file)
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={photoUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {photoUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            {photoUploading ? 'Uploading…' : 'Add Photo'}
          </Button>

          {photoError ? (
            <p className="w-full text-sm text-red-500">{photoError}</p>
          ) : null}
        </div>
      </Card>

      {/* In-person payment modal */}
      {showPaymentModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setShowPaymentModal(false)}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
              onClick={() => setShowPaymentModal(false)}
            >
              <X className="h-5 w-5" />
            </button>

            <p className="text-sm font-medium tracking-widest text-slate-400 uppercase">
              Amount Due
            </p>
            <p className="mt-1 text-5xl font-bold text-slate-900">
              ${total.toFixed(2)}
            </p>
            {customer?.business_name || customer?.full_name ? (
              <p className="mt-1 text-sm text-slate-500">
                {customer.business_name || customer.full_name}
              </p>
            ) : null}

            <div className="mt-6 flex justify-center">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
                  `https://venmo.com/SasquatchCarpet?txn=pay&amount=${total.toFixed(2)}&note=${encodeURIComponent(`Sasquatch Carpet Cleaning - ${customer?.business_name || customer?.full_name || 'Service'}`)}`,
                )}`}
                alt="Venmo QR code"
                width={240}
                height={240}
                className="rounded-xl border border-slate-200"
              />
            </div>

            <p className="mt-4 text-sm font-medium text-slate-700">
              Hand your phone to the customer
            </p>
            <p className="mt-1 text-xs text-slate-400">
              They scan the QR code or tap the button below
            </p>

            <a
              href={`https://venmo.com/SasquatchCarpet?txn=pay&amount=${total.toFixed(2)}&note=${encodeURIComponent(`Sasquatch Carpet Cleaning - ${customer?.business_name || customer?.full_name || 'Service'}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#008CFF] py-3 text-sm font-semibold text-white hover:bg-blue-600"
            >
              <CreditCard className="h-4 w-4" />
              Pay with Venmo
            </a>
          </div>
        </div>
      ) : null}
    </div>
  )
}
