'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { appointmentDisplayRevenue } from '@/lib/ops/utilization-metrics'
import {
  Calendar,
  Clock,
  Database,
  Edit3,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Receipt,
  RefreshCw,
  Shield,
  Sparkles,
} from 'lucide-react'

type ServiceItem = {
  id: string
  name: string
  description: string | null
  category: string
  default_duration_minutes: number | null
  buffer_minutes: number
  base_price: number | null
  pricing_unit: string
  online_booking_enabled: boolean
  source_system: string | null
  source_uuid: string | null
  is_active: boolean
  sort_order?: number | null
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

type OperationsDashboardProps = {
  view?: 'calendar' | 'services'
}

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function buildMonthGrid(date: Date): Date[] {
  const monthStart = startOfMonth(date)
  const gridStart = new Date(monthStart)
  gridStart.setDate(monthStart.getDate() - monthStart.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const next = new Date(gridStart)
    next.setDate(gridStart.getDate() + index)
    return next
  })
}

function normalizeCategory(value: string): string {
  return value.trim().toLowerCase()
}

export function OperationsDashboard({
  view = 'calendar',
}: OperationsDashboardProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<BootstrapResponse | null>(null)
  const [slotPreview, setSlotPreview] = useState<{
    requiredMinutes: number
    slots: Array<{ start_time: string; end_time: string }>
  } | null>(null)
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null)
  const [serviceCategoryFilter, setServiceCategoryFilter] = useState('all')
  const [serviceOrderIds, setServiceOrderIds] = useState<string[]>([])
  const [draggingServiceId, setDraggingServiceId] = useState<string | null>(
    null,
  )
  const [categorySource, setCategorySource] = useState('')
  const [categoryRenameTo, setCategoryRenameTo] = useState('')
  const [categoryMergeTarget, setCategoryMergeTarget] = useState('')
  const [currentMonth, setCurrentMonth] = useState(() =>
    startOfMonth(new Date()),
  )
  const [selectedDate, setSelectedDate] = useState(() =>
    formatDateKey(new Date()),
  )

  const [serviceForm, setServiceForm] = useState({
    name: '',
    category: 'cleaning',
    default_duration_minutes: '',
    buffer_minutes: '30',
    base_price: '',
    pricing_unit: 'fixed',
    description: '',
    online_booking_enabled: false,
    is_active: true,
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
  useEffect(() => {
    setServiceOrderIds((current) => {
      const incomingIds = services.map((service) => service.id)
      if (current.length === 0) return incomingIds
      const kept = current.filter((id) => incomingIds.includes(id))
      const added = incomingIds.filter((id) => !kept.includes(id))
      return [...kept, ...added]
    })
  }, [services])

  const orderedServices = useMemo(() => {
    const byId = new Map(services.map((service) => [service.id, service]))
    const ordered = serviceOrderIds
      .map((id) => byId.get(id))
      .filter((service): service is ServiceItem => Boolean(service))
    if (ordered.length === services.length) return ordered
    const missing = services.filter(
      (service) => !serviceOrderIds.includes(service.id),
    )
    return [...ordered, ...missing]
  }, [services, serviceOrderIds])

  const appointments = data?.appointments || []
  const quickbooksJobs = data?.quickbooksJobs || []

  const serviceCategories = useMemo(() => {
    const categories = new Set<string>()
    for (const service of services) {
      const category = String(service.category || '').trim()
      if (category) categories.add(category)
    }
    const currentFormCategory = String(serviceForm.category || '').trim()
    if (currentFormCategory) categories.add(currentFormCategory)
    return [...categories].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    )
  }, [services, serviceForm.category])

  const filteredServices = useMemo(() => {
    if (serviceCategoryFilter === 'all') return orderedServices
    return orderedServices.filter(
      (service) => service.category.trim() === serviceCategoryFilter,
    )
  }, [orderedServices, serviceCategoryFilter])

  useEffect(() => {
    if (
      serviceCategoryFilter !== 'all' &&
      !serviceCategories.includes(serviceCategoryFilter)
    ) {
      setServiceCategoryFilter('all')
    }
  }, [serviceCategories, serviceCategoryFilter])

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

  const appointmentsByDate = useMemo(() => {
    const grouped = new Map<string, Appointment[]>()
    for (const appointment of appointments) {
      const existing = grouped.get(appointment.appointment_date) || []
      existing.push(appointment)
      grouped.set(appointment.appointment_date, existing)
    }

    for (const [date, entries] of grouped.entries()) {
      grouped.set(
        date,
        [...entries].sort((a, b) => a.start_time.localeCompare(b.start_time)),
      )
    }

    return grouped
  }, [appointments])

  const monthGrid = useMemo(() => buildMonthGrid(currentMonth), [currentMonth])
  const selectedDateAppointments = appointmentsByDate.get(selectedDate) || []
  const monthLabel = currentMonth.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const handleDateSelect = (date: Date) => {
    const dateKey = formatDateKey(date)
    setSelectedDate(dateKey)
    setCurrentMonth(startOfMonth(date))
    setAppointmentForm((current) => ({
      ...current,
      appointment_date: dateKey,
    }))
  }

  const startEditingService = (service: ServiceItem) => {
    setEditingServiceId(service.id)
    setServiceForm({
      name: service.name,
      category: service.category,
      default_duration_minutes:
        service.default_duration_minutes !== null
          ? String(service.default_duration_minutes)
          : '',
      buffer_minutes: String(service.buffer_minutes ?? 30),
      base_price: service.base_price !== null ? String(service.base_price) : '',
      pricing_unit: service.pricing_unit,
      description: service.description || '',
      online_booking_enabled: service.online_booking_enabled,
      is_active: service.is_active,
    })
  }

  const cancelEditingService = () => {
    setEditingServiceId(null)
    setServiceForm({
      name: '',
      category: 'cleaning',
      default_duration_minutes: '',
      buffer_minutes: '30',
      base_price: '',
      pricing_unit: 'fixed',
      description: '',
      online_booking_enabled: false,
      is_active: true,
    })
  }

  const handleServiceSave = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(
        editingServiceId
          ? `/api/admin/ops/services/${editingServiceId}`
          : '/api/admin/ops/services',
        {
          method: editingServiceId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(serviceForm),
        },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(
          result.error ||
            (editingServiceId
              ? 'Failed to update service'
              : 'Failed to create service'),
        )
      }
      cancelEditingService()
      await loadDashboard()
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : editingServiceId
            ? 'Failed to update service'
            : 'Failed to create service',
      )
    } finally {
      setSaving(false)
    }
  }

  const updateCategoryAcrossServices = async (
    sourceCategory: string,
    nextCategory: string,
  ) => {
    const source = sourceCategory.trim()
    const target = nextCategory.trim()
    if (!source || !target) {
      throw new Error('Source and target categories are required')
    }

    const normalizedSource = normalizeCategory(source)
    const affectedServices = services.filter(
      (service) =>
        normalizeCategory(service.category || '') === normalizedSource,
    )
    if (affectedServices.length === 0) {
      throw new Error('No services found in that category')
    }

    const updates = await Promise.all(
      affectedServices.map(async (service) => {
        const response = await fetch(`/api/admin/ops/services/${service.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: service.name,
            description: service.description,
            category: target,
            default_duration_minutes: service.default_duration_minutes,
            buffer_minutes: service.buffer_minutes,
            base_price: service.base_price,
            pricing_unit: service.pricing_unit,
            online_booking_enabled: service.online_booking_enabled,
            is_active: service.is_active,
          }),
        })
        const result = await response.json()
        if (!response.ok) {
          throw new Error(
            result.error ||
              `Failed updating service category for ${service.name}`,
          )
        }
        return result.service
      }),
    )

    return updates.length
  }

  const handleCategoryRename = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const updatedCount = await updateCategoryAcrossServices(
        categorySource,
        categoryRenameTo,
      )
      setCategorySource(categoryRenameTo.trim())
      setCategoryRenameTo('')
      await loadDashboard()
      setError(null)
      if (updatedCount > 0) {
        setServiceCategoryFilter('all')
      }
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : 'Failed to rename category',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleCategoryMerge = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (
        normalizeCategory(categorySource) ===
        normalizeCategory(categoryMergeTarget)
      ) {
        throw new Error('Choose a different target category')
      }
      await updateCategoryAcrossServices(categorySource, categoryMergeTarget)
      setCategorySource(categoryMergeTarget.trim())
      await loadDashboard()
      setServiceCategoryFilter('all')
    } catch (mergeError) {
      setError(
        mergeError instanceof Error
          ? mergeError.message
          : 'Failed to move category services',
      )
    } finally {
      setSaving(false)
    }
  }

  const persistServiceOrder = async (orderedIds: string[]) => {
    const response = await fetch('/api/admin/ops/services/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordered_ids: orderedIds }),
    })
    const result = await response.json()
    if (!response.ok) {
      throw new Error(result.error || 'Failed to save service order')
    }
  }

  const moveServiceBeforeTarget = async (targetId: string) => {
    if (!draggingServiceId || draggingServiceId === targetId) return
    const fromIndex = serviceOrderIds.indexOf(draggingServiceId)
    const toIndex = serviceOrderIds.indexOf(targetId)
    if (fromIndex === -1 || toIndex === -1) return
    const next = [...serviceOrderIds]
    next.splice(fromIndex, 1)
    next.splice(toIndex, 0, draggingServiceId)
    setServiceOrderIds(next)
    try {
      await persistServiceOrder(next)
    } catch (orderError) {
      setError(
        orderError instanceof Error
          ? orderError.message
          : 'Failed to save service order',
      )
      await loadDashboard()
    } finally {
      setDraggingServiceId(null)
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
            {view === 'calendar' ? 'Operations Calendar' : 'Service Catalog'}
          </h1>
          <p className="max-w-3xl text-sm text-white/70">
            {view === 'calendar'
              ? 'Internal-only booking view for the new system. Housecall Pro stays live while you test calendar flow, availability, draft invoices, and QuickBooks sync queues here.'
              : 'Manage the services that feed scheduling, pricing, booking rules, and future website booking.'}
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

      <div className="flex flex-wrap gap-2">
        <Button
          asChild
          variant={view === 'calendar' ? 'default' : 'outline'}
          size="sm"
        >
          <Link href="/admin/operations">Calendar</Link>
        </Button>
        <Button
          asChild
          variant={view === 'services' ? 'default' : 'outline'}
          size="sm"
        >
          <Link href="/admin/operations/services">Services</Link>
        </Button>
      </div>

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

      {view === 'calendar' ? (
        <div className="grid gap-6 xl:grid-cols-[1.75fr,1fr]">
          <Card className="border-white/10 bg-black/30 p-6 text-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Calendar</h2>
                <p className="mt-1 text-sm text-white/60">
                  This is the main operations view. Pick a day to see bookings
                  and schedule new internal test appointments.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentMonth((current) => addMonths(current, -1))
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-36 text-center text-sm font-medium">
                  {monthLabel}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentMonth((current) => addMonths(current, 1))
                  }
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDateSelect(new Date())}
                >
                  Today
                </Button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-7 gap-2 text-center text-xs tracking-wide text-white/40 uppercase">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label}>{label.slice(0, 3)}</div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-7 gap-2">
              {monthGrid.map((date) => {
                const dateKey = formatDateKey(date)
                const dayAppointments = appointmentsByDate.get(dateKey) || []
                const isSelected = dateKey === selectedDate
                const isCurrentMonth =
                  date.getMonth() === currentMonth.getMonth()

                return (
                  <button
                    key={dateKey}
                    type="button"
                    onClick={() => handleDateSelect(date)}
                    className={`min-h-28 rounded-xl border p-3 text-left transition ${
                      isSelected
                        ? 'border-green-500 bg-green-500/15'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                    } ${isCurrentMonth ? 'text-white' : 'text-white/35'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">
                        {date.getDate()}
                      </span>
                      {dayAppointments.length > 0 ? (
                        <Badge className="bg-white/10 text-white/80">
                          {dayAppointments.length}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 space-y-1">
                      {dayAppointments.slice(0, 2).map((appointment) => {
                        const customer = unwrapRelation(
                          appointment.ops_customers,
                        )
                        return (
                          <div
                            key={appointment.id}
                            className="rounded-md bg-black/30 px-2 py-1 text-xs text-white/80"
                          >
                            <div className="font-medium">
                              {appointment.start_time.slice(0, 5)}
                            </div>
                            <div className="truncate">
                              {customer?.full_name || 'Customer'}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>

          <Card className="border-white/10 bg-black/30 p-6 text-white">
            <h2 className="text-xl font-semibold">
              {new Date(`${selectedDate}T12:00:00`).toLocaleDateString(
                'en-US',
                {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                },
              )}
            </h2>
            <p className="mt-1 text-sm text-white/60">
              Day agenda and quick actions for the selected date.
            </p>
            <div className="mt-4 space-y-3">
              {selectedDateAppointments.length === 0 ? (
                <p className="text-sm text-white/50">
                  No appointments on this day yet.
                </p>
              ) : (
                selectedDateAppointments.map((appointment) => {
                  const customer = unwrapRelation(appointment.ops_customers)
                  const invoice = unwrapRelation(appointment.ops_invoices)
                  return (
                    <div
                      key={appointment.id}
                      className="rounded-xl border border-white/10 bg-white/5 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">
                            {appointment.start_time.slice(0, 5)} -{' '}
                            {appointment.end_time.slice(0, 5)}
                          </div>
                          <div className="text-sm text-white/70">
                            {customer?.full_name || 'Unknown customer'}
                          </div>
                        </div>
                        <Badge className="bg-white/10 text-white/80">
                          {appointment.status}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
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
                          Complete
                        </Button>
                      </div>
                      <div className="mt-2 text-xs text-white/50">
                        Invoice: {invoice?.status || 'draft'} | Total: $
                        {appointmentDisplayRevenue(appointment).toFixed(2)}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </Card>
        </div>
      ) : null}

      {view === 'services' ? (
        <div className="grid gap-6">
          <Card className="border-white/10 bg-black/30 p-6 text-white">
            <h2 className="text-xl font-semibold">Service Catalog</h2>
            <p className="mt-1 text-sm text-white/60">
              Add and maintain services here. This is where you control price,
              duration, buffer, category, booking visibility, and whether a
              service is active.
            </p>
            <form className="mt-4 space-y-3" onSubmit={handleServiceSave}>
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
                    list="service-category-options"
                    value={serviceForm.category}
                    onChange={(event) =>
                      setServiceForm((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                    placeholder="Ex: legendary restoration clean"
                  />
                  <datalist id="service-category-options">
                    {serviceCategories.map((category) => (
                      <option key={category} value={category} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <Label htmlFor="service-duration">
                    Default Duration (minutes)
                  </Label>
                  <Input
                    id="service-duration"
                    type="number"
                    placeholder="Set manually later if needed"
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
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input
                    type="checkbox"
                    checked={serviceForm.online_booking_enabled}
                    onChange={(event) =>
                      setServiceForm((current) => ({
                        ...current,
                        online_booking_enabled: event.target.checked,
                      }))
                    }
                  />
                  Online booking enabled
                </label>
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input
                    type="checkbox"
                    checked={serviceForm.is_active}
                    onChange={(event) =>
                      setServiceForm((current) => ({
                        ...current,
                        is_active: event.target.checked,
                      }))
                    }
                  />
                  Service active
                </label>
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
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {editingServiceId ? 'Save Service' : 'Add Service'}
                </Button>
                {editingServiceId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={cancelEditingService}
                  >
                    Cancel Edit
                  </Button>
                ) : null}
              </div>
            </form>
            <div className="mt-6 space-y-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-sm font-medium">Category Cleanup</p>
                <p className="mt-1 text-xs text-white/60">
                  Rename a category, or move all services into another category
                  to effectively delete the old one.
                </p>
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="category-source">Category</Label>
                    <select
                      id="category-source"
                      className="mt-1 h-10 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white"
                      value={categorySource}
                      onChange={(event) =>
                        setCategorySource(event.target.value)
                      }
                    >
                      <option value="">Select category</option>
                      {serviceCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </div>
                  <form className="space-y-1" onSubmit={handleCategoryRename}>
                    <Label htmlFor="category-rename">Rename to</Label>
                    <Input
                      id="category-rename"
                      value={categoryRenameTo}
                      onChange={(event) =>
                        setCategoryRenameTo(event.target.value)
                      }
                      placeholder="New category name"
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      disabled={saving || !categorySource || !categoryRenameTo}
                    >
                      Rename Category
                    </Button>
                  </form>
                  <form className="space-y-1" onSubmit={handleCategoryMerge}>
                    <Label htmlFor="category-merge">Move all services to</Label>
                    <select
                      id="category-merge"
                      className="h-10 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white"
                      value={categoryMergeTarget}
                      onChange={(event) =>
                        setCategoryMergeTarget(event.target.value)
                      }
                    >
                      <option value="">Select target</option>
                      {serviceCategories
                        .filter((category) => category !== categorySource)
                        .map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                    </select>
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      disabled={
                        saving || !categorySource || !categoryMergeTarget
                      }
                    >
                      Move + Remove Old Category
                    </Button>
                  </form>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-60">
                  <Label htmlFor="services-category-filter">
                    Filter Category
                  </Label>
                  <select
                    id="services-category-filter"
                    className="mt-1 h-10 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white"
                    value={serviceCategoryFilter}
                    onChange={(event) =>
                      setServiceCategoryFilter(event.target.value)
                    }
                  >
                    <option value="all">All categories</option>
                    {serviceCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
                <Badge className="bg-white/10 text-white/80">
                  Showing {filteredServices.length} of {services.length}
                </Badge>
              </div>
              {services.length === 0 ? (
                <p className="text-sm text-white/50">
                  No services entered yet.
                </p>
              ) : filteredServices.length === 0 ? (
                <p className="text-sm text-white/50">
                  No services found in this category yet.
                </p>
              ) : (
                filteredServices.map((service) => (
                  <div
                    key={service.id}
                    className="rounded-xl border border-white/10 bg-white/5 p-3"
                    draggable
                    onDragStart={() => setDraggingServiceId(service.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => void moveServiceBeforeTarget(service.id)}
                    onDragEnd={() => setDraggingServiceId(null)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          className="cursor-grab rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white"
                          aria-label="Drag to reorder service"
                        >
                          <GripVertical className="h-4 w-4" />
                        </button>
                        <div>
                          <div className="flex items-center gap-2 font-medium">
                            {service.name}
                            {!service.is_active ? (
                              <Badge className="bg-white/10 text-white/60">
                                Hidden
                              </Badge>
                            ) : null}
                            {service.online_booking_enabled ? (
                              <Badge className="bg-emerald-500/20 text-emerald-100">
                                Booking on
                              </Badge>
                            ) : null}
                          </div>
                          <div className="text-sm text-white/60">
                            {service.default_duration_minutes !== null
                              ? `${service.default_duration_minutes} min`
                              : 'Needs duration'}{' '}
                            + {service.buffer_minutes} min buffer
                          </div>
                          <div className="text-xs text-white/50">
                            {service.category}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-white/10 text-white/70">
                          {service.base_price !== null
                            ? `$${Number(service.base_price).toFixed(2)}`
                            : 'Price later'}
                        </Badge>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => startEditingService(service)}
                        >
                          <Edit3 className="mr-2 h-3 w-3" />
                          Edit
                        </Button>
                      </div>
                    </div>
                    {service.description ? (
                      <p className="mt-2 text-xs text-white/50">
                        {service.description}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="border-white/10 bg-black/30 p-6 text-white">
            <h2 className="text-xl font-semibold">
              Availability + Openings Test
            </h2>
            <p className="mt-1 text-sm text-white/60">
              Configure your work hours and sanity-check available openings
              without leaving the calendar screen.
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
      )}

      {view === 'calendar' ? (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="border-white/10 bg-black/30 p-6 text-white">
              <h2 className="text-xl font-semibold">Internal Booking Lab</h2>
              <p className="mt-1 text-sm text-white/60">
                Create internal test appointments, invoice drafts, and
                QuickBooks queue entries without replacing the live booking
                link.
              </p>
              <form
                className="mt-4 space-y-3"
                onSubmit={handleAppointmentCreate}
              >
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
                <Button
                  type="submit"
                  disabled={saving || services.length === 0}
                >
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
                    No sync jobs queued yet. Create an internal appointment to
                    test the flow.
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
                  When you mark an appointment completed, the system now stages
                  a marketing queue record and advances the invoice toward
                  QuickBooks sync without touching your current live stats or
                  job-posting tools.
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
                  const address = unwrapRelation(
                    appointment.ops_service_addresses,
                  )
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
                          {appointmentDisplayRevenue(appointment).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  )
}
