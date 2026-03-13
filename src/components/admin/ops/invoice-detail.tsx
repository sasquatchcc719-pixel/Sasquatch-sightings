'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarClock,
  Camera,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Newspaper,
  Phone,
  Trash2,
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
  const [photos, setPhotos] = useState<JobPhoto[]>([])
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoLabel, setPhotoLabel] = useState<'before' | 'after' | 'general'>(
    'general',
  )
  const [photoWatermark, setPhotoWatermark] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [creatingPost, setCreatingPost] = useState(false)
  const [postFeedback, setPostFeedback] = useState<{
    ok: boolean
    message: string
  } | null>(null)
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
      fd.append('label', photoLabel)
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

  const handleCreateJobPost = async () => {
    const apptId = unwrapRelation(invoice?.ops_appointments)?.id
    if (!apptId) return
    setCreatingPost(true)
    setPostFeedback(null)
    try {
      const res = await fetch(
        `/api/admin/ops/appointments/${apptId}/create-job-post`,
        { method: 'POST' },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create job post')
      setPostFeedback({
        ok: true,
        message: 'Draft created! Opening for review…',
      })
      setTimeout(() => {
        router.push(`/admin/jobs/${data.jobId}`)
      }, 800)
    } catch (err) {
      setPostFeedback({
        ok: false,
        message:
          err instanceof Error ? err.message : 'Failed to create job post',
      })
    } finally {
      setCreatingPost(false)
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

      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.22em] uppercase">
              Invoice
            </p>
            <h2 className="mt-1 text-2xl font-semibold">
              {customer?.business_name || customer?.full_name || 'Customer'}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {appointment?.appointment_date} ·{' '}
              {appointment?.start_time.slice(0, 5)} -{' '}
              {appointment?.end_time.slice(0, 5)}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <Badge variant="outline" className="text-base">
              ${total.toFixed(2)}
            </Badge>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={sendLoading !== null}
                onClick={() => void handleSend('sms')}
              >
                {sendLoading === 'sms' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
                Text
              </Button>
              <Button
                size="sm"
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
                Email
              </Button>
              {address?.street_1 ? (
                <Button size="sm" variant="outline" className="gap-2" asChild>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MapPin className="h-4 w-4" />
                    Route
                  </a>
                </Button>
              ) : null}
            </div>
            {sendFeedback ? (
              <p
                className={`text-xs ${sendFeedback.ok ? 'text-green-600' : 'text-red-500'}`}
              >
                {sendFeedback.message}
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr,0.9fr]">
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
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
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
                  onClick={() =>
                    void runAppointmentAction({
                      label: 'Complete',
                      status: 'completed',
                    })
                  }
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
          </div>
        </Card>

        <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
          <h3 className="text-lg font-semibold">Billing Context</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="text-foreground font-medium">
              {customer?.business_name || customer?.full_name}
            </div>
            {customer?.phone ? (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground flex-1 tabular-nums">
                  {customer.phone}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 px-2"
                  asChild
                >
                  <a href={`tel:${customer.phone}`}>
                    <Phone className="h-3.5 w-3.5" />
                    Call
                  </a>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 px-2"
                  asChild
                >
                  <a href={`sms:${customer.phone}`}>
                    <MessageSquare className="h-3.5 w-3.5" />
                    Text
                  </a>
                </Button>
              </div>
            ) : (
              <div className="text-muted-foreground">No phone on file</div>
            )}
            {customer?.email ? (
              <div className="text-muted-foreground">{customer.email}</div>
            ) : null}
            {address ? (
              <div className="text-muted-foreground">
                {address.street_1}, {address.city}, {address.state}{' '}
                {address.zip_code}
              </div>
            ) : null}
            {appointment?.lead_source ? (
              <div className="text-muted-foreground">
                <span className="text-foreground/70 font-medium">Source:</span>{' '}
                {appointment.lead_source}
              </div>
            ) : null}
            {appointment?.id ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-1 w-full gap-2"
                onClick={() =>
                  router.push(
                    `/admin/operations?date=${appointment.appointment_date}`,
                  )
                }
              >
                <CalendarClock className="h-4 w-4" />
                Reschedule on Calendar
              </Button>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Line Items</h3>
        <div className="mt-3 space-y-2">
          {lineItems.map((item, index) => (
            <div
              key={item.id}
              className="border-border/60 bg-background/70 rounded-xl border p-3"
            >
              <div className="flex flex-col gap-2">
                <div>
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
                      value={String(item.quantity)}
                      disabled
                      className="h-8 text-sm"
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
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Camera className="text-muted-foreground h-5 w-5" />
            <h3 className="text-lg font-semibold">Job Photos</h3>
            {photos.length > 0 ? (
              <Badge variant="outline">{photos.length}</Badge>
            ) : null}
          </div>
          {photos.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={creatingPost}
              onClick={() => void handleCreateJobPost()}
            >
              {creatingPost ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Newspaper className="h-4 w-4" />
              )}
              Create Job Post
            </Button>
          ) : null}
        </div>

        {postFeedback ? (
          <p
            className={`mt-2 text-sm ${postFeedback.ok ? 'text-green-600' : 'text-red-500'}`}
          >
            {postFeedback.message}
          </p>
        ) : null}

        {/* Existing photos */}
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
                    alt={photo.label}
                    className="aspect-square w-full rounded-xl object-cover shadow-sm transition group-hover:opacity-90"
                  />
                </a>
                <div className="mt-1 flex items-center justify-between px-0.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${
                      photo.label === 'before'
                        ? 'bg-blue-100 text-blue-700'
                        : photo.label === 'after'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {photo.label}
                  </span>
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
            No photos yet. Upload before and after shots below.
          </p>
        )}

        {/* Upload controls */}
        <div className="border-border/60 mt-4 space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="photo-label" className="text-xs">
                Label
              </Label>
              <select
                id="photo-label"
                className="border-input bg-background mt-1 h-9 rounded-md border px-2 text-sm"
                value={photoLabel}
                onChange={(e) =>
                  setPhotoLabel(
                    e.target.value as 'before' | 'after' | 'general',
                  )
                }
              >
                <option value="before">Before</option>
                <option value="after">After</option>
                <option value="general">General</option>
              </select>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={photoWatermark}
                onChange={(e) => setPhotoWatermark(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              Add watermark
            </label>

            <div className="flex items-center gap-2">
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
                {photoUploading ? 'Uploading…' : 'Choose Photo'}
              </Button>
            </div>
          </div>

          {photoError ? (
            <p className="text-sm text-red-500">{photoError}</p>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
