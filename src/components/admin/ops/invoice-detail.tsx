'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarClock,
  Camera,
  CheckCircle2,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  PenTool,
  Phone,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { BeforeAfterCombiner } from '@/components/admin/before-after-combiner'
import { getCurrentLocation } from '@/lib/image-utils'
import { formatSquareAmount } from '@/lib/payments/square'
import { SignatureModal } from './signature-modal'

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

type OpsCustomer = {
  id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  business_name: string | null
  phone: string | null
  email: string | null
}

type OpsAddress = {
  id: string
  street_1: string
  street_2: string | null
  city: string
  state: string
  zip_code: string
  gate_code: string | null
  notes: string | null
}

type OpsAppointment = {
  id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  lead_source: string | null
  gps_lat: number | null
  gps_lng: number | null
  ops_customers: OpsCustomer | OpsCustomer[] | null
  ops_service_addresses: OpsAddress | OpsAddress[] | null
}

type InvoiceDetail = {
  id: string
  status: string
  payment_status: string
  payment_method: string | null
  quickbooks_invoice_id: string | null
  subtotal: number
  total: number
  discount_amount: number | null
  percentage_discount_label: string | null
  percentage_discount_percent: number | null
  percentage_discount_scope: string | null
  percentage_discount_amount: number | null
  signature_url: string | null
  signature_captured_at: string | null
  signature_customer_name: string | null
  ops_appointments: OpsAppointment | OpsAppointment[] | null
  ops_invoice_line_items: Array<{
    id: string
    appointment_line_item_id: string | null
    description: string
    quantity: number
    unit_price: number
    line_total: number
  }>
}

type SendChannel = 'sms' | 'email'

type CustomerEditForm = {
  first_name: string
  last_name: string
  business_name: string
  phone: string
  email: string
}

type AddressEditForm = {
  street_1: string
  street_2: string
  city: string
  state: string
  zip_code: string
  gate_code: string
  notes: string
}

type AppointmentEditForm = {
  lead_source: string
}

const LINE_ITEM_INPUT_TONES = [
  'border-emerald-200 bg-emerald-50 text-emerald-950 focus-visible:ring-emerald-500/40',
  'border-sky-200 bg-sky-50 text-sky-950 focus-visible:ring-sky-500/40',
  'border-amber-200 bg-amber-50 text-amber-950 focus-visible:ring-amber-500/40',
  'border-violet-200 bg-violet-50 text-violet-950 focus-visible:ring-violet-500/40',
  'border-rose-200 bg-rose-50 text-rose-950 focus-visible:ring-rose-500/40',
  'border-cyan-200 bg-cyan-50 text-cyan-950 focus-visible:ring-cyan-500/40',
]

function SquareLogoMark({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-sm border-2 border-current ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-[1px] border border-current" />
    </span>
  )
}

