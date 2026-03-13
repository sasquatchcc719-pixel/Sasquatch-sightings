'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Minus, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  applyAppointmentBuffer,
  calculateLineItemDurationMinutes,
  DEFAULT_APPOINTMENT_BUFFER_MINUTES,
} from '@/lib/ops/availability'

type ServiceItem = {
  id: string
  name: string
  category: string
  base_price: number | null
  default_duration_minutes?: number | null
}

type CustomerAddress = {
  id: string
  label: string | null
  street_1: string
  street_2: string | null
  city: string
  state: string
  zip_code: string
  gate_code: string | null
  notes: string | null
}

type CustomerSearchResult = {
  id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  business_name: string | null
  email: string | null
  phone: string
  notes: string | null
  ops_service_addresses: CustomerAddress[]
}

type SchedulePreview = {
  appointments: Array<{
    id: string
    appointment_date: string
    start_time: string
    end_time: string
    status: string
    ops_customers:
      | {
          full_name: string
          business_name: string | null
        }
      | {
          full_name: string
          business_name: string | null
        }[]
      | null
    ops_appointment_line_items: Array<{
      id: string
      name_snapshot: string
    }>
  }>
  events: Array<{
    id: string
    title: string
    start_date: string
    end_date: string
    start_time: string | null
    end_time: string | null
  }>
}

