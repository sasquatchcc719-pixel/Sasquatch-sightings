'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Calendar,
  Clock,
  Database,
  Loader2,
  Receipt,
  RefreshCw,
  Shield,
  Sparkles,
} from 'lucide-react'

type ServiceItem = {
  id: string
  name: string
  category: string
  default_duration_minutes: number
  buffer_minutes: number
  base_price: number | null
  pricing_unit: string
  is_active: boolean
}

type AvailabilityTemplate = {
  id: string
  day_of_week: number
  start_time: string
  end_time: string
  slot_interval_minutes: number
}

type AvailabilityOverride = {
  id: string
  override_date: string
  start_time: string | null
  end_time: string | null
  is_available: boolean
  reason: string | null
}

type Appointment = {
  id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  payment_status: string
  quickbooks_sync_status: string
  quoted_total: number
  internal_notes: string | null
  ops_customers:
    | {
        full_name: string
        email: string | null
        phone: string
      }
    | {
        full_name: string
        email: string | null
        phone: string
      }[]
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
        sync_status: string
        total: number
      }
    | {
        id: string
        status: string
        payment_status: string
        sync_status: string
        total: number
      }[]
}

type QuickBooksJob = {
  id: string
  entity_type: string
  status: string
  created_at: string
}

type BootstrapResponse = {
  role: string
  migrationReady: boolean
  services: ServiceItem[]
  availabilityTemplates: AvailabilityTemplate[]
  availabilityOverrides: AvailabilityOverride[]
  appointments: Appointment[]
  quickbooksJobs: QuickBooksJob[]
}

const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

