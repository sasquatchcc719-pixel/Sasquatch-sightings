'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarClock,
  Camera,
  CheckCircle2,
  CreditCard,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  Send,
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
  ops_customers: OpsCustomer | OpsCustomer[] | null
  ops_service_addresses: OpsAddress | OpsAddress[] | null
}

type InvoiceDetail = {
  id: string
  status: string
  payment_status: string
  payment_method: string | null
  subtotal: number
  total: number
  discount_amount: number | null
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
  const [sendLoading, setSendLoading] = useState<'sms' | 'email' | null>(null)
  const [sendFeedback, setSendFeedback] = useState<{
    channel: 'sms' | 'email'
    ok: boolean
    message: string
  } | null>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentTab, setPaymentTab] = useState<'qr' | 'tap'>('qr')
  const [streetViewFailed, setStreetViewFailed] = useState(false)
  const [showCardForm, setShowCardForm] = useState(false)
  const [cardNumber, setCardNumber] = useState('')
  const [cardExpMonth, setCardExpMonth] = useState('')
  const [cardExpYear, setCardExpYear] = useState('')
  const [cardCvc, setCardCvc] = useState('')
  const [cardName, setCardName] = useState('')
  const [chargeLoading, setChargeLoading] = useState(false)
  const [chargeError, setChargeError] = useState<string | null>(null)
  const [chargeSuccess, setChargeSuccess] = useState(false)
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false)
  const [paymentLinkFeedback, setPaymentLinkFeedback] = useState<{
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
        // Auto-advance status to sent
        if (status === 'pending') {
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

  const handleChargeCard = async () => {
    if (!cardNumber || !cardExpMonth || !cardExpYear || !cardCvc) {
      setChargeError('Please fill in all card fields.')
      return
    }

    setChargeLoading(true)
    setChargeError(null)
    setChargeSuccess(false)

    try {
      const QB_TOKEN_URL =
        process.env.NEXT_PUBLIC_QB_SANDBOX === 'true'
          ? 'https://sandbox.api.intuit.com/quickbooks/v4/payments/tokens'
          : 'https://api.intuit.com/quickbooks/v4/payments/tokens'

      const tokenRes = await fetch(QB_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card: {
            number: cardNumber.replace(/\s/g, ''),
            expMonth: cardExpMonth.padStart(2, '0'),
            expYear:
              cardExpYear.length === 2 ? `20${cardExpYear}` : cardExpYear,
            cvc: cardCvc,
            name: cardName || undefined,
          },
        }),
      })

      if (!tokenRes.ok) {
        throw new Error('Card tokenization failed. Please check card details.')
      }

      const tokenData = await tokenRes.json()
      const cardToken = tokenData.value

      if (!cardToken) {
        throw new Error('No token returned from card processor.')
      }

      const chargeRes = await fetch(
        `/api/admin/ops/invoices/${invoiceId}/charge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: cardToken }),
        },
      )
      const chargeResult = await chargeRes.json()

      if (!chargeRes.ok) {
        throw new Error(chargeResult.error || 'Charge failed')
      }

      setChargeSuccess(true)
      setStatus('paid')
      setPaymentMethod('card')
      setShowCardForm(false)
      setCardNumber('')
      setCardExpMonth('')
      setCardExpYear('')
      setCardCvc('')
      setCardName('')
    } catch (err) {
      setChargeError(
        err instanceof Error ? err.message : 'Failed to charge card',
      )
    } finally {
      setChargeLoading(false)
    }
  }

  const handleSendPaymentLink = async () => {
    setPaymentLinkLoading(true)
    setPaymentLinkFeedback(null)
    try {
      const response = await fetch(
        `/api/admin/ops/invoices/${invoiceId}/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: 'sms', type: 'payment_link' }),
        },
      )
      const result = await response.json()
      if (!response.ok) {
        setPaymentLinkFeedback({
          ok: false,
          message: result.error || 'Failed to send payment link',
        })
      } else {
        setPaymentLinkFeedback({
          ok: true,
          message: 'Payment link sent via text!',
        })
        setTimeout(() => setPaymentLinkFeedback(null), 4000)
      }
    } catch {
      setPaymentLinkFeedback({
        ok: false,
        message: 'Failed to send payment link',
      })
    } finally {
      setPaymentLinkLoading(false)
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
  const total = Math.max(0, subtotalCalc - discountAmount)
  const billableTotal = total > 0.005 ? total : Number(invoice?.total || 0)

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
                router.push(
                  `/admin/operations?date=${appointment.appointment_date}`,
                )
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
              {['Cash', 'Venmo', 'Check'].map((method) => (
                <Button
                  key={method}
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50"
                  onClick={() => void handleMarkPaid(method.toLowerCase())}
                >
                  {method}
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50"
                onClick={() => setShowCardForm(!showCardForm)}
              >
                <CreditCard className="h-3.5 w-3.5" />
                Charge Card
              </Button>
            </div>

            {/* Card charge form */}
            {showCardForm ? (
              <div className="border-border/60 mt-4 rounded-xl border p-4">
                <p className="mb-3 text-sm font-semibold">
                  Charge Card — ${billableTotal.toFixed(2)}
                </p>
                {chargeError ? (
                  <p className="mb-3 text-sm text-red-500">{chargeError}</p>
                ) : null}
                {chargeSuccess ? (
                  <p className="mb-3 text-sm text-green-600">
                    Card charged successfully!
                  </p>
                ) : null}
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="card-name" className="text-xs">
                      Name on Card
                    </Label>
                    <Input
                      id="card-name"
                      placeholder="John Doe"
                      value={cardName}
                      onChange={(e) => setCardName(e.target.value)}
                      className="h-9"
                      autoComplete="cc-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="card-number" className="text-xs">
                      Card Number
                    </Label>
                    <Input
                      id="card-number"
                      placeholder="4111 1111 1111 1111"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      className="h-9 tabular-nums"
                      inputMode="numeric"
                      maxLength={19}
                      autoComplete="cc-number"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label htmlFor="card-exp-month" className="text-xs">
                        Month
                      </Label>
                      <Input
                        id="card-exp-month"
                        placeholder="MM"
                        value={cardExpMonth}
                        onChange={(e) => setCardExpMonth(e.target.value)}
                        className="h-9 tabular-nums"
                        inputMode="numeric"
                        maxLength={2}
                        autoComplete="cc-exp-month"
                      />
                    </div>
                    <div>
                      <Label htmlFor="card-exp-year" className="text-xs">
                        Year
                      </Label>
                      <Input
                        id="card-exp-year"
                        placeholder="YY"
                        value={cardExpYear}
                        onChange={(e) => setCardExpYear(e.target.value)}
                        className="h-9 tabular-nums"
                        inputMode="numeric"
                        maxLength={4}
                        autoComplete="cc-exp-year"
                      />
                    </div>
                    <div>
                      <Label htmlFor="card-cvc" className="text-xs">
                        CVV
                      </Label>
                      <Input
                        id="card-cvc"
                        placeholder="123"
                        value={cardCvc}
                        onChange={(e) => setCardCvc(e.target.value)}
                        className="h-9 tabular-nums"
                        inputMode="numeric"
                        maxLength={4}
                        autoComplete="cc-csc"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      className="flex-1 gap-2 bg-green-600 text-white hover:bg-green-700"
                      disabled={chargeLoading}
                      onClick={() => void handleChargeCard()}
                    >
                      {chargeLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CreditCard className="h-4 w-4" />
                      )}
                      {chargeLoading
                        ? 'Charging…'
                        : `Charge $${billableTotal.toFixed(2)}`}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setShowCardForm(false)
                        setChargeError(null)
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Send Payment Link */}
            <div className="mt-4">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={paymentLinkLoading}
                onClick={() => void handleSendPaymentLink()}
              >
                {paymentLinkLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Send Payment Link via Text
              </Button>
              {paymentLinkFeedback ? (
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

        {/* Job actions */}
        {appointment?.id ? (
          <div className="border-border/60 border-t pt-4">
            <p className="text-muted-foreground mb-3 text-xs font-semibold tracking-widest uppercase">
              Job Actions
            </p>
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
                  After you tap On My Way, the exact message text appears here
                  so you can confirm what customers receive (or review the
                  preview if texting is turned off).
                </p>
              )}
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Line Items</h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
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
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
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
                        type="text"
                        inputMode="numeric"
                        value={String(item.quantity)}
                        className="h-8 text-center text-sm tabular-nums"
                        readOnly
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
                      className="h-8 text-sm tabular-nums"
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
          <Button
            className="h-14 w-full gap-2 bg-green-600 text-lg font-bold text-white hover:bg-green-700"
            disabled={
              publishLoading || !combinedImageDataUrl || !aiDescription.trim()
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
          {!combinedImageDataUrl || !aiDescription.trim() ? (
            <p className="text-muted-foreground mt-2 text-center text-xs">
              {!combinedImageDataUrl && !aiDescription.trim()
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

      {/* In-person payment modal */}
      {showPaymentModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setShowPaymentModal(false)}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
              onClick={() => setShowPaymentModal(false)}
            >
              <X className="h-5 w-5" />
            </button>

            {/* Amount */}
            <p className="text-sm font-medium tracking-widest text-slate-400 uppercase">
              Amount Due
            </p>
            <p className="mt-1 text-5xl font-bold text-slate-900">
              ${billableTotal.toFixed(2)}
            </p>
            {customer?.business_name || customer?.full_name ? (
              <p className="mt-1 text-sm text-slate-500">
                {customer.business_name || customer.full_name}
              </p>
            ) : null}

            {/* Tab toggle */}
            <div className="mt-5 flex rounded-xl border border-slate-200 p-1">
              <button
                type="button"
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  paymentTab === 'qr'
                    ? 'bg-[#008CFF] text-white'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                onClick={() => setPaymentTab('qr')}
              >
                QR Code
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  paymentTab === 'tap'
                    ? 'bg-[#008CFF] text-white'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                onClick={() => setPaymentTab('tap')}
              >
                Tap Card
              </button>
            </div>

            {paymentTab === 'qr' ? (
              <>
                <div className="mt-5 flex justify-center">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
                      `https://venmo.com/SasquatchCarpet?txn=pay&amount=${billableTotal.toFixed(2)}&note=${encodeURIComponent(`Sasquatch Carpet Cleaning - ${customer?.business_name || customer?.full_name || 'Service'}`)}`,
                    )}`}
                    alt="Venmo QR code"
                    width={220}
                    height={220}
                    className="rounded-xl border border-slate-200"
                  />
                </div>
                <p className="mt-3 text-sm font-medium text-slate-700">
                  Hand your phone to the customer
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  They scan the QR code or tap the button below
                </p>
                <a
                  href={`https://venmo.com/SasquatchCarpet?txn=pay&amount=${billableTotal.toFixed(2)}&note=${encodeURIComponent(`Sasquatch Carpet Cleaning - ${customer?.business_name || customer?.full_name || 'Service'}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#008CFF] py-3 text-sm font-semibold text-white hover:bg-blue-600"
                >
                  <CreditCard className="h-4 w-4" />
                  Pay with Venmo
                </a>
              </>
            ) : (
              <>
                <div className="mt-6 flex flex-col items-center gap-2">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-50">
                    <CreditCard className="h-10 w-10 text-[#008CFF]" />
                  </div>
                  <p className="mt-2 text-base font-semibold text-slate-800">
                    Accept a card tap
                  </p>
                  <p className="text-sm leading-relaxed text-slate-500">
                    Open Venmo → tap <strong>⊕</strong> →{' '}
                    <strong>Accept money</strong> → enter{' '}
                    <strong>${billableTotal.toFixed(2)}</strong> → have the
                    customer tap their card
                  </p>
                </div>
                <a
                  href="venmo://"
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#008CFF] py-3 text-sm font-semibold text-white hover:bg-blue-600"
                >
                  <CreditCard className="h-4 w-4" />
                  Open Venmo
                </a>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