function VenmoLogoMark({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center font-black tracking-tighter ${className}`}
    >
      V
    </span>
  )
}

function lineItemInputTone(index: number): string {
  return LINE_ITEM_INPUT_TONES[index % LINE_ITEM_INPUT_TONES.length]
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

export function InvoiceDetail({ invoiceId }: InvoiceDetailProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [status, setStatus] = useState('pending')
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null)
  const [discount, setDiscount] = useState('0')
  const [sendLoading, setSendLoading] = useState<SendChannel | null>(null)
  const [sendFeedback, setSendFeedback] = useState<{
    channel: SendChannel
    ok: boolean
    message: string
  } | null>(null)
  const [streetViewFailed, setStreetViewFailed] = useState(false)
  const [paymentLinkLoading, setPaymentLinkLoading] = useState<
    'quickbooks' | 'square' | 'venmo' | null
  >(null)
  const [paymentLinkFeedback, setPaymentLinkFeedback] = useState<{
    type: 'quickbooks' | 'square' | 'venmo'
    ok: boolean
    message: string
  } | null>(null)
  const [serviceCatalog, setServiceCatalog] = useState<
    Array<{
      id: string
      name: string
      category: string
      base_price: number | null
    }>
  >([])
  const [showServicePicker, setShowServicePicker] = useState(false)
  const [pickerCategory, setPickerCategory] = useState<string | null>(null)
  const [photos, setPhotos] = useState<JobPhoto[]>([])
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoWatermark, setPhotoWatermark] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [combinedImageDataUrl, setCombinedImageDataUrl] = useState<
    string | null
  >(null)
  const [aiDescription, setAiDescription] = useState('')
  const [aiDescLoading, setAiDescLoading] = useState(false)
  const [publishLoading, setPublishLoading] = useState(false)
  const [publishSuccess, setPublishSuccess] = useState(false)
  const [statsRecordLoading, setStatsRecordLoading] = useState(false)
  const [statsRecordMessage, setStatsRecordMessage] = useState<string | null>(
    null,
  )
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
  type OnMyWaySmsInfo = { body: string; actuallySent: boolean }
  const [onMyWaySmsInfo, setOnMyWaySmsInfo] = useState<OnMyWaySmsInfo | null>(
    null,
  )
  const [driveStartedAtMs, setDriveStartedAtMs] = useState<number | null>(null)
  const [showSignatureModal, setShowSignatureModal] = useState(false)
  const [driveElapsedMs, setDriveElapsedMs] = useState(0)

  const [editingCustomer, setEditingCustomer] = useState(false)
  const [customerSaving, setCustomerSaving] = useState(false)
  const [customerForm, setCustomerForm] = useState<CustomerEditForm>({
    first_name: '',
    last_name: '',
    business_name: '',
    phone: '',
    email: '',
  })
  const [addressForm, setAddressForm] = useState<AddressEditForm>({
    street_1: '',
    street_2: '',
    city: '',
    state: '',
    zip_code: '',
    gate_code: '',
    notes: '',
  })
  const [appointmentForm, setAppointmentForm] = useState<AppointmentEditForm>({
    lead_source: '',
  })
  const [gpsCapturing, setGpsCapturing] = useState(false)
  const [gpsCoords, setGpsCoords] = useState<{
    lat: number
    lng: number
  } | null>(null)
  const [gpsFeedback, setGpsFeedback] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  const handleCaptureGps = async () => {
    const apptId = unwrapRelation(invoice?.ops_appointments)?.id
    if (!apptId) return

    setGpsCapturing(true)
    setGpsFeedback(null)

    try {
      const coords = await getCurrentLocation()
      if (!coords) {
        setGpsFeedback({
          ok: false,
          message:
            'Could not get your location. Make sure location is enabled.',
        })
        return
      }

      const res = await fetch(`/api/admin/ops/appointments/${apptId}/gps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: coords.lat, lng: coords.lng }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save GPS')
      }

      setGpsCoords(coords)
      setGpsFeedback({
        ok: true,
        message: `GPS saved: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`,
      })
      setTimeout(() => setGpsFeedback(null), 5000)
    } catch (err) {
      setGpsFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to capture GPS',
      })
    } finally {
      setGpsCapturing(false)
    }
  }

  const loadInvoice = useCallback(async () => {
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
      setPaymentMethod(result.invoice.payment_method ?? null)

      // Load appointment data for GPS and photos
      const appt = Array.isArray(result.invoice.ops_appointments)
        ? result.invoice.ops_appointments[0]
        : result.invoice.ops_appointments

      // Load GPS coordinates if they exist
      if (
        appt?.gps_lat &&
        appt?.gps_lng &&
        Number.isFinite(appt.gps_lat) &&
        Number.isFinite(appt.gps_lng)
      ) {
        setGpsCoords({ lat: appt.gps_lat, lng: appt.gps_lng })
      }

      // Photos are now embedded in the invoice response via the appointment join
      const embeddedPhotos = appt?.ops_job_photos ?? null
      if (Array.isArray(embeddedPhotos)) {
        setPhotos(embeddedPhotos)
      } else if (appt?.id) {
        // Fallback: fetch separately if the join didn't return photos
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
  }, [invoiceId])

  useEffect(() => {
    void loadInvoice()
  }, [loadInvoice])

  useEffect(() => {
    const ap = invoice ? unwrapRelation(invoice.ops_appointments) : null
    if (!ap?.id || ap.status !== 'on_my_way') return
    const raw = sessionStorage.getItem(`ops_onmyway_${ap.id}`)
    if (raw && driveStartedAtMs === null) {
      const ms = Number(raw)
      if (Number.isFinite(ms)) setDriveStartedAtMs(ms)
    }
  }, [invoice, driveStartedAtMs])

  useEffect(() => {
    const ap = invoice ? unwrapRelation(invoice.ops_appointments) : null
    if (!ap?.id || ap.status !== 'on_my_way') return
    const raw = sessionStorage.getItem(`ops_omw_sms_${ap.id}`)
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
  }, [invoice])

  useEffect(() => {
    const ap = invoice ? unwrapRelation(invoice.ops_appointments) : null
    if (ap?.id && ap.status === 'completed') {
      const rawStart = sessionStorage.getItem(`ops_onmyway_${ap.id}`)
      if (rawStart) {
        const mins = Math.round((Date.now() - Number(rawStart)) / 60000)
        sessionStorage.setItem(
          `ops_drive_saved_min_${ap.id}`,
          String(Math.max(0, mins)),
        )
      }
      sessionStorage.removeItem(`ops_onmyway_${ap.id}`)
      sessionStorage.removeItem(`ops_omw_sms_${ap.id}`)
      setDriveStartedAtMs(null)
      setOnMyWaySmsInfo(null)
    }
  }, [invoice])

  useEffect(() => {
    const ap = invoice ? unwrapRelation(invoice.ops_appointments) : null
    if (ap?.status !== 'on_my_way' || driveStartedAtMs == null) return
    const tick = () => setDriveElapsedMs(Date.now() - driveStartedAtMs)
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [invoice, driveStartedAtMs])

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
          payment_method: paymentMethod,
          discount_amount: Number(discount || 0),
          percentage_discount_amount: percentageDiscountAmount,
          percentage_discount_label: invoice?.percentage_discount_label ?? null,
          percentage_discount_percent:
            invoice?.percentage_discount_percent ?? 0,
          percentage_discount_scope: invoice?.percentage_discount_scope ?? null,
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

  const enterCustomerEdit = () => {
    const appt = unwrapRelation(invoice?.ops_appointments)
    const cust = unwrapRelation(appt?.ops_customers)
    const addr = unwrapRelation(appt?.ops_service_addresses)
    setCustomerForm({
      first_name: cust?.first_name || '',
      last_name: cust?.last_name || '',
      business_name: cust?.business_name || '',
      phone: cust?.phone || '',
      email: cust?.email || '',
    })
    setAddressForm({
      street_1: addr?.street_1 || '',
      street_2: addr?.street_2 || '',
      city: addr?.city || '',
      state: addr?.state || '',
      zip_code: addr?.zip_code || '',
      gate_code: addr?.gate_code || '',
      notes: addr?.notes || '',
    })
    setAppointmentForm({
      lead_source: appt?.lead_source || '',
    })
    setEditingCustomer(true)
  }

  const handleSaveCustomer = async () => {
    setCustomerSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/ops/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: {
            first_name: customerForm.first_name,
            last_name: customerForm.last_name,
            business_name: customerForm.business_name || null,
            phone: customerForm.phone,
            email: customerForm.email || null,
          },
          address: {
            street_1: addressForm.street_1,
            street_2: addressForm.street_2 || null,
            city: addressForm.city,
            state: addressForm.state,
            zip_code: addressForm.zip_code,
            gate_code: addressForm.gate_code || null,
            notes: addressForm.notes || null,
          },
          appointment: {
            lead_source: appointmentForm.lead_source || null,
          },
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update customer')
      }
      setEditingCustomer(false)
      await loadInvoice()
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to update customer',
      )
    } finally {
      setCustomerSaving(false)
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
      const result = (await response.json()) as {
        error?: string
        lifecycle_notifications?: Array<{
          channel: string
          body: string
          actually_sent?: boolean
        }>
      }
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update job')
      }
      const sms = result.lifecycle_notifications?.find(
        (n) => n.channel === 'sms',
      )
      if (sms && typeof sms.body === 'string') {
        const actuallySent = sms.actually_sent !== false
        const next: OnMyWaySmsInfo = { body: sms.body, actuallySent }
        setOnMyWaySmsInfo(next)
        sessionStorage.setItem(
          `ops_omw_sms_${appointment.id}`,
          JSON.stringify(next),
        )
      }
      if (updates.status === 'on_my_way') {
        const t = Date.now()
        setDriveStartedAtMs(t)
        sessionStorage.setItem(`ops_onmyway_${appointment.id}`, String(t))
      }
      await loadInvoice()
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

  const handleSend = async (channel: SendChannel, type?: 'receipt') => {
    setSendLoading(channel)
    setSendFeedback(null)
    try {
      const response = await fetch(
        `/api/admin/ops/invoices/${invoiceId}/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel, type }),
        },
      )
      const result = (await response.json()) as {
        error?: string
        sms?: { sid?: string; to?: string }
        email_delivery?: { to?: string; id?: string }
      }
      if (!response.ok) {
        setSendFeedback({
          channel,
          ok: false,
          message: result.error || 'Failed to send',
        })
      } else {
        const mailedTo =
          type === 'receipt'
            ? (result.email_delivery?.to ?? '').trim() || undefined
            : undefined
        setSendFeedback({
          channel,
          ok: true,
          message:
            type === 'receipt'
              ? mailedTo
                ? `Receipt emailed to ${mailedTo}.`
                : 'Receipt emailed.'
              : channel === 'sms'
                ? 'Text sent!'
                : 'Email sent!',
        })
        const hideAfterMs = type === 'receipt' ? 8000 : 4000
        setTimeout(() => setSendFeedback(null), hideAfterMs)
        // Auto-advance status to sent
        if (status === 'pending' && type !== 'receipt') {
          setStatus('sent')
          await fetch(`/api/admin/ops/invoices/${invoiceId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'sent' }),
          })
        }
      }
    } catch {
      setSendFeedback({ channel, ok: false, message: 'Failed to send' })
    } finally {
      setSendLoading(null)
    }
  }

  const handleMarkPaid = async (method: string) => {
    setStatus('paid')
    setPaymentMethod(method)
    try {
      await fetch(`/api/admin/ops/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid', payment_method: method }),
      })
    } catch {
      // best-effort — state is already updated optimistically
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

  const handleSaveSignature = async (
    signatureData: string,
    customerName: string,
  ) => {
    try {
      const res = await fetch(
        `/api/admin/ops/invoices/${invoiceId}/signature`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signatureData, customerName }),
        },
      )

      if (!res.ok) throw new Error('Failed to save signature')

      const data = await res.json()

      // Update local invoice state
      setInvoice((prev) =>
        prev
          ? {
              ...prev,
              signature_url: data.signatureUrl,
              signature_captured_at: new Date().toISOString(),
              signature_customer_name: customerName,
            }
          : null,
      )

      alert('Signature saved successfully!')
    } catch (err) {
      console.error('Signature save error:', err)
      throw err
    }
  }

  const handleSendPaymentLink = async (
    type: 'quickbooks' | 'square' | 'venmo',
  ) => {
    setPaymentLinkLoading(type)
    setPaymentLinkFeedback(null)
    try {
      const response = await fetch(
        `/api/admin/ops/invoices/${invoiceId}/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'sms',
            type:
              type === 'quickbooks'
                ? 'payment_link'
                : type === 'square'
                  ? 'square_payment_link'
                  : 'venmo_payment_link',
          }),
        },
      )
      const result = await response.json()
      if (!response.ok) {
        const message = result.error || 'Failed to send payment link'
        setPaymentLinkFeedback({
          type,
          ok: false,
          message,
        })
        if (type === 'quickbooks') setError(message)
      } else {
        setPaymentLinkFeedback({
          type,
          ok: true,
          message:
            type === 'quickbooks'
              ? invoice?.quickbooks_invoice_id
                ? `QuickBooks payment link sent to ${result.sms?.to || 'customer'}${result.sms?.sid ? ` (${result.sms.sid})` : ''}.`
                : `QuickBooks invoice synced and payment link sent to ${result.sms?.to || 'customer'}${result.sms?.sid ? ` (${result.sms.sid})` : ''}.`
              : type === 'square'
                ? `Square payment link sent to ${result.sms?.to || 'customer'}${result.sms?.sid ? ` (${result.sms.sid})` : ''}.`
                : `Venmo payment link sent to ${result.sms?.to || 'customer'}${result.sms?.sid ? ` (${result.sms.sid})` : ''}.`,
        })
        if (type === 'quickbooks') await loadInvoice()
        if (type === 'quickbooks') setError(null)
        setTimeout(() => setPaymentLinkFeedback(null), 8000)
      }
    } catch (sendError) {
      const message =
        sendError instanceof Error
          ? sendError.message
          : 'Failed to send payment link'
      setPaymentLinkFeedback({
        type,
        ok: false,
        message,
      })
      if (type === 'quickbooks') setError(message)
    } finally {
      setPaymentLinkLoading(null)
    }
  }

  const handleGenerateDescription = async () => {
    const addr = unwrapRelation(
      unwrapRelation(invoice?.ops_appointments)?.ops_service_addresses,
    )
    const serviceType = lineItems[0]?.description || 'Carpet Cleaning'
    const city = addr?.city || 'Colorado Springs'
    const notes = lineItems
      .map((li) => li.description)
      .filter(Boolean)
      .join(', ')

    setAiDescLoading(true)
    try {
      const res = await fetch('/api/generate-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceType,
          city,
          neighborhood: '',
          notes,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate')
      setAiDescription(data.description || '')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate description',
      )
    } finally {
      setAiDescLoading(false)
    }
  }

  const resolveDriveMinutesForStats = (): number | null => {
    const ap = unwrapRelation(invoice?.ops_appointments)
    if (!ap?.id) return null
    const saved = sessionStorage.getItem(`ops_drive_saved_min_${ap.id}`)
    if (saved != null && Number.isFinite(Number(saved))) {
      return Math.max(0, Math.round(Number(saved)))
    }
    if (ap.status === 'on_my_way' && driveStartedAtMs != null) {
      return Math.max(0, Math.round((Date.now() - driveStartedAtMs) / 60000))
    }
    return null
  }

  const handleFinishAndCloseJob = async () => {
    setStatsRecordLoading(true)
    setStatsRecordMessage(null)
    setError(null)
    try {
      const driveMinutes = resolveDriveMinutesForStats()
      const response = await fetch(
        `/api/admin/ops/invoices/${invoiceId}/record-stats`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(driveMinutes != null ? { drive_minutes: driveMinutes } : {}),
            mark_completed: true,
          }),
        },
      )
      const result = (await response.json()) as {
        error?: string
        ok?: boolean
        already_recorded?: boolean
        message?: string
      }
      if (!response.ok) {
        throw new Error(result.error || 'Failed to close out job')
      }
      if (result.already_recorded) {
        setStatsRecordMessage(
          result.message ||
            'This job was already closed out in stats (no duplicate revenue). QuickBooks sync was retried if applicable.',
        )
      } else {
        setStatsRecordMessage(
          'Job closed: revenue, stats, and QuickBooks updated. You can still combine photos below if you want a post later.',
        )
      }
      await loadInvoice()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close out job')
    } finally {
      setStatsRecordLoading(false)
    }
  }

  const handleFinishAndPublish = async () => {
    if (!combinedImageDataUrl) {
      setError('Please combine before/after photos first.')
      return
    }
    if (!aiDescription.trim()) {
      setError('Please generate or write an AI description first.')
      return
    }

    setPublishLoading(true)
    setError(null)
    try {
      const res = await fetch(combinedImageDataUrl)
      const blob = await res.blob()
      const imageFile = new File([blob], 'combined.jpg', {
        type: 'image/jpeg',
      })

      const fd = new FormData()
      fd.append('image', imageFile)
      fd.append('description', aiDescription)

      const response = await fetch(
        `/api/admin/ops/invoices/${invoiceId}/publish`,
        { method: 'POST', body: fd },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to publish')
      }

      setPublishSuccess(true)
      router.refresh()
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : 'Failed to publish job',
      )
    } finally {
      setPublishLoading(false)
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
  const percentageDiscountAmount = Math.max(
    0,
    Number(invoice.percentage_discount_amount || 0),
  )
  const total = Math.max(
    0,
    subtotalCalc - discountAmount - percentageDiscountAmount,
  )
  const billableTotal = total > 0.005 ? total : Number(invoice?.total || 0)
  const squareAmount = formatSquareAmount(billableTotal)
  const receiptEmail = customer?.email?.trim() ?? ''

  return (
    <div className="space-y-6">
      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      {/* ── Customer header card ───────────────────────────── */}
      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        {/* Top action row */}
        <div className="mb-4 flex items-center justify-end gap-2">
          {!editingCustomer ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={enterCustomerEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          ) : null}
          {appointment?.id ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={Boolean(actionLoading)}
              onClick={() =>
                router.push(`/admin/operations/appointments/${appointment.id}`)
              }
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Reschedule
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="destructive"
            disabled={Boolean(actionLoading)}
            onClick={() => void handleDeleteJob()}
          >
            {actionLoading === 'Delete Job' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Delete Job
          </Button>
        </div>

        {editingCustomer ? (
          /* ── Edit mode ─────────────────────────────────────── */
          <div className="space-y-4">
            <p className="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase">
              Edit Customer &amp; Address
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="edit-first-name" className="text-xs">
                  First Name
                </Label>
                <Input
                  id="edit-first-name"
                  value={customerForm.first_name}
                  onChange={(e) =>
                    setCustomerForm((f) => ({
                      ...f,
                      first_name: e.target.value,
                    }))
                  }
                  className="h-9"
                />
              </div>
              <div>
                <Label htmlFor="edit-last-name" className="text-xs">
                  Last Name
                </Label>
                <Input
                  id="edit-last-name"
                  value={customerForm.last_name}
                  onChange={(e) =>
                    setCustomerForm((f) => ({
                      ...f,
                      last_name: e.target.value,
                    }))
                  }
                  className="h-9"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="edit-business" className="text-xs">
                Business Name
              </Label>
              <Input
                id="edit-business"
                value={customerForm.business_name}
                onChange={(e) =>
                  setCustomerForm((f) => ({
                    ...f,
                    business_name: e.target.value,
                  }))
                }
                className="h-9"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="edit-phone" className="text-xs">
                  Phone
                </Label>
                <Input
                  id="edit-phone"
                  value={customerForm.phone}
                  onChange={(e) =>
                    setCustomerForm((f) => ({ ...f, phone: e.target.value }))
                  }
                  className="h-9"
                />
              </div>
              <div>
                <Label htmlFor="edit-email" className="text-xs">
                  Email
                </Label>
                <Input
                  id="edit-email"
                  value={customerForm.email}
                  onChange={(e) =>
                    setCustomerForm((f) => ({ ...f, email: e.target.value }))
                  }
                  className="h-9"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="edit-lead-source" className="text-xs">
                Lead Source
              </Label>
              <select
                id="edit-lead-source"
                value={appointmentForm.lead_source}
                onChange={(e) =>
                  setAppointmentForm((f) => ({
                    ...f,
                    lead_source: e.target.value,
                  }))
                }
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="">Not specified</option>
                <option value="Google">Google</option>
                <option value="Nextdoor">Nextdoor</option>
                <option value="Facebook">Facebook</option>
                <option value="Yelp">Yelp</option>
                <option value="ChatGPT">ChatGPT</option>
                <option value="Gemini">Gemini</option>
                <option value="Claude">Claude</option>
                <option value="Grok">Grok</option>
                <option value="Perplexity">Perplexity</option>
                <option value="Saw truck/vehicle wrap">
                  Saw truck/vehicle wrap
                </option>
                <option value="Word of mouth / Referral">
                  Word of mouth / Referral
                </option>
                <option value="Repeat customer">Repeat customer</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="border-border/60 border-t pt-4">
              <p className="text-muted-foreground mb-3 text-xs font-medium tracking-[0.2em] uppercase">
                Service Address
              </p>
              <div>
                <Label htmlFor="edit-street1" className="text-xs">
                  Street
                </Label>
                <Input
                  id="edit-street1"
                  value={addressForm.street_1}
                  onChange={(e) =>
                    setAddressForm((f) => ({ ...f, street_1: e.target.value }))
                  }
                  className="h-9"
                />
              </div>
              <div className="mt-2">
                <Label htmlFor="edit-street2" className="text-xs">
                  Street 2
                </Label>
                <Input
                  id="edit-street2"
                  value={addressForm.street_2}
                  onChange={(e) =>
                    setAddressForm((f) => ({ ...f, street_2: e.target.value }))
                  }
                  className="h-9"
                  placeholder="Apt, Suite, etc."
                />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div>
                  <Label htmlFor="edit-city" className="text-xs">
                    City
                  </Label>
                  <Input
                    id="edit-city"
                    value={addressForm.city}
                    onChange={(e) =>
                      setAddressForm((f) => ({ ...f, city: e.target.value }))
                    }
                    className="h-9"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-state" className="text-xs">
                    State
                  </Label>
                  <Input
                    id="edit-state"
                    value={addressForm.state}
                    onChange={(e) =>
                      setAddressForm((f) => ({ ...f, state: e.target.value }))
                    }
                    className="h-9"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-zip" className="text-xs">
                    Zip
                  </Label>
                  <Input
                    id="edit-zip"
                    value={addressForm.zip_code}
                    onChange={(e) =>
                      setAddressForm((f) => ({
                        ...f,
                        zip_code: e.target.value,
                      }))
                    }
                    className="h-9"
                  />
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="edit-gate" className="text-xs">
                    Gate Code
                  </Label>
                  <Input
                    id="edit-gate"
                    value={addressForm.gate_code}
                    onChange={(e) =>
                      setAddressForm((f) => ({
                        ...f,
                        gate_code: e.target.value,
                      }))
                    }
                    className="h-9"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-addr-notes" className="text-xs">
                    Access Notes
                  </Label>
                  <Input
                    id="edit-addr-notes"
                    value={addressForm.notes}
                    onChange={(e) =>
                      setAddressForm((f) => ({ ...f, notes: e.target.value }))
                    }
                    className="h-9"
                    placeholder="Optional"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 gap-2"
                disabled={customerSaving}
                onClick={() => void handleSaveCustomer()}
              >
                {customerSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {customerSaving ? 'Saving…' : 'Save Changes'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setEditingCustomer(false)}
                disabled={customerSaving}
              >
                Cancel
              </Button>
              {paymentLinkFeedback?.type === 'quickbooks' ? (
                <p
                  className={`mt-2 text-sm ${paymentLinkFeedback.ok ? 'text-green-700' : 'text-red-600'}`}
                >
                  {paymentLinkFeedback.message}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          /* ── View mode (existing display) ──────────────────── */
          <>
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
              <p className="text-3xl font-bold tabular-nums">
                ${billableTotal.toFixed(2)}
              </p>
            </div>

            {/* On My Way button */}
            {appointment?.id ? (
              <div className="border-border/60 bg-muted/30 mt-5 rounded-xl border p-4">
                <Button
                  variant="outline"
                  className={`h-14 w-full text-base font-semibold ${
                    appointment.status === 'on_my_way'
                      ? 'border-green-600 bg-green-600 text-white hover:bg-green-700'
                      : ''
                  }`}
                  disabled={Boolean(actionLoading)}
                  onClick={() =>
                    void runAppointmentAction({
                      label: 'On My Way',
                      status: 'on_my_way',
                    })
                  }
                >
                  {actionLoading === 'On My Way' ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : null}
                  On My Way
                </Button>
                {appointment.status === 'on_my_way' &&
                driveStartedAtMs != null ? (
                  <p className="mt-3 text-center font-mono text-sm font-semibold text-green-700">
                    Drive time {formatDriveElapsed(driveElapsedMs)}
                  </p>
                ) : null}
                <div className="border-border/60 bg-background/70 mt-3 min-h-[4rem] rounded-lg border p-3">
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
                      After you tap On My Way, the exact message text appears
                      here so you can confirm what customers receive.
                    </p>
                  )}
                </div>
              </div>
            ) : null}

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
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="text-muted-foreground h-4 w-4 shrink-0" />
                    <span className="text-muted-foreground flex-1">
                      {address.street_1}
                      {address.street_2 ? `, ${address.street_2}` : ''},{' '}
                      {address.city}, {address.state} {address.zip_code}
                    </span>
                  </div>
                  {address.gate_code ? (
                    <p className="text-muted-foreground ml-6 text-xs">
                      Gate: {address.gate_code}
                    </p>
                  ) : null}
                  {address.notes ? (
                    <p className="text-muted-foreground ml-6 text-xs">
                      Notes: {address.notes}
                    </p>
                  ) : null}
                  <Button
                    size="default"
                    className="w-full gap-2 bg-green-600 font-bold tracking-widest text-white uppercase hover:bg-green-500"
                    asChild
                  >
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MapPin className="h-4 w-4" />
                      Get Directions
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
          </>
        )}

        {/* Divider + receipt delivery actions */}
        <div className="border-border/60 mt-6 border-t pt-5">
          <p className="text-muted-foreground mb-3 text-xs font-semibold tracking-widest uppercase">
            Receipt
          </p>
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs">
              {status !== 'paid'
                ? 'Mark the invoice paid first, then email the itemized receipt.'
                : receiptEmail
                  ? `Sends to the customer email on file: ${receiptEmail}. Edit Customer to change it, then Save.`
                  : 'Add and save an email address on this customer before sending a receipt.'}
            </p>
            <Button
              variant="outline"
              className="gap-2"
              disabled={
                sendLoading !== null || status !== 'paid' || !receiptEmail
              }
              onClick={() => void handleSend('email', 'receipt')}
            >
              {sendLoading === 'email' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              Email Itemized Receipt
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

      {/* ── Street View panel ───────────────────────────────── */}
      {address && !streetViewFailed ? (
        <Card className="border-border/60 overflow-hidden shadow-sm">
          <img
            src={`/api/admin/streetview?address=${encodeURIComponent(
              `${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`,
            )}`}
            alt={`Street view of ${address.street_1}`}
            className="w-full object-cover"
            style={{ height: '200px' }}
            onError={() => setStreetViewFailed(true)}
          />
          <div className="bg-muted/40 text-muted-foreground px-4 py-2 text-xs">
            Street View · {address.street_1}, {address.city}
          </div>
        </Card>
      ) : null}

      {/* ── Invoice status card ─────────────────────────────── */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        {/* Status badge */}
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Invoice</h3>
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              status === 'paid'
                ? 'bg-green-100 text-green-800'
                : status === 'sent'
                  ? 'bg-blue-100 text-blue-800'
                  : status === 'void'
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-amber-100 text-amber-800'
            }`}
          >
            {status === 'paid' && paymentMethod
              ? `Paid · ${paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)}`
              : status === 'paid'
                ? 'Paid'
                : status === 'sent'
                  ? 'Sent'
                  : status === 'void'
                    ? 'Void'
                    : 'Pending'}
          </span>
        </div>

        {/* Mark as Paid */}
        {status !== 'paid' ? (
          <div className="mb-5">
            <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-widest uppercase">
              Mark as Paid
            </p>
            <div className="flex flex-wrap gap-2">
              {['Square', 'Cash', 'Venmo', 'Check'].map((method) => (
                <Button
                  key={method}
                  size="sm"
                  variant="outline"
                  className={
                    method === 'Square'
                      ? 'gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50'
                      : 'gap-1.5 border-green-300 text-green-700 hover:bg-green-50'
                  }
                  onClick={() => void handleMarkPaid(method.toLowerCase())}
                >
                  {method === 'Square' ? (
                    <SquareLogoMark className="h-3.5 w-3.5" />
                  ) : method === 'Venmo' ? (
                    <VenmoLogoMark className="h-3.5 w-3.5 text-[13px]" />
                  ) : null}
                  {method}
                </Button>
              ))}
            </div>

            {squareAmount ? (
              <div className="mt-4 rounded-xl border border-black bg-neutral-950 p-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  <SquareLogoMark className="h-4 w-4" />
                  Square Pay
                </p>
                <p className="mt-1 text-xs text-neutral-300">
                  Text a Square checkout link for ${squareAmount}, then mark
                  this invoice Square paid above after payment.
                </p>
                <Button
                  className="mt-3 w-full gap-2 bg-white text-black hover:bg-neutral-200"
                  disabled={paymentLinkLoading !== null}
                  onClick={() => void handleSendPaymentLink('square')}
                >
                  {paymentLinkLoading === 'square' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <SquareLogoMark className="h-4 w-4" />
                  )}
                  {paymentLinkLoading === 'square'
                    ? 'Sending Square Link...'
                    : 'Text Square Pay Link'}
                </Button>
                {paymentLinkFeedback?.type === 'square' ? (
                  <p
                    className={`mt-2 text-sm ${paymentLinkFeedback.ok ? 'text-green-300' : 'text-red-300'}`}
                  >
                    {paymentLinkFeedback.message}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-blue-950">
                <VenmoLogoMark className="h-4 w-4 text-[15px] text-[#008CFF]" />
                Venmo Pay
              </p>
              <p className="mt-1 text-xs text-blue-800">
                Text the Venmo payment link with the exact invoice amount.
              </p>
              <Button
                size="default"
                className="mt-3 w-full gap-2 bg-blue-600 text-white hover:bg-blue-500"
                disabled={paymentLinkLoading !== null}
                onClick={() => void handleSendPaymentLink('venmo')}
              >
                {paymentLinkLoading === 'venmo' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <VenmoLogoMark className="h-3.5 w-3.5 text-[13px]" />
                )}
                {paymentLinkLoading === 'venmo'
                  ? 'Sending Venmo Link...'
                  : 'Text Venmo Pay Link'}
              </Button>
              {paymentLinkFeedback?.type === 'venmo' ? (
                <p
                  className={`mt-2 text-sm ${paymentLinkFeedback.ok ? 'text-green-600' : 'text-red-500'}`}
                >
                  {paymentLinkFeedback.message}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mb-5">
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground text-xs"
              onClick={() => {
                setStatus('pending')
                setPaymentMethod(null)
              }}
            >
              Undo payment
            </Button>
          </div>
        )}
      </Card>

      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Line Items</h3>
          <Button
            type="button"
            size="default"
            className="bg-emerald-700 px-5 text-white hover:bg-emerald-600"
            onClick={() => {
              setPickerCategory(null)
              setShowServicePicker(true)
            }}
          >
            + Add Service
          </Button>
        </div>

        {/* ── Service Picker Modal ─────────────────────────── */}
        {showServicePicker ? (
          <div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/50 sm:items-center">
            <div className="bg-card w-full max-w-sm rounded-t-2xl p-5 shadow-xl sm:rounded-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h4 className="text-base font-semibold">
                  {pickerCategory ? pickerCategory : 'Select a category'}
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setShowServicePicker(false)
                    setPickerCategory(null)
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {pickerCategory === null ? (
                /* Step 1 — Category list */
                <div className="space-y-2">
                  {Array.from(new Set(serviceCatalog.map((s) => s.category)))
                    .sort()
                    .map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        className="border-border/60 hover:bg-accent w-full rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors"
                        onClick={() => setPickerCategory(cat)}
                      >
                        {cat}
                        <span className="text-muted-foreground ml-2 text-xs font-normal">
                          (
                          {
                            serviceCatalog.filter((s) => s.category === cat)
                              .length
                          }
                          )
                        </span>
                      </button>
                    ))}
                </div>
              ) : (
                /* Step 2 — Services in selected category */
                <div className="space-y-2">
                  <button
                    type="button"
                    className="text-muted-foreground mb-1 flex items-center gap-1 text-xs hover:underline"
                    onClick={() => setPickerCategory(null)}
                  >
                    ← Back
                  </button>
                  {serviceCatalog
                    .filter((s) => s.category === pickerCategory)
                    .map((service) => (
                      <button
                        key={service.id}
                        type="button"
                        className="border-border/60 hover:bg-accent flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-colors"
                        onClick={() => {
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
                          setShowServicePicker(false)
                          setPickerCategory(null)
                        }}
                      >
                        <span className="font-medium">{service.name}</span>
                        {service.base_price != null ? (
                          <span className="text-muted-foreground text-xs">
                            ${service.base_price}
                          </span>
                        ) : null}
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
        <div className="mt-3 space-y-2">
          {lineItems.map((item, index) => (
            <div key={item.id} className="rounded-xl bg-white p-3 shadow-sm">
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
                      className={`h-10 text-base ${lineItemInputTone(index)}`}
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
                    <Label className="text-xs">Qty</Label>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() =>
                          setLineItems((current) =>
                            current.map((line, lineIndex) =>
                              lineIndex === index
                                ? {
                                    ...line,
                                    quantity: Math.max(1, line.quantity - 1),
                                  }
                                : line,
                            ),
                          )
                        }
                      >
                        −
                      </Button>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        value={String(item.quantity)}
                        className={`h-10 text-center text-base tabular-nums ${lineItemInputTone(index)}`}
                        onChange={(event) => {
                          const nextQuantity = Number(event.target.value || 0)
                          if (
                            Number.isFinite(nextQuantity) &&
                            nextQuantity >= 1
                          ) {
                            setLineItems((current) =>
                              current.map((line, lineIndex) =>
                                lineIndex === index
                                  ? { ...line, quantity: nextQuantity }
                                  : line,
                              ),
                            )
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() =>
                          setLineItems((current) =>
                            current.map((line, lineIndex) =>
                              lineIndex === index
                                ? { ...line, quantity: line.quantity + 1 }
                                : line,
                            ),
                          )
                        }
                      >
                        +
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Unit Price</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={item.unit_price || ''}
                      className={`h-10 text-base ${lineItemInputTone(index)}`}
                      onChange={(e) => {
                        const value = e.target.value
                        // Allow empty, digits, and one decimal point
                        if (value === '' || /^\d*\.?\d{0,2}$/.test(value)) {
                          setLineItems((current) =>
                            current.map((line, lineIndex) =>
                              lineIndex === index
                                ? { ...line, unit_price: value }
                                : line,
                            ),
                          )
                        }
                      }}
                      onBlur={(e) => {
                        // Format on blur to ensure proper decimal places
                        const value = e.target.value
                        const numValue = parseFloat(value)
                        if (!isNaN(numValue) && numValue >= 0) {
                          setLineItems((current) =>
                            current.map((line, lineIndex) =>
                              lineIndex === index
                                ? {
                                    ...line,
                                    unit_price: numValue.toFixed(2),
                                  }
                                : line,
                            ),
                          )
                        } else {
                          // Reset to 0 if invalid
                          setLineItems((current) =>
                            current.map((line, lineIndex) =>
                              lineIndex === index
                                ? { ...line, unit_price: '0.00' }
                                : line,
                            ),
                          )
                        }
                      }}
                      placeholder="0.00"
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
                Dollar Discounts
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
          {percentageDiscountAmount > 0 ? (
            <div className="flex items-center justify-end gap-4">
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-right text-sm text-green-800">
                <div className="font-medium">Percentage Discounts</div>
                <div className="text-xs">
                  {invoice.percentage_discount_label || 'Scoped discount'} ·{' '}
                  {Number(invoice.percentage_discount_percent || 0).toFixed(0)}%
                  off{' '}
                  {invoice.percentage_discount_scope === 'rug_cleaning'
                    ? 'rug cleaning'
                    : invoice.percentage_discount_scope || 'selected items'}
                  : −${percentageDiscountAmount.toFixed(2)}
                </div>
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <Button onClick={handleSave} disabled={saving} className="px-8">
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save Invoice
            </Button>
            <div className="flex items-center gap-6 text-lg font-bold">
              <span>Total</span>
              <span className="tabular-nums">${billableTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Get Signature Button */}
          {!invoice?.signature_url && billableTotal > 0 && (
            <div className="border-border/60 mt-4 border-t pt-4">
              <Button
                onClick={() => setShowSignatureModal(true)}
                variant="outline"
                className="w-full gap-2 border-green-500/40 text-green-400 hover:border-green-400 hover:bg-green-500/10"
              >
                <PenTool className="h-4 w-4" />
                Get Customer Signature
              </Button>
              <p className="text-muted-foreground mt-2 text-center text-xs">
                Capture signature to confirm price agreement
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Customer Signature */}
      {invoice?.signature_url && (
        <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
          <div className="mb-3 flex items-center gap-2">
            <PenTool className="text-muted-foreground h-5 w-5" />
            <h3 className="text-lg font-semibold">Customer Signature</h3>
            <Badge variant="outline" className="bg-green-500/15 text-green-400">
              Signed
            </Badge>
          </div>
          <div className="space-y-3">
            <div className="border-border/60 overflow-hidden rounded-xl border bg-white p-4">
              <img
                src={invoice.signature_url}
                alt="Customer signature"
                className="mx-auto max-h-32 w-auto"
              />
            </div>
            <div className="text-muted-foreground text-sm">
              <p>
                <strong>Signed by:</strong> {invoice.signature_customer_name}
              </p>
              <p>
                <strong>Date:</strong>{' '}
                {invoice.signature_captured_at
                  ? new Date(invoice.signature_captured_at).toLocaleString(
                      'en-US',
                      {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      },
                    )
                  : 'Unknown'}
              </p>
              <p>
                <strong>Amount:</strong> ${billableTotal.toFixed(2)}
              </p>
            </div>
          </div>
        </Card>
      )}
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
        <div className="border-border/60 mt-4 border-t pt-4">
          <div className="flex flex-wrap items-center gap-3">
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
          </div>

          {photoError ? (
            <p className="mt-2 text-sm text-red-500">{photoError}</p>
          ) : null}
        </div>
      </Card>

      {/* Close out job: revenue, stats, QuickBooks; social post is optional below */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Finish &amp; close job</h3>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Use this when the work is done. It records revenue and hours in your
          stats (including drive time from <strong>On My Way</strong> when
          available), marks the job completed, and sends the invoice to{' '}
          <strong>QuickBooks</strong> when connected. You do not need a social
          post—use the section below only if you want a before/after post.
        </p>
        <div className="border-border/60 mt-4 rounded-xl border bg-white/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Job-site GPS</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Same backup as the old jobs tab. Tap this on-site before
                publishing the map post.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={gpsCapturing}
              onClick={() => void handleCaptureGps()}
            >
              {gpsCapturing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MapPin className="h-4 w-4" />
              )}
              {gpsCapturing ? 'Getting…' : 'Use Current Location'}
            </Button>
          </div>
          {gpsFeedback ? (
            <p
              className={`mt-2 text-sm ${gpsFeedback.ok ? 'text-green-600' : 'text-red-500'}`}
            >
              {gpsFeedback.message}
            </p>
          ) : gpsCoords ? (
            <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
              <MapPin className="h-3.5 w-3.5" />
              GPS: {gpsCoords.lat.toFixed(6)}, {gpsCoords.lng.toFixed(6)}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          className="mt-4 h-14 w-full border-green-600 bg-green-600 text-base font-semibold text-white hover:bg-green-700"
          disabled={statsRecordLoading}
          onClick={() => void handleFinishAndCloseJob()}
        >
          {statsRecordLoading ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : null}
          {statsRecordLoading ? 'Closing out…' : 'Finish & close job'}
        </Button>
        {statsRecordMessage ? (
          <p className="text-muted-foreground mt-3 text-center text-sm">
            {statsRecordMessage}
          </p>
        ) : null}
      </Card>

      {/* ── Before / After Combiner ──────────────────────── */}
      <BeforeAfterCombiner
        onCombined={(dataUrl) => setCombinedImageDataUrl(dataUrl)}
      />

      {/* ── AI Description ────────────────────────────────── */}
      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">AI Description</h3>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={aiDescLoading}
            onClick={() => void handleGenerateDescription()}
          >
            {aiDescLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {aiDescLoading ? 'Generating…' : 'Generate'}
          </Button>
        </div>
        <textarea
          className="border-border/60 bg-background/70 mt-3 w-full rounded-xl border p-3 text-sm"
          rows={4}
          placeholder="Generated description will appear here. You can also type your own."
          value={aiDescription}
          onChange={(e) => setAiDescription(e.target.value)}
        />
      </Card>

      {/* ── Social publish (optional) ───────────────────── */}
      {!publishSuccess ? (
        <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
          <p className="text-muted-foreground mb-3 text-sm leading-relaxed">
            Optional: create a public before/after post. Your utilization stats
            already count from the job record when you publish; use{' '}
            <strong>Finish &amp; close job</strong> above if you are skipping
            social media.
          </p>
          <div className="bg-muted/50 border-border/60 mb-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {gpsCoords
                    ? 'GPS: Using device location'
                    : 'GPS: Not captured'}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleCaptureGps()}
                disabled={gpsCapturing}
              >
                {gpsCapturing ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Getting...
                  </>
                ) : (
                  <>
                    <MapPin className="mr-2 h-3 w-3" />
                    Use Current Location
                  </>
                )}
              </Button>
            </div>
            {gpsFeedback ? (
              <p
                className={`mt-2 text-sm ${gpsFeedback.ok ? 'text-green-600' : 'text-red-500'}`}
              >
                {gpsFeedback.message}
              </p>
            ) : gpsCoords ? (
              <p className="text-muted-foreground mt-2 text-xs">
                Coordinates: {gpsCoords.lat.toFixed(6)},{' '}
                {gpsCoords.lng.toFixed(6)}
              </p>
            ) : (
              <p className="text-muted-foreground mt-2 text-xs">
                Publishing is blocked until this is captured, so it cannot drop
                another pin in central Colorado Springs.
              </p>
            )}
          </div>
          <Button
            className="h-14 w-full gap-2 bg-green-600 text-lg font-bold text-white hover:bg-green-700"
            disabled={
              publishLoading ||
              !combinedImageDataUrl ||
              !aiDescription.trim() ||
              !gpsCoords
            }
            onClick={() => void handleFinishAndPublish()}
          >
            {publishLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
            {publishLoading ? 'Publishing…' : 'Publish to social & create post'}
          </Button>
          {!combinedImageDataUrl || !aiDescription.trim() || !gpsCoords ? (
            <p className="text-muted-foreground mt-2 text-center text-xs">
              {!gpsCoords
                ? 'Use Current Location before publishing the map post'
                : !combinedImageDataUrl && !aiDescription.trim()
                  ? 'Combine photos and generate a description to publish'
                  : !combinedImageDataUrl
                    ? 'Combine before/after photos to continue'
                    : 'Generate or write a description to continue'}
            </p>
          ) : null}
        </Card>
      ) : (
        <Card className="border-border/60 bg-green-50 p-5 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
          <p className="mt-2 text-lg font-bold text-green-800">
            Post published!
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            The before/after is live and stats include this job from the
            published record.
          </p>
        </Card>
      )}

      {/* Signature Modal */}
      <SignatureModal
        isOpen={showSignatureModal}
        onClose={() => setShowSignatureModal(false)}
        onSave={handleSaveSignature}
        totalAmount={billableTotal}
        customerName={customer?.full_name || ''}
      />
    </div>
  )
}