export function OperationsDashboard() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<BootstrapResponse | null>(null)
  const [slotPreview, setSlotPreview] = useState<{
    requiredMinutes: number
    slots: Array<{ start_time: string; end_time: string }>
  } | null>(null)

  const [serviceForm, setServiceForm] = useState({
    name: '',
    category: 'cleaning',
    default_duration_minutes: '90',
    buffer_minutes: '15',
    base_price: '',
    pricing_unit: 'fixed',
    description: '',
  })

  const [templateForm, setTemplateForm] = useState({
    day_of_week: '1',
    start_time: '09:00',
    end_time: '17:00',
    slot_interval_minutes: '30',
  })

  const [overrideForm, setOverrideForm] = useState({
    override_date: '',
    start_time: '',
    end_time: '',
    reason: '',
    is_available: false,
  })

  const [slotForm, setSlotForm] = useState({
    date: '',
    service_id: '',
    quantity: '1',
  })

  const [appointmentForm, setAppointmentForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    street_1: '',
    city: 'Colorado Springs',
    state: 'CO',
    zip_code: '',
    appointment_date: '',
    start_time: '09:00',
    service_id: '',
    quantity: '1',
    unit_price: '',
    internal_notes: '',
  })

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/ops/bootstrap', {
        cache: 'no-store',
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load operations dashboard')
      }
      setData(result)
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load operations dashboard',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const services = data?.services || []
  const appointments = data?.appointments || []
  const quickbooksJobs = data?.quickbooksJobs || []

  useEffect(() => {
    if (!slotForm.service_id && services.length > 0) {
      setSlotForm((current) => ({ ...current, service_id: services[0].id }))
    }
    if (!appointmentForm.service_id && services.length > 0) {
      const firstService = services[0]
      setAppointmentForm((current) => ({
        ...current,
        service_id: firstService.id,
        unit_price:
          firstService.base_price !== null
            ? String(firstService.base_price)
            : '',
      }))
    }
  }, [services, slotForm.service_id, appointmentForm.service_id])

  const servicesById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  )

  const handleServiceCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/ops/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serviceForm),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to create service')
      }
      setServiceForm({
        name: '',
        category: 'cleaning',
        default_duration_minutes: '90',
        buffer_minutes: '15',
        base_price: '',
        pricing_unit: 'fixed',
        description: '',
      })
      await loadDashboard()
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to create service',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleAvailabilityCreate = async (
    event: React.FormEvent,
    kind: 'template' | 'override',
  ) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload =
        kind === 'template'
          ? { kind, ...templateForm }
          : { kind, ...overrideForm }
      const response = await fetch('/api/admin/ops/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to save availability rule')
      }
      if (kind === 'template') {
        setTemplateForm({
          day_of_week: '1',
          start_time: '09:00',
          end_time: '17:00',
          slot_interval_minutes: '30',
        })
      } else {
        setOverrideForm({
          override_date: '',
          start_time: '',
          end_time: '',
          reason: '',
          is_available: false,
        })
      }
      await loadDashboard()
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save availability rule',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleSlotPreview = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const searchParams = new URLSearchParams({
        date: slotForm.date,
        service_id: slotForm.service_id,
        quantity: slotForm.quantity,
      })
      const response = await fetch(
        `/api/admin/ops/slots?${searchParams.toString()}`,
        {
          cache: 'no-store',
        },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to preview slots')
      }
      setSlotPreview(result)
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : 'Failed to preview slots',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleAppointmentCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const service = servicesById.get(appointmentForm.service_id)
      const quantity = Number(appointmentForm.quantity || '1')
      const unitPrice = Number(
        appointmentForm.unit_price || service?.base_price || 0,
      )

      const response = await fetch('/api/admin/ops/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: {
            full_name: appointmentForm.full_name,
            phone: appointmentForm.phone,
            email: appointmentForm.email || null,
          },
          address: {
            street_1: appointmentForm.street_1,
            city: appointmentForm.city,
            state: appointmentForm.state,
            zip_code: appointmentForm.zip_code,
          },
          appointment: {
            appointment_date: appointmentForm.appointment_date,
            start_time: appointmentForm.start_time,
            internal_notes: appointmentForm.internal_notes,
            booking_channel: 'internal_only',
            source: 'ops_preview',
          },
          line_items: [
            {
              service_catalog_item_id: appointmentForm.service_id,
              name_snapshot: service?.name || 'Service',
              quantity,
              unit_price: unitPrice,
            },
          ],
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to create appointment')
      }

      const firstService = services[0]
      setAppointmentForm({
        full_name: '',
        phone: '',
        email: '',
        street_1: '',
        city: 'Colorado Springs',
        state: 'CO',
        zip_code: '',
        appointment_date: '',
        start_time: '09:00',
        service_id: firstService?.id || '',
        quantity: '1',
        unit_price:
          firstService && firstService.base_price !== null
            ? String(firstService.base_price)
            : '',
        internal_notes: '',
      })
      await loadDashboard()
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Failed to create appointment',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleAppointmentStatus = async (
    appointmentId: string,
    status: string,
    paymentStatus?: string,
  ) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/ops/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_id: appointmentId,
          status,
          payment_status: paymentStatus,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update appointment')
      }
      await loadDashboard()
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Failed to update appointment',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-white/80">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading operations foundation...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold text-white">
            <Calendar className="h-8 w-8" />
            Operations Foundation
          </h1>
          <p className="max-w-3xl text-sm text-white/70">
            Internal-only booking replacement foundation. Housecall Pro remains
            live while you test roles, service durations, availability, draft
            invoices, and QuickBooks sync queues here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-white/10 text-white/80">
            Role: {data?.role || 'unknown'}
          </Badge>
          <Button variant="outline" onClick={() => void loadDashboard()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/10 p-4 text-red-200">
          {error}
        </Card>
      )}

      {!data?.migrationReady && (
        <Card className="border-amber-500/30 bg-amber-500/10 p-5 text-amber-100">
          The booking foundation migration has not been applied yet. Run the new
          SQL migration before using the internal operations tools.
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-white/10 bg-black/30 p-4 text-white">
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Shield className="h-4 w-4" />
            Services
          </div>
          <div className="mt-2 text-2xl font-semibold">{services.length}</div>
        </Card>
        <Card className="border-white/10 bg-black/30 p-4 text-white">
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Clock className="h-4 w-4" />
            Availability Rules
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {(data?.availabilityTemplates.length || 0) +
              (data?.availabilityOverrides.length || 0)}
          </div>
        </Card>
        <Card className="border-white/10 bg-black/30 p-4 text-white">
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Receipt className="h-4 w-4" />
            Upcoming Appointments
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {appointments.length}
          </div>
        </Card>
        <Card className="border-white/10 bg-black/30 p-4 text-white">
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Database className="h-4 w-4" />
            QuickBooks Queue
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {quickbooksJobs.length}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-white/10 bg-black/30 p-6 text-white">
          <h2 className="text-xl font-semibold">Service Catalog</h2>
          <p className="mt-1 text-sm text-white/60">
            Start entering the real durations and buffers from Housecall Pro.
          </p>
          <form className="mt-4 space-y-3" onSubmit={handleServiceCreate}>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="service-name">Service Name</Label>
                <Input
                  id="service-name"
                  value={serviceForm.name}
                  onChange={(event) =>
                    setServiceForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="service-category">Category</Label>
                <Input
                  id="service-category"
                  value={serviceForm.category}
                  onChange={(event) =>
                    setServiceForm((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="service-duration">
                  Default Duration (minutes)
                </Label>
                <Input
                  id="service-duration"
                  type="number"
                  value={serviceForm.default_duration_minutes}
                  onChange={(event) =>
                    setServiceForm((current) => ({
                      ...current,
                      default_duration_minutes: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="service-buffer">Buffer (minutes)</Label>
                <Input
                  id="service-buffer"
                  type="number"
                  value={serviceForm.buffer_minutes}
                  onChange={(event) =>
                    setServiceForm((current) => ({
                      ...current,
                      buffer_minutes: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="service-price">Base Price</Label>
                <Input
                  id="service-price"
                  type="number"
                  step="0.01"
                  value={serviceForm.base_price}
                  onChange={(event) =>
                    setServiceForm((current) => ({
                      ...current,
                      base_price: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="service-unit">Pricing Unit</Label>
                <Input
                  id="service-unit"
                  value={serviceForm.pricing_unit}
                  onChange={(event) =>
                    setServiceForm((current) => ({
                      ...current,
                      pricing_unit: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div>
              <Label htmlFor="service-description">Description</Label>
              <Textarea
                id="service-description"
                value={serviceForm.description}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Add Service
            </Button>
          </form>
          <div className="mt-6 space-y-3">
            {services.length === 0 ? (
              <p className="text-sm text-white/50">No services entered yet.</p>
            ) : (
              services.map((service) => (
                <div
                  key={service.id}
                  className="rounded-xl border border-white/10 bg-white/5 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{service.name}</div>
                      <div className="text-sm text-white/60">
                        {service.default_duration_minutes} min +{' '}
                        {service.buffer_minutes} min buffer
                      </div>
                    </div>
                    <Badge className="bg-white/10 text-white/70">
                      {service.base_price !== null
                        ? `$${Number(service.base_price).toFixed(2)}`
                        : 'Price later'}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="border-white/10 bg-black/30 p-6 text-white">
          <h2 className="text-xl font-semibold">Availability + Slot Preview</h2>
          <p className="mt-1 text-sm text-white/60">
            Configure weekly hours and test the same slot engine Harry will use
            later.
          </p>
          <form
            className="mt-4 space-y-3 rounded-xl border border-white/10 bg-white/5 p-4"
            onSubmit={(event) =>
              void handleAvailabilityCreate(event, 'template')
            }
          >
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <Label htmlFor="template-day">Day</Label>
                <select
                  id="template-day"
                  className="h-10 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white"
                  value={templateForm.day_of_week}
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      day_of_week: event.target.value,
                    }))
                  }
                >
                  {WEEKDAY_LABELS.map((label, index) => (
                    <option key={label} value={index}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="template-start">Start</Label>
                <Input
                  id="template-start"
                  type="time"
                  value={templateForm.start_time}
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      start_time: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="template-end">End</Label>
                <Input
                  id="template-end"
                  type="time"
                  value={templateForm.end_time}
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      end_time: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="template-interval">Interval</Label>
                <Input
                  id="template-interval"
                  type="number"
                  value={templateForm.slot_interval_minutes}
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      slot_interval_minutes: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <Button type="submit" disabled={saving}>
              Add Weekly Hours
            </Button>
          </form>

          <form
            className="mt-4 space-y-3 rounded-xl border border-white/10 bg-white/5 p-4"
            onSubmit={(event) =>
              void handleAvailabilityCreate(event, 'override')
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="override-date">Override Date</Label>
                <Input
                  id="override-date"
                  type="date"
                  value={overrideForm.override_date}
                  onChange={(event) =>
                    setOverrideForm((current) => ({
                      ...current,
                      override_date: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="override-reason">Reason</Label>
                <Input
                  id="override-reason"
                  value={overrideForm.reason}
                  onChange={(event) =>
                    setOverrideForm((current) => ({
                      ...current,
                      reason: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="override-start">Blocked Start</Label>
                <Input
                  id="override-start"
                  type="time"
                  value={overrideForm.start_time}
                  onChange={(event) =>
                    setOverrideForm((current) => ({
                      ...current,
                      start_time: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="override-end">Blocked End</Label>
                <Input
                  id="override-end"
                  type="time"
                  value={overrideForm.end_time}
                  onChange={(event) =>
                    setOverrideForm((current) => ({
                      ...current,
                      end_time: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <Button type="submit" variant="outline" disabled={saving}>
              Add Override
            </Button>
          </form>

          <form className="mt-4 space-y-3" onSubmit={handleSlotPreview}>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label htmlFor="slot-date">Date</Label>
                <Input
                  id="slot-date"
                  type="date"
                  value={slotForm.date}
                  onChange={(event) =>
                    setSlotForm((current) => ({
                      ...current,
                      date: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="slot-service">Service</Label>
                <select
                  id="slot-service"
                  className="h-10 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white"
                  value={slotForm.service_id}
                  onChange={(event) =>
                    setSlotForm((current) => ({
                      ...current,
                      service_id: event.target.value,
                    }))
                  }
                >
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="slot-quantity">Quantity</Label>
                <Input
                  id="slot-quantity"
                  type="number"
                  value={slotForm.quantity}
                  onChange={(event) =>
                    setSlotForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={saving || services.length === 0}
            >
              Preview Slots
            </Button>
          </form>

          {slotPreview && (
            <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="text-sm text-emerald-100">
                Required time: {slotPreview.requiredMinutes} minutes
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {slotPreview.slots.length === 0 ? (
                  <span className="text-sm text-white/60">
                    No slots available.
                  </span>
                ) : (
                  slotPreview.slots.map((slot) => (
                    <Badge
                      key={`${slot.start_time}-${slot.end_time}`}
                      className="bg-white/10 text-white"
                    >
                      {slot.start_time.slice(0, 5)} -{' '}
                      {slot.end_time.slice(0, 5)}
                    </Badge>
                  ))
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-white/10 bg-black/30 p-6 text-white">
          <h2 className="text-xl font-semibold">Internal Booking Lab</h2>
          <p className="mt-1 text-sm text-white/60">
            Create internal test appointments, invoice drafts, and QuickBooks
            queue entries without replacing the live booking link.
          </p>
          <form className="mt-4 space-y-3" onSubmit={handleAppointmentCreate}>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="appt-name">Customer Name</Label>
                <Input
                  id="appt-name"
                  value={appointmentForm.full_name}
                  onChange={(event) =>
                    setAppointmentForm((current) => ({
                      ...current,
                      full_name: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="appt-phone">Phone</Label>
                <Input
                  id="appt-phone"
                  value={appointmentForm.phone}
                  onChange={(event) =>
                    setAppointmentForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="appt-email">Email</Label>
                <Input
                  id="appt-email"
                  type="email"
                  value={appointmentForm.email}
                  onChange={(event) =>
                    setAppointmentForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="appt-street">Street</Label>
                <Input
                  id="appt-street"
                  value={appointmentForm.street_1}
                  onChange={(event) =>
                    setAppointmentForm((current) => ({
                      ...current,
                      street_1: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="appt-city">City</Label>
                <Input
                  id="appt-city"
                  value={appointmentForm.city}
                  onChange={(event) =>
                    setAppointmentForm((current) => ({
                      ...current,
                      city: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="appt-zip">Zip</Label>
                <Input
                  id="appt-zip"
                  value={appointmentForm.zip_code}
                  onChange={(event) =>
                    setAppointmentForm((current) => ({
                      ...current,
                      zip_code: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="appt-date">Date</Label>
                <Input
                  id="appt-date"
                  type="date"
                  value={appointmentForm.appointment_date}
                  onChange={(event) =>
                    setAppointmentForm((current) => ({
                      ...current,
                      appointment_date: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="appt-time">Start Time</Label>
                <Input
                  id="appt-time"
                  type="time"
                  value={appointmentForm.start_time}
                  onChange={(event) =>
                    setAppointmentForm((current) => ({
                      ...current,
                      start_time: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="appt-service">Service</Label>
                <select
                  id="appt-service"
                  className="h-10 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white"
                  value={appointmentForm.service_id}
                  onChange={(event) => {
                    const nextService = servicesById.get(event.target.value)
                    setAppointmentForm((current) => ({
                      ...current,
                      service_id: event.target.value,
                      unit_price:
                        nextService?.base_price !== null &&
                        nextService?.base_price !== undefined
                          ? String(nextService.base_price)
                          : '',
                    }))
                  }}
                >
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="appt-quantity">Quantity</Label>
                <Input
                  id="appt-quantity"
                  type="number"
                  value={appointmentForm.quantity}
                  onChange={(event) =>
                    setAppointmentForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="appt-price">Unit Price</Label>
                <Input
                  id="appt-price"
                  type="number"
                  step="0.01"
                  value={appointmentForm.unit_price}
                  onChange={(event) =>
                    setAppointmentForm((current) => ({
                      ...current,
                      unit_price: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div>
              <Label htmlFor="appt-notes">Internal Notes</Label>
              <Textarea
                id="appt-notes"
                value={appointmentForm.internal_notes}
                onChange={(event) =>
                  setAppointmentForm((current) => ({
                    ...current,
                    internal_notes: event.target.value,
                  }))
                }
              />
            </div>
            <Button type="submit" disabled={saving || services.length === 0}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Create Test Appointment + Draft Invoice
            </Button>
          </form>
        </Card>

        <Card className="border-white/10 bg-black/30 p-6 text-white">
          <h2 className="text-xl font-semibold">
            QuickBooks + Automation Boundary
          </h2>
          <p className="mt-1 text-sm text-white/60">
            Every new booking creates a draft invoice immediately and queues
            sync work without turning any live accounting automation on yet.
          </p>
          <div className="mt-4 space-y-3">
            {quickbooksJobs.length === 0 ? (
              <p className="text-sm text-white/50">
                No sync jobs queued yet. Create an internal appointment to test
                the flow.
              </p>
            ) : (
              quickbooksJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3"
                >
                  <div>
                    <div className="font-medium capitalize">
                      {job.entity_type} sync
                    </div>
                    <div className="text-xs text-white/50">
                      {new Date(job.created_at).toLocaleString()}
                    </div>
                  </div>
                  <Badge className="bg-white/10 text-white/80">
                    {job.status}
                  </Badge>
                </div>
              ))
            )}
          </div>
          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4" />
              Completion automation boundary
            </div>
            <p className="mt-2 text-sm text-white/60">
              When you mark an appointment completed, the system now stages a
              marketing queue record and advances the invoice toward QuickBooks
              sync without touching your current live stats or job-posting
              tools.
            </p>
          </div>
        </Card>
      </div>

      <Card className="border-white/10 bg-black/30 p-6 text-white">
        <h2 className="text-xl font-semibold">
          Upcoming Internal Appointments
        </h2>
        <p className="mt-1 text-sm text-white/60">
          These are internal-only test jobs backed by the new appointment,
          invoice, and queue tables.
        </p>
        <div className="mt-4 space-y-4">
          {appointments.length === 0 ? (
            <p className="text-sm text-white/50">
              No internal appointments yet.
            </p>
          ) : (
            appointments.map((appointment) => {
              const customer = unwrapRelation(appointment.ops_customers)
              const address = unwrapRelation(appointment.ops_service_addresses)
              const invoice = unwrapRelation(appointment.ops_invoices)

              return (
                <div
                  key={appointment.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">
                        {customer?.full_name || 'Unknown customer'}
                      </div>
                      <div className="text-sm text-white/60">
                        {appointment.appointment_date} at{' '}
                        {appointment.start_time.slice(0, 5)} -{' '}
                        {appointment.end_time.slice(0, 5)}
                      </div>
                      <div className="text-sm text-white/60">
                        {address
                          ? `${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`
                          : 'No address'}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="bg-blue-500/20 text-blue-100">
                        {appointment.status}
                      </Badge>
                      <Badge className="bg-white/10 text-white/80">
                        Invoice: {invoice?.status || 'draft'}
                      </Badge>
                      <Badge className="bg-white/10 text-white/80">
                        QB: {appointment.quickbooks_sync_status}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-sm text-white/70">
                    {appointment.ops_appointment_line_items.map((item) => (
                      <span
                        key={item.id}
                        className="rounded-full border border-white/10 bg-black/30 px-3 py-1"
                      >
                        {item.name_snapshot} x{item.quantity} ($
                        {Number(item.line_total).toFixed(2)})
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void handleAppointmentStatus(
                          appointment.id,
                          'confirmed',
                        )
                      }
                    >
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void handleAppointmentStatus(
                          appointment.id,
                          'on_my_way',
                        )
                      }
                    >
                      On My Way
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void handleAppointmentStatus(
                          appointment.id,
                          'completed',
                          'paid',
                        )
                      }
                    >
                      Complete + Mark Paid
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void handleAppointmentStatus(
                          appointment.id,
                          'cancelled',
                        )
                      }
                    >
                      Cancel
                    </Button>
                    <span className="ml-auto text-sm text-white/70">
                      Total: $
                      {Number(
                        invoice?.total || appointment.quoted_total,
                      ).toFixed(2)}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </Card>
    </div>
  )
}