type LineItemForm = {
  service_catalog_item_id: string
  name_snapshot: string
  quantity: string
  unit_price: string
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfWeek(dateValue: string): Date {
  const date = new Date(`${dateValue}T12:00:00`)
  date.setDate(date.getDate() - date.getDay())
  return date
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

function pickDefaultCategory(categories: string[]): string {
  const normalized = categories
    .map((category) => category.trim())
    .filter(Boolean)
  if (normalized.length === 0) return ''

  const exact = normalized.find(
    (category) => category.toLowerCase() === 'carpet cleaning',
  )
  if (exact) return exact

  const closeMatch = normalized.find((category) => {
    const value = category.toLowerCase()
    return value.includes('carpet') && value.includes('clean')
  })
  if (closeMatch) return closeMatch

  return normalized[0]
}

function splitFullName(fullName: string): {
  firstName: string
  lastName: string
} {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  }
}

export function NewJobWorkspace() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const hasAppliedPrefillRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [services, setServices] = useState<ServiceItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<
    CustomerSearchResult[]
  >([])
  const [searchingCustomers, setSearchingCustomers] = useState(false)
  const [schedulePreview, setSchedulePreview] = useState<SchedulePreview>({
    appointments: [],
    events: [],
  })
  const [availableSlots, setAvailableSlots] = useState<
    Array<{ start_time: string; end_time: string }>
  >([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  const [lineItems, setLineItems] = useState<LineItemForm[]>([])

  const [customerForm, setCustomerForm] = useState({
    first_name: '',
    last_name: '',
    business_name: '',
    email: '',
    phone: '',
    notes: '',
  })

  const [addressSelection, setAddressSelection] = useState<'new' | string>(
    'new',
  )
  const [addressForm, setAddressForm] = useState({
    label: 'Service Address',
    street_1: '',
    street_2: '',
    city: 'Colorado Springs',
    state: 'CO',
    zip_code: '',
    gate_code: '',
    notes: '',
  })

  const [appointmentForm, setAppointmentForm] = useState({
    appointment_date: formatDateKey(new Date()),
    start_time: '09:00',
    assigned_staff_user_id: '',
    internal_notes: '',
  })

  const [discount, setDiscount] = useState('0')
  const [leadSource, setLeadSource] = useState('')
  const [useCustomTime, setUseCustomTime] = useState(false)

  // Address autocomplete
  const [addrQuery, setAddrQuery] = useState('')
  const [addrSuggestions, setAddrSuggestions] = useState<
    Array<{
      label: string
      street: string
      city: string
      state: string
      zip: string
    }>
  >([])
  const [addrLoading, setAddrLoading] = useState(false)
  const addrDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerSearchResult | null>(null)

  useEffect(() => {
    if (hasAppliedPrefillRef.current) return

    const dateParam = String(searchParams.get('date') || '').trim()
    const timeParam = String(searchParams.get('time') || '')
      .trim()
      .slice(0, 5)

    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null
    const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(timeParam)
      ? timeParam
      : null

    if (!validDate && !validTime) {
      hasAppliedPrefillRef.current = true
      return
    }

    setAppointmentForm((current) => ({
      ...current,
      appointment_date: validDate || current.appointment_date,
      start_time: validTime || current.start_time,
    }))
    hasAppliedPrefillRef.current = true
  }, [searchParams])

  useEffect(() => {
    async function loadServices() {
      setLoading(true)
      try {
        const response = await fetch('/api/admin/ops/bootstrap', {
          cache: 'no-store',
        })
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Failed to load services')
        }
        const fetchedServices = (result.services || []) as ServiceItem[]
        setServices(fetchedServices)
        if (fetchedServices.length > 0) {
          const discoveredCategories = [
            ...new Set(
              fetchedServices.map((service) =>
                String(service.category || '').trim(),
              ),
            ),
          ]
          const defaultCategory = pickDefaultCategory(discoveredCategories)
          if (defaultCategory) {
            setSelectedCategory(defaultCategory)
          }
        }
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load services',
        )
      } finally {
        setLoading(false)
      }
    }

    void loadServices()
  }, [])

  const loadSchedulePreview = useCallback(async () => {
    try {
      const weekStart = startOfWeek(appointmentForm.appointment_date)
      const weekEnd = addDays(weekStart, 6)
      const response = await fetch(
        `/api/admin/ops/schedule?start_date=${formatDateKey(weekStart)}&end_date=${formatDateKey(weekEnd)}`,
        { cache: 'no-store' },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load week preview')
      }
      setSchedulePreview({
        appointments: result.appointments || [],
        events: result.events || [],
      })
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : 'Failed to load week preview',
      )
    }
  }, [appointmentForm.appointment_date])

  useEffect(() => {
    void loadSchedulePreview()
  }, [loadSchedulePreview])

  useEffect(() => {
    async function searchCustomers() {
      setSearchingCustomers(true)
      try {
        const response = await fetch(
          `/api/admin/ops/customers?q=${encodeURIComponent(customerQuery)}`,
          { cache: 'no-store' },
        )
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Failed to search customers')
        }
        setCustomerResults(result.customers || [])
      } catch (searchError) {
        setError(
          searchError instanceof Error
            ? searchError.message
            : 'Failed to search customers',
        )
      } finally {
        setSearchingCustomers(false)
      }
    }

    if (!customerQuery.trim()) {
      setCustomerResults([])
      return
    }

    const timeoutId = window.setTimeout(() => {
      void searchCustomers()
    }, 250)

    return () => window.clearTimeout(timeoutId)
  }, [customerQuery])

  const servicesById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  )

  const categories = useMemo(() => {
    return [
      ...new Set(services.map((service) => service.category.trim())),
    ].sort((a, b) => a.localeCompare(b))
  }, [services])

  useEffect(() => {
    if (categories.length === 0) {
      if (selectedCategory) setSelectedCategory('')
      return
    }
    if (!selectedCategory || !categories.includes(selectedCategory)) {
      setSelectedCategory(pickDefaultCategory(categories))
    }
  }, [categories, selectedCategory])

  const servicesInSelectedCategory = useMemo(() => {
    if (!selectedCategory) return services
    return services.filter(
      (service) => service.category.trim() === selectedCategory,
    )
  }, [services, selectedCategory])

  const lineItemByServiceId = useMemo(() => {
    return new Map(
      lineItems.map((item) => [item.service_catalog_item_id, item]),
    )
  }, [lineItems])

  const selectedWeekDays = useMemo(() => {
    const start = startOfWeek(appointmentForm.appointment_date)
    return Array.from({ length: 7 }, (_, index) => addDays(start, index))
  }, [appointmentForm.appointment_date])

  const subtotalQuote = lineItems.reduce((sum, item) => {
    const quantity = Number(item.quantity || 1)
    const unitPrice = Number(item.unit_price || 0)
    return sum + quantity * unitPrice
  }, 0)
  const discountAmount = Math.max(0, Number(discount || 0))
  const totalQuote = Math.max(0, subtotalQuote - discountAmount)
  const totalSelectedUnits = lineItems.reduce(
    (sum, item) => sum + Math.max(0, Number(item.quantity || 0)),
    0,
  )
  const serviceMinutesForCurrentSelection = lineItems.reduce((sum, item) => {
    const service = servicesById.get(item.service_catalog_item_id)
    const durationMinutes = Number(service?.default_duration_minutes || 0)
    const quantity = Number(item.quantity || 0)
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return sum
    if (!Number.isFinite(quantity) || quantity <= 0) return sum
    return (
      sum +
      calculateLineItemDurationMinutes({
        durationMinutes,
        quantity,
      })
    )
  }, 0)
  const bufferMinutesForCurrentSelection =
    serviceMinutesForCurrentSelection > 0
      ? DEFAULT_APPOINTMENT_BUFFER_MINUTES
      : 0
  const requiredMinutesForCurrentSelection = applyAppointmentBuffer(
    serviceMinutesForCurrentSelection,
    bufferMinutesForCurrentSelection,
  )
  const unpricedLineItems = lineItems.filter(
    (item) =>
      Number(item.quantity || 0) > 0 && Number(item.unit_price || 0) <= 0,
  ).length

  const handleSelectCustomer = (customer: CustomerSearchResult) => {
    const derivedName = splitFullName(customer.full_name)
    setSelectedCustomer(customer)
    setCustomerForm({
      first_name: customer.first_name || derivedName.firstName,
      last_name: customer.last_name || derivedName.lastName,
      business_name: customer.business_name || '',
      email: customer.email || '',
      phone: customer.phone || '',
      notes: customer.notes || '',
    })
    if (customer.ops_service_addresses?.length > 0) {
      const firstAddress = customer.ops_service_addresses[0]
      setAddressSelection(firstAddress.id)
      setAddressForm({
        label: firstAddress.label || 'Service Address',
        street_1: firstAddress.street_1,
        street_2: firstAddress.street_2 || '',
        city: firstAddress.city,
        state: firstAddress.state,
        zip_code: firstAddress.zip_code,
        gate_code: firstAddress.gate_code || '',
        notes: firstAddress.notes || '',
      })
    }
  }

  const handleAddressSelectionChange = (value: string) => {
    setAddressSelection(value)
    if (value === 'new') return
    const selectedAddress = selectedCustomer?.ops_service_addresses?.find(
      (address) => address.id === value,
    )
    if (!selectedAddress) return
    setAddressForm({
      label: selectedAddress.label || 'Service Address',
      street_1: selectedAddress.street_1,
      street_2: selectedAddress.street_2 || '',
      city: selectedAddress.city,
      state: selectedAddress.state,
      zip_code: selectedAddress.zip_code,
      gate_code: selectedAddress.gate_code || '',
      notes: selectedAddress.notes || '',
    })
  }

  const handleLineItemChange = (
    index: number,
    field: keyof LineItemForm,
    value: string,
  ) => {
    setLineItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        if (field === 'service_catalog_item_id') {
          const service = servicesById.get(value)
          return {
            ...item,
            service_catalog_item_id: value,
            name_snapshot: service?.name || item.name_snapshot,
            unit_price:
              service?.base_price !== null && service?.base_price !== undefined
                ? String(service.base_price)
                : item.unit_price,
          }
        }
        return {
          ...item,
          [field]: value,
        }
      }),
    )
  }

  const upsertLineItemQuantity = (
    service: ServiceItem,
    nextQuantity: number,
  ) => {
    setLineItems((current) => {
      const existing = current.find(
        (item) => item.service_catalog_item_id === service.id,
      )
      if (nextQuantity <= 0) {
        return current.filter(
          (item) => item.service_catalog_item_id !== service.id,
        )
      }
      if (existing) {
        return current.map((item) =>
          item.service_catalog_item_id === service.id
            ? { ...item, quantity: String(nextQuantity) }
            : item,
        )
      }
      return [
        ...current,
        {
          service_catalog_item_id: service.id,
          name_snapshot: service.name,
          quantity: String(nextQuantity),
          unit_price:
            service.base_price !== null && service.base_price !== undefined
              ? String(service.base_price)
              : '',
        },
      ]
    })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const payload = {
        customer: customerForm,
        address:
          addressSelection !== 'new'
            ? { id: addressSelection }
            : {
                ...addressForm,
              },
        appointment: appointmentForm,
        discount_amount: Math.max(0, Number(discount || 0)),
        lead_source: leadSource.trim() || null,
        line_items: lineItems.map((item) => ({
          service_catalog_item_id: item.service_catalog_item_id || null,
          name_snapshot: item.name_snapshot,
          quantity: Number(item.quantity || 1),
          unit_price: Number(item.unit_price || 0),
        })),
      }

      const response = await fetch('/api/admin/ops/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to create job')
      }

      router.push(`/admin/operations/appointments/${result.appointment.id}`)
      router.refresh()
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Failed to create job',
      )
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    async function loadAvailableTimes() {
      if (
        !appointmentForm.appointment_date ||
        requiredMinutesForCurrentSelection <= 0
      ) {
        setAvailableSlots([])
        return
      }
      setLoadingSlots(true)
      try {
        const searchParams = new URLSearchParams({
          date: appointmentForm.appointment_date,
          required_minutes: String(requiredMinutesForCurrentSelection),
        })
        const response = await fetch(
          `/api/admin/ops/slots?${searchParams.toString()}`,
          { cache: 'no-store' },
        )
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Failed to load available slots')
        }
        const slots: Array<{ start_time: string; end_time: string }> =
          Array.isArray(result.slots) ? result.slots : []
        setAvailableSlots(slots)
        if (slots.length === 0) {
          setUseCustomTime(true)
          return
        }

        const currentStart = `${appointmentForm.start_time}:00`.slice(0, 8)
        const stillValid = slots.some(
          (slot) => slot.start_time === currentStart,
        )
        if (!stillValid) {
          setAppointmentForm((current) => ({
            ...current,
            start_time: String(slots[0].start_time || '09:00').slice(0, 5),
          }))
        }
      } catch (slotError) {
        setError(
          slotError instanceof Error
            ? slotError.message
            : 'Failed to load available slots',
        )
      } finally {
        setLoadingSlots(false)
      }
    }

    void loadAvailableTimes()
  }, [appointmentForm.appointment_date, requiredMinutesForCurrentSelection])

  return (
    <div className="space-y-6">
      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      <form
        className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]"
        onSubmit={handleSubmit}
      >
        <div className="space-y-6">
          <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Standard Job</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Start with price and scope, then finish customer and address
                  details.
                </p>
              </div>
              <Badge variant="outline">${totalQuote.toFixed(2)} quote</Badge>
            </div>
          </Card>

          <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Job Details + Pricing</h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  Choose a category, tap plus/minus for quantities, then adjust
                  price if needed.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLineItems((current) => [
                    ...current,
                    {
                      service_catalog_item_id: '',
                      name_snapshot: '',
                      quantity: '1',
                      unit_price: '',
                    },
                  ])
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Custom Line
              </Button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <Label htmlFor="service-category-picker">Category</Label>
                <select
                  id="service-category-picker"
                  className="border-input bg-background mt-1 h-10 w-full rounded-md border px-3 text-sm"
                  value={selectedCategory}
                  onChange={(event) => setSelectedCategory(event.target.value)}
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                {servicesInSelectedCategory.map((service) => {
                  const quantity =
                    Number(
                      lineItemByServiceId.get(service.id)?.quantity || '0',
                    ) || 0
                  const lineSubtotal =
                    Number(service.base_price || 0) * quantity
                  return (
                    <div
                      key={service.id}
                      className="border-border/60 bg-background/70 flex items-center justify-between rounded-2xl border px-3 py-2"
                    >
                      <div>
                        <div className="font-medium">{service.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {service.base_price !== null
                            ? `$${Number(service.base_price).toFixed(2)} each`
                            : 'Set price manually'}
                        </div>
                        {quantity > 0 ? (
                          <div className="text-xs font-semibold">
                            Running line total: ${lineSubtotal.toFixed(2)}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() =>
                            upsertLineItemQuantity(service, quantity - 1)
                          }
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <div className="min-w-8 text-center font-semibold">
                          {quantity}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() =>
                            upsertLineItemQuantity(service, quantity + 1)
                          }
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {lineItems.map((item, index) => (
                <div
                  key={`${item.service_catalog_item_id}-${index}`}
                  className="border-border/60 bg-background/70 rounded-2xl border p-4"
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <Label htmlFor={`service-${index}`}>Service</Label>
                      <select
                        id={`service-${index}`}
                        className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                        value={item.service_catalog_item_id}
                        onChange={(event) =>
                          handleLineItemChange(
                            index,
                            'service_catalog_item_id',
                            event.target.value,
                          )
                        }
                      >
                        <option value="">Select service</option>
                        {services.map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor={`name-${index}`}>Display Name</Label>
                      <Input
                        id={`name-${index}`}
                        value={item.name_snapshot}
                        onChange={(event) =>
                          handleLineItemChange(
                            index,
                            'name_snapshot',
                            event.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor={`qty-${index}`}>Quantity</Label>
                      <Input
                        id={`qty-${index}`}
                        type="number"
                        value={item.quantity}
                        onChange={(event) =>
                          handleLineItemChange(
                            index,
                            'quantity',
                            event.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor={`price-${index}`}>Unit Price</Label>
                      <Input
                        id={`price-${index}`}
                        type="number"
                        step="0.01"
                        value={item.unit_price}
                        onChange={(event) =>
                          handleLineItemChange(
                            index,
                            'unit_price',
                            event.target.value,
                          )
                        }
                      />
                    </div>
                  </div>

                  {lineItems.length > 1 ? (
                    <div className="mt-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setLineItems((current) =>
                            current.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          )
                        }
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove Line
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="border-border/60 bg-background/80 mt-4 rounded-2xl border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">Running Quote</div>
                  <div className="text-muted-foreground text-xs">
                    {totalSelectedUnits} selected item
                    {totalSelectedUnits === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {discountAmount > 0 ? (
                    <div className="text-sm text-slate-500 tabular-nums line-through">
                      ${subtotalQuote.toFixed(2)}
                    </div>
                  ) : null}
                  <div className="text-xl font-bold">
                    ${totalQuote.toFixed(2)}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <label
                  htmlFor="new-job-discount"
                  className="text-sm whitespace-nowrap text-slate-500"
                >
                  Discount ($)
                </label>
                <input
                  id="new-job-discount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="border-input bg-background h-8 w-24 rounded-md border px-2 text-right text-sm"
                />
              </div>
              {unpricedLineItems > 0 ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  {unpricedLineItems} selected service
                  {unpricedLineItems === 1 ? ' has' : 's have'} no price yet.
                </p>
              ) : null}
            </div>
          </Card>

          <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Customer</h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  Search a returning customer or enter a new one below.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <Label htmlFor="customer-search">Find returning customer</Label>
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <Input
                    id="customer-search"
                    className="pl-9"
                    value={customerQuery}
                    onChange={(event) => setCustomerQuery(event.target.value)}
                    placeholder="Search by name, business, phone, or email"
                  />
                </div>
                {searchingCustomers ? (
                  <div className="text-muted-foreground mt-2 flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching customers...
                  </div>
                ) : null}
                {customerResults.length > 0 ? (
                  <div className="mt-3 grid gap-2">
                    {customerResults.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        className={`rounded-2xl border p-3 text-left transition ${
                          selectedCustomer?.id === customer.id
                            ? 'border-primary bg-primary/5'
                            : 'border-border/60 bg-background/70 hover:bg-muted/60'
                        }`}
                        onClick={() => handleSelectCustomer(customer)}
                      >
                        <div className="font-medium">
                          {customer.business_name || customer.full_name}
                        </div>
                        <div className="text-muted-foreground mt-1 text-sm">
                          {customer.full_name} · {customer.phone}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label htmlFor="first-name">First Name</Label>
                  <Input
                    id="first-name"
                    value={customerForm.first_name}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        first_name: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="last-name">Last Name</Label>
                  <Input
                    id="last-name"
                    value={customerForm.last_name}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        last_name: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="business-name">Business Name</Label>
                  <Input
                    id="business-name"
                    value={customerForm.business_name}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        business_name: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="customer-phone">Phone</Label>
                  <Input
                    id="customer-phone"
                    value={customerForm.phone}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        phone: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="customer-email">Email</Label>
                  <Input
                    id="customer-email"
                    type="email"
                    value={customerForm.email}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="customer-notes">Customer Notes</Label>
                  <Textarea
                    id="customer-notes"
                    value={customerForm.notes}
                    onChange={(event) =>
                      setCustomerForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="General customer notes"
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
            <div>
              <h3 className="text-lg font-semibold">Service Address</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                Select an existing property or add another address for this
                customer.
              </p>
            </div>

            {selectedCustomer?.ops_service_addresses?.length ? (
              <div className="mt-4">
                <Label htmlFor="saved-address">Saved Addresses</Label>
                <select
                  id="saved-address"
                  className="border-input bg-background mt-1 h-10 w-full rounded-md border px-3 text-sm"
                  value={addressSelection}
                  onChange={(event) =>
                    handleAddressSelectionChange(event.target.value)
                  }
                >
                  {selectedCustomer.ops_service_addresses.map((address) => (
                    <option key={address.id} value={address.id}>
                      {(address.label || 'Service Address') +
                        ` · ${address.street_1}, ${address.city}`}
                    </option>
                  ))}
                  <option value="new">Add another address</option>
                </select>
              </div>
            ) : null}

            {addressSelection !== 'new' ? (
              <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm">
                <div className="font-medium">
                  Using saved address for this job
                </div>
                <div className="mt-1 text-emerald-100/90">
                  {addressForm.street_1}
                  {addressForm.street_2
                    ? `, ${addressForm.street_2}`
                    : ''}, {addressForm.city}, {addressForm.state}{' '}
                  {addressForm.zip_code}
                </div>
                <div className="mt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setAddressSelection('new')}
                  >
                    Use New Address Instead
                  </Button>
                </div>
              </div>
            ) : null}

            {addressSelection === 'new' ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                  <Label htmlFor="address-label">Label</Label>
                  <Input
                    id="address-label"
                    value={addressForm.label}
                    onChange={(event) =>
                      setAddressForm((current) => ({
                        ...current,
                        label: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="street-1">Street</Label>
                  <div className="relative">
                    <Input
                      id="street-1"
                      autoComplete="off"
                      value={addrQuery || addressForm.street_1}
                      placeholder="Start typing an address…"
                      onChange={(event) => {
                        const q = event.target.value
                        setAddrQuery(q)
                        setAddressForm((current) => ({
                          ...current,
                          street_1: q,
                        }))
                        if (addrDebounceRef.current)
                          clearTimeout(addrDebounceRef.current)
                        if (q.length < 3) {
                          setAddrSuggestions([])
                          return
                        }
                        addrDebounceRef.current = setTimeout(async () => {
                          setAddrLoading(true)
                          try {
                            // Biased toward Colorado Springs
                            const res = await fetch(
                              `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&lat=38.8339&lon=-104.8214&layer=house`,
                            )
                            const data = (await res.json()) as {
                              features: Array<{
                                properties: {
                                  housenumber?: string
                                  street?: string
                                  name?: string
                                  city?: string
                                  state?: string
                                  postcode?: string
                                  country?: string
                                }
                              }>
                            }
                            const suggestions = (data.features ?? [])
                              .filter(
                                (f) => f.properties.country === 'United States',
                              )
                              .map((f) => {
                                const p = f.properties
                                const streetLine = [
                                  p.housenumber,
                                  p.street ?? p.name,
                                ]
                                  .filter(Boolean)
                                  .join(' ')
                                return {
                                  label: [
                                    streetLine,
                                    p.city,
                                    p.state,
                                    p.postcode,
                                  ]
                                    .filter(Boolean)
                                    .join(', '),
                                  street: streetLine,
                                  city: p.city ?? '',
                                  state: p.state ?? '',
                                  zip: p.postcode ?? '',
                                }
                              })
                              .filter((s) => s.street)
                            setAddrSuggestions(suggestions)
                          } catch {
                            setAddrSuggestions([])
                          } finally {
                            setAddrLoading(false)
                          }
                        }, 320)
                      }}
                    />
                    {addrLoading ? (
                      <Loader2 className="text-muted-foreground absolute top-2.5 right-3 h-4 w-4 animate-spin" />
                    ) : null}
                    {addrSuggestions.length > 0 ? (
                      <ul className="border-border bg-card absolute z-50 mt-1 w-full overflow-hidden rounded-xl border shadow-lg">
                        {addrSuggestions.map((s, i) => (
                          <li key={i}>
                            <button
                              type="button"
                              className="hover:bg-accent w-full px-4 py-2.5 text-left text-sm"
                              onClick={() => {
                                setAddressForm((current) => ({
                                  ...current,
                                  street_1: s.street,
                                  city: s.city || current.city,
                                  state: s.state
                                    ? s.state.length === 2
                                      ? s.state
                                      : s.state.slice(0, 2).toUpperCase()
                                    : current.state,
                                  zip_code: s.zip || current.zip_code,
                                }))
                                setAddrQuery('')
                                setAddrSuggestions([])
                              }}
                            >
                              {s.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
                <div>
                  <Label htmlFor="street-2">Unit / Street 2</Label>
                  <Input
                    id="street-2"
                    value={addressForm.street_2}
                    onChange={(event) =>
                      setAddressForm((current) => ({
                        ...current,
                        street_2: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="gate-code">Gate Code</Label>
                  <Input
                    id="gate-code"
                    value={addressForm.gate_code}
                    onChange={(event) =>
                      setAddressForm((current) => ({
                        ...current,
                        gate_code: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={addressForm.city}
                    onChange={(event) =>
                      setAddressForm((current) => ({
                        ...current,
                        city: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    value={addressForm.state}
                    onChange={(event) =>
                      setAddressForm((current) => ({
                        ...current,
                        state: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="zip-code">Zip</Label>
                  <Input
                    id="zip-code"
                    value={addressForm.zip_code}
                    onChange={(event) =>
                      setAddressForm((current) => ({
                        ...current,
                        zip_code: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="address-notes">Access Notes</Label>
                  <Textarea
                    id="address-notes"
                    value={addressForm.notes}
                    onChange={(event) =>
                      setAddressForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Gate codes, parking, lockbox, property manager instructions"
                  />
                </div>
              </div>
            ) : null}
          </Card>

          <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
            <h3 className="text-lg font-semibold">Schedule</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div>
                <Label htmlFor="appointment-date">Date</Label>
                <Input
                  id="appointment-date"
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
                <Label htmlFor="appointment-time">Start Time</Label>
                <select
                  id="appointment-time"
                  className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                  value={appointmentForm.start_time}
                  onChange={(event) =>
                    setAppointmentForm((current) => ({
                      ...current,
                      start_time: event.target.value,
                    }))
                  }
                  disabled={
                    loadingSlots ||
                    requiredMinutesForCurrentSelection <= 0 ||
                    availableSlots.length === 0
                  }
                >
                  {loadingSlots ? (
                    <option value={appointmentForm.start_time}>
                      Loading available times...
                    </option>
                  ) : availableSlots.length === 0 ? (
                    <option value="">
                      {requiredMinutesForCurrentSelection <= 0
                        ? 'Add services with duration first'
                        : 'No open times for this day'}
                    </option>
                  ) : (
                    availableSlots.map((slot) => {
                      const start = String(slot.start_time).slice(0, 5)
                      const end = String(slot.end_time).slice(0, 5)
                      return (
                        <option key={slot.start_time} value={start}>
                          {start} - {end}
                        </option>
                      )
                    })
                  )}
                </select>
                <div className="text-muted-foreground mt-1 text-xs">
                  {requiredMinutesForCurrentSelection > 0
                    ? `Only open times are shown (service: ${serviceMinutesForCurrentSelection} min + one travel buffer: ${bufferMinutesForCurrentSelection} min = ${requiredMinutesForCurrentSelection} min).`
                    : 'Pick services first so we can calculate valid openings.'}
                </div>
                <button
                  type="button"
                  className="mt-1 text-xs text-blue-600 underline hover:text-blue-800"
                  onClick={() => setUseCustomTime((v) => !v)}
                >
                  {useCustomTime
                    ? '← Back to available slots'
                    : 'Book outside business hours →'}
                </button>
                {useCustomTime && (
                  <div className="mt-2">
                    <input
                      type="time"
                      className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                      value={appointmentForm.start_time}
                      onChange={(event) =>
                        setAppointmentForm((current) => ({
                          ...current,
                          start_time: event.target.value,
                        }))
                      }
                    />
                    <p className="text-muted-foreground mt-1 text-xs">
                      Admin override — any time accepted, no conflict check.
                    </p>
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="appointment-tech">Assigned Staff</Label>
                <Input
                  id="appointment-tech"
                  value={appointmentForm.assigned_staff_user_id}
                  onChange={(event) =>
                    setAppointmentForm((current) => ({
                      ...current,
                      assigned_staff_user_id: event.target.value,
                    }))
                  }
                  placeholder="Future staff selector"
                />
              </div>
              <div>
                <Label htmlFor="lead-source">Lead Source</Label>
                <select
                  id="lead-source"
                  className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                  value={leadSource}
                  onChange={(event) => setLeadSource(event.target.value)}
                >
                  <option value="">— Select source —</option>
                  <option value="Google">Google</option>
                  <option value="Word of mouth / Referral">
                    Word of mouth / Referral
                  </option>
                  <option value="Nextdoor">Nextdoor</option>
                  <option value="Facebook">Facebook</option>
                  <option value="Yelp">Yelp</option>
                  <option value="Repeat customer">Repeat customer</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="md:col-span-3">
                <Label htmlFor="internal-notes">Internal Notes</Label>
                <Textarea
                  id="internal-notes"
                  value={appointmentForm.internal_notes}
                  onChange={(event) =>
                    setAppointmentForm((current) => ({
                      ...current,
                      internal_notes: event.target.value,
                    }))
                  }
                  placeholder="Crew notes, quoting details, access reminders"
                />
              </div>
            </div>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving || loading}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save Job
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/admin/operations')}
            >
              Cancel
            </Button>
          </div>

          <Card className="border-border/60 bg-card/95 sticky bottom-3 z-20 p-3 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-muted-foreground text-xs font-medium uppercase">
                  Quick Quote
                </p>
                <p className="text-sm">
                  {totalSelectedUnits} selected · Tap items above for instant
                  total
                </p>
              </div>
              <div className="text-2xl font-bold">${totalQuote.toFixed(2)}</div>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
            <h3 className="text-lg font-semibold">Live Week Context</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Pick the start time on the left while keeping the current week
              visible here.
            </p>
          </Card>

          <Card className="border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
            <div className="grid gap-3">
              {selectedWeekDays.map((day) => {
                const dateKey = formatDateKey(day)
                const dayAppointments = schedulePreview.appointments.filter(
                  (appointment) => appointment.appointment_date === dateKey,
                )
                const dayEvents = schedulePreview.events.filter(
                  (event) =>
                    event.start_date <= dateKey && event.end_date >= dateKey,
                )

                return (
                  <div
                    key={dateKey}
                    className={`rounded-2xl border p-4 ${
                      appointmentForm.appointment_date === dateKey
                        ? 'border-primary bg-primary/5'
                        : 'border-border/60 bg-background/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase">
                          {day.toLocaleDateString('en-US', {
                            weekday: 'short',
                          })}
                        </div>
                        <div className="mt-1 text-base font-semibold">
                          {day.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setAppointmentForm((current) => ({
                            ...current,
                            appointment_date: dateKey,
                          }))
                        }
                      >
                        Use This Day
                      </Button>
                    </div>

                    <div className="mt-3 space-y-2">
                      {dayEvents.map((event) => (
                        <div
                          key={event.id}
                          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
                        >
                          {event.title}
                        </div>
                      ))}

                      {dayAppointments.length === 0 &&
                      dayEvents.length === 0 ? (
                        <div className="text-muted-foreground text-sm">
                          No conflicts yet.
                        </div>
                      ) : null}

                      {dayAppointments.map((appointment) => {
                        const customer = unwrapRelation(
                          appointment.ops_customers,
                        )
                        return (
                          <div
                            key={appointment.id}
                            className="border-border/60 bg-card rounded-xl border px-3 py-2 text-sm"
                          >
                            <div className="font-medium">
                              {appointment.start_time.slice(0, 5)} -{' '}
                              {appointment.end_time.slice(0, 5)}
                            </div>
                            <div className="text-muted-foreground mt-1">
                              {customer?.business_name || customer?.full_name}
                            </div>
                            <div className="text-muted-foreground mt-1">
                              {appointment.ops_appointment_line_items
                                .map((item) => item.name_snapshot)
                                .join(', ')}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      </form>
    </div>
  )
}
