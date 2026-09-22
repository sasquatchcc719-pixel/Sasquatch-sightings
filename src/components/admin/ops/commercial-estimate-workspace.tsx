'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Building2,
  CalendarCheck,
  Loader2,
  MapPin,
  Ruler,
  Search,
  UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  CANONICAL_LEAD_SOURCE_OPTIONS,
  getPublicLeadSourceOptions,
  type PublicLeadSourceOption,
} from '@/lib/lead-sources'
import { DayTimePicker, type DayPickerAppointment } from './day-time-picker'

type ServiceAddress = {
  id: string
  label: string | null
  street_1: string
  street_2: string | null
  city: string
  state: string
  zip_code: string
}

type BusinessResult = {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  business_name: string | null
  email: string | null
  phone: string | null
  is_commercial?: boolean | null
  ops_service_addresses: ServiceAddress[] | null
}

type StaffMember = {
  id: string
  display_name: string
  default_open?: boolean | null
}

type Slot = {
  start_time: string
  end_time: string
}

type ScheduleAppointment = {
  id: string
  appointment_date: string
  start_time: string
  end_time: string
  assigned_staff_user_id: string | null
  ops_customers:
    | { full_name: string | null; business_name: string | null }
    | Array<{ full_name: string | null; business_name: string | null }>
    | null
  ops_appointment_line_items: Array<{ name_snapshot: string }> | null
}

type DailyAvailability = {
  staff_user_id: string
  date: string
  is_open: boolean
}

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function validDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function validTime(value: string | null): string | null {
  const time = String(value || '').slice(0, 5)
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null
}

function formatTime(value: string): string {
  const [hour, minute] = value.slice(0, 5).split(':').map(Number)
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`
}

export function CommercialEstimateWorkspace() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefilledDate = validDate(searchParams.get('date'))
  const prefilledTime = validTime(searchParams.get('time'))
  const prefilledStaffId = String(searchParams.get('staff') || '')
  const [appointmentDate, setAppointmentDate] = useState(
    () => prefilledDate || dateKey(new Date()),
  )
  const [startTime, setStartTime] = useState(() => prefilledTime || '')
  const [staffId, setStaffId] = useState(prefilledStaffId)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [scheduleAppointments, setScheduleAppointments] = useState<
    ScheduleAppointment[]
  >([])
  const [dailyAvailability, setDailyAvailability] = useState<
    DailyAvailability[]
  >([])
  const [prefillConflict, setPrefillConflict] = useState<string | null>(null)
  const prefillValidated = useRef(false)
  const [leadSourceOptions, setLeadSourceOptions] = useState<
    PublicLeadSourceOption[]
  >(() => getPublicLeadSourceOptions(CANONICAL_LEAD_SOURCE_OPTIONS))
  const [leadSource, setLeadSource] = useState('')
  const [leadSourceDetail, setLeadSourceDetail] = useState('')

  const [businessQuery, setBusinessQuery] = useState('')
  const [businessResults, setBusinessResults] = useState<BusinessResult[]>([])
  const [businessSearching, setBusinessSearching] = useState(false)
  const [selectedBusiness, setSelectedBusiness] =
    useState<BusinessResult | null>(null)
  const [selectedAddressId, setSelectedAddressId] = useState('new')
  const [customer, setCustomer] = useState({
    business_name: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
  })
  const [address, setAddress] = useState({
    street_1: '',
    street_2: '',
    city: 'Colorado Springs',
    state: 'CO',
    zip_code: '',
  })
  const [jobDescription, setJobDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedLeadSource = leadSourceOptions.find(
    (option) => option.key === leadSource,
  )
  const selectedSlot = slots.find(
    (slot) => slot.start_time.slice(0, 5) === startTime,
  )
  const savedAddresses = selectedBusiness?.ops_service_addresses || []
  const selectedDayAppointments = useMemo<DayPickerAppointment[]>(() => {
    return scheduleAppointments
      .filter(
        (appointment) =>
          appointment.appointment_date === appointmentDate &&
          (!staffId || appointment.assigned_staff_user_id === staffId),
      )
      .map((appointment) => {
        const customer = relatedOne(appointment.ops_customers)
        return {
          id: appointment.id,
          start_time: appointment.start_time,
          end_time: appointment.end_time,
          label:
            customer?.business_name || customer?.full_name || 'Booked visit',
          detail: (appointment.ops_appointment_line_items || [])
            .map((item) => item.name_snapshot)
            .join(', '),
        }
      })
  }, [appointmentDate, scheduleAppointments, staffId])
  const selectedStaffClosedForDay = useMemo(() => {
    const override = dailyAvailability.find(
      (availability) =>
        availability.staff_user_id === staffId &&
        availability.date === appointmentDate,
    )
    if (override) return !override.is_open
    return staff.find((member) => member.id === staffId)?.default_open === false
  }, [appointmentDate, dailyAvailability, staff, staffId])

  useEffect(() => {
    let ignore = false
    void fetch('/api/public/lead-sources', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null
        return response.json()
      })
      .then((result) => {
        if (!ignore && Array.isArray(result?.options)) {
          setLeadSourceOptions(result.options)
        }
      })
      .catch(() => null)
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (businessQuery.trim().length < 2 || selectedBusiness) {
      setBusinessResults([])
      setBusinessSearching(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setBusinessSearching(true)
      void fetch(
        `/api/admin/ops/customers?q=${encodeURIComponent(businessQuery.trim())}`,
        { cache: 'no-store', signal: controller.signal },
      )
        .then(async (response) => {
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'Search failed')
          const rows = Array.isArray(result.customers)
            ? (result.customers as BusinessResult[])
            : []
          setBusinessResults(
            rows.filter(
              (row) => Boolean(row.business_name) || row.is_commercial === true,
            ),
          )
        })
        .catch((searchError) => {
          if (searchError instanceof Error && searchError.name === 'AbortError')
            return
          setBusinessResults([])
        })
        .finally(() => setBusinessSearching(false))
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [businessQuery, selectedBusiness])

  useEffect(() => {
    const controller = new AbortController()
    void fetch(
      `/api/admin/ops/schedule?start_date=${appointmentDate}&end_date=${appointmentDate}`,
      { cache: 'no-store', signal: controller.signal },
    )
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Schedule failed')
        const members = Array.isArray(result.staff)
          ? (result.staff as StaffMember[])
          : []
        setStaff(members)
        setScheduleAppointments(
          Array.isArray(result.appointments)
            ? (result.appointments as ScheduleAppointment[])
            : [],
        )
        setDailyAvailability(
          Array.isArray(result.dailyAvailability)
            ? (result.dailyAvailability as DailyAvailability[])
            : [],
        )
        setStaffId((current) => {
          if (members.some((member) => member.id === current)) return current
          if (
            prefilledStaffId &&
            members.some((member) => member.id === prefilledStaffId)
          )
            return prefilledStaffId
          return members[0]?.id || ''
        })
      })
      .catch((scheduleError) => {
        if (
          scheduleError instanceof Error &&
          scheduleError.name === 'AbortError'
        )
          return
        setStaff([])
        setScheduleAppointments([])
        setDailyAvailability([])
        setError('Unable to load technicians for that day.')
      })
    return () => controller.abort()
  }, [appointmentDate, prefilledStaffId])

  useEffect(() => {
    if (!appointmentDate || !staffId) {
      setSlots([])
      return
    }
    const controller = new AbortController()
    setSlotsLoading(true)
    const params = new URLSearchParams({
      date: appointmentDate,
      required_minutes: '120',
      staff_user_id: staffId,
    })
    void fetch(`/api/admin/ops/slots?${params}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Slots failed')
        const nextSlots = Array.isArray(result.slots)
          ? (result.slots as Slot[])
          : []
        setSlots(nextSlots)
        const shouldValidatePrefill =
          !prefillValidated.current &&
          Boolean(prefilledDate && prefilledTime && prefilledStaffId) &&
          appointmentDate === prefilledDate &&
          staffId === prefilledStaffId
        if (shouldValidatePrefill) {
          prefillValidated.current = true
          const exactPrefillExists = nextSlots.some(
            (slot) => slot.start_time.slice(0, 5) === prefilledTime,
          )
          if (exactPrefillExists) {
            setStartTime(prefilledTime || '')
            setPrefillConflict(null)
          } else {
            setStartTime('')
            setPrefillConflict(
              `${formatTime(prefilledTime || '')} is no longer available for this technician. Choose a green opening below or another day.`,
            )
          }
          return
        }
        setStartTime((current) =>
          nextSlots.some((slot) => slot.start_time.slice(0, 5) === current)
            ? current
            : nextSlots[0]?.start_time.slice(0, 5) || '',
        )
      })
      .catch((slotError) => {
        if (slotError instanceof Error && slotError.name === 'AbortError')
          return
        setSlots([])
        setError('Unable to load available walkthrough times.')
      })
      .finally(() => setSlotsLoading(false))
    return () => controller.abort()
  }, [appointmentDate, prefilledDate, prefilledStaffId, prefilledTime, staffId])

  const canSubmit = useMemo(() => {
    return Boolean(
      customer.business_name.trim() &&
      customer.first_name.trim() &&
      customer.last_name.trim() &&
      customer.email.trim() &&
      customer.phone.trim() &&
      jobDescription.trim() &&
      leadSource &&
      (!selectedLeadSource?.requires_detail || leadSourceDetail.trim()) &&
      staffId &&
      selectedSlot &&
      (selectedAddressId !== 'new' ||
        (address.street_1.trim() &&
          address.city.trim() &&
          address.state.trim() &&
          address.zip_code.trim())),
    )
  }, [
    address,
    customer,
    jobDescription,
    leadSource,
    leadSourceDetail,
    selectedAddressId,
    selectedLeadSource?.requires_detail,
    selectedSlot,
    staffId,
  ])

  function chooseBusiness(result: BusinessResult) {
    setSelectedBusiness(result)
    setBusinessQuery(result.business_name || result.full_name || '')
    setBusinessResults([])
    setCustomer({
      business_name: result.business_name || '',
      first_name: result.first_name || '',
      last_name: result.last_name || '',
      email: result.email || '',
      phone: result.phone || '',
    })
    const firstAddress = result.ops_service_addresses?.[0]
    setSelectedAddressId(firstAddress?.id || 'new')
  }

  function startNewBusiness() {
    setSelectedBusiness(null)
    setBusinessQuery('')
    setBusinessResults([])
    setSelectedAddressId('new')
    setCustomer({
      business_name: '',
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
    })
    setAddress({
      street_1: '',
      street_2: '',
      city: 'Colorado Springs',
      state: 'CO',
      zip_code: '',
    })
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit || saving) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/ops/estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: selectedBusiness?.id || null,
          service_address_id:
            selectedAddressId === 'new' ? null : selectedAddressId,
          customer,
          address,
          appointment_date: appointmentDate,
          start_time: startTime,
          assigned_staff_user_id: staffId,
          job_description: jobDescription,
          lead_source: leadSource,
          lead_source_detail: leadSourceDetail || null,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Unable to schedule estimate.')
      }
      router.push(
        `/admin/operations?date=${appointmentDate}&view=day&appointment=${result.appointment_id}`,
      )
      router.refresh()
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to schedule estimate.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-1 sm:p-4">
      <Card className="via-card relative overflow-hidden border-amber-400/30 bg-gradient-to-br from-amber-500/15 to-cyan-500/10 p-6 shadow-lg">
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-amber-500 uppercase">
              <Ruler className="h-4 w-4" /> Commercial walkthrough
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">
              Schedule commercial estimate
            </h2>
            <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
              Reserve one hour on site to measure and build an exact commercial
              proposal. The calendar also holds the standard one-hour travel and
              setup buffer.
            </p>
          </div>
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm">
            <p className="font-semibold text-amber-700 dark:text-amber-200">
              No price or invoice yet
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Measurements and pricing are added after the visit.
            </p>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      <form className="space-y-6" onSubmit={submit}>
        <Card className="border-border/60 bg-card/80 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <Building2 className="mt-0.5 h-5 w-5 text-amber-500" />
            <div>
              <h3 className="text-lg font-semibold">Business and contact</h3>
              <p className="text-muted-foreground text-sm">
                Reuse an existing commercial account to avoid duplicate records,
                or enter a new prospect.
              </p>
            </div>
          </div>

          <div className="mt-5">
            <Label htmlFor="commercial-business-search">
              Find existing business
            </Label>
            <div className="relative mt-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                id="commercial-business-search"
                className="pl-9"
                value={businessQuery}
                onChange={(event) => {
                  setBusinessQuery(event.target.value)
                  if (selectedBusiness) setSelectedBusiness(null)
                }}
                placeholder="Business name, contact, phone, or email"
              />
            </div>
            {businessSearching ? (
              <p className="text-muted-foreground mt-2 flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </p>
            ) : null}
            {businessResults.length > 0 ? (
              <div className="border-border/60 mt-2 divide-y overflow-hidden rounded-xl border">
                {businessResults.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className="hover:bg-muted/50 flex w-full items-center justify-between gap-3 p-3 text-left"
                    onClick={() => chooseBusiness(result)}
                  >
                    <span>
                      <span className="block font-medium">
                        {result.business_name || result.full_name}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {result.full_name} · {result.phone || result.email}
                      </span>
                    </span>
                    <span className="text-xs text-amber-600">Use business</span>
                  </button>
                ))}
              </div>
            ) : null}
            {selectedBusiness ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                <span>
                  Using <strong>{selectedBusiness.business_name}</strong> and
                  its saved history.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={startNewBusiness}
                >
                  Start new business
                </Button>
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="commercial-business-name">Business name *</Label>
              <Input
                id="commercial-business-name"
                required
                value={customer.business_name}
                onChange={(event) =>
                  setCustomer((current) => ({
                    ...current,
                    business_name: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="commercial-first-name">
                Contact first name *
              </Label>
              <Input
                id="commercial-first-name"
                required
                autoComplete="given-name"
                value={customer.first_name}
                onChange={(event) =>
                  setCustomer((current) => ({
                    ...current,
                    first_name: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="commercial-last-name">Contact last name *</Label>
              <Input
                id="commercial-last-name"
                required
                autoComplete="family-name"
                value={customer.last_name}
                onChange={(event) =>
                  setCustomer((current) => ({
                    ...current,
                    last_name: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="commercial-phone">Phone *</Label>
              <Input
                id="commercial-phone"
                required
                type="tel"
                autoComplete="tel"
                value={customer.phone}
                onChange={(event) =>
                  setCustomer((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="commercial-email">Email *</Label>
              <Input
                id="commercial-email"
                required
                type="email"
                autoComplete="email"
                value={customer.email}
                onChange={(event) =>
                  setCustomer((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
            </div>
          </div>
        </Card>

        <Card className="border-border/60 bg-card/80 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 text-cyan-500" />
            <div>
              <h3 className="text-lg font-semibold">Walkthrough site</h3>
              <p className="text-muted-foreground text-sm">
                Save the property as a real service address for the estimate and
                future agreement.
              </p>
            </div>
          </div>

          {savedAddresses.length > 0 ? (
            <div className="mt-5">
              <Label htmlFor="commercial-address-choice">
                Service address *
              </Label>
              <select
                id="commercial-address-choice"
                className="border-input bg-background mt-1 h-10 w-full rounded-md border px-3 text-sm"
                value={selectedAddressId}
                onChange={(event) => setSelectedAddressId(event.target.value)}
              >
                {savedAddresses.map((saved) => (
                  <option key={saved.id} value={saved.id}>
                    {saved.label || 'Service address'} · {saved.street_1},{' '}
                    {saved.city}
                  </option>
                ))}
                <option value="new">Add a different site</option>
              </select>
            </div>
          ) : null}

          {selectedAddressId === 'new' ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="commercial-street">Street address *</Label>
                <Input
                  id="commercial-street"
                  required
                  autoComplete="street-address"
                  value={address.street_1}
                  onChange={(event) =>
                    setAddress((current) => ({
                      ...current,
                      street_1: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="commercial-street-2">Suite / unit</Label>
                <Input
                  id="commercial-street-2"
                  value={address.street_2}
                  onChange={(event) =>
                    setAddress((current) => ({
                      ...current,
                      street_2: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="commercial-city">City *</Label>
                <Input
                  id="commercial-city"
                  required
                  value={address.city}
                  onChange={(event) =>
                    setAddress((current) => ({
                      ...current,
                      city: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid grid-cols-[90px_1fr] gap-3">
                <div>
                  <Label htmlFor="commercial-state">State *</Label>
                  <Input
                    id="commercial-state"
                    required
                    maxLength={2}
                    value={address.state}
                    onChange={(event) =>
                      setAddress((current) => ({
                        ...current,
                        state: event.target.value.toUpperCase(),
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="commercial-zip">ZIP *</Label>
                  <Input
                    id="commercial-zip"
                    required
                    autoComplete="postal-code"
                    value={address.zip_code}
                    onChange={(event) =>
                      setAddress((current) => ({
                        ...current,
                        zip_code: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-5">
            <Label htmlFor="commercial-scope">What needs to be quoted? *</Label>
            <Textarea
              id="commercial-scope"
              required
              rows={4}
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              placeholder="Approximate square footage, floor types, occupancy, problem areas, access, urgency…"
            />
          </div>
        </Card>

        <Card className="border-border/60 bg-card/80 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <CalendarCheck className="mt-0.5 h-5 w-5 text-emerald-500" />
            <div>
              <h3 className="text-lg font-semibold">Schedule</h3>
              <p className="text-muted-foreground text-sm">
                One hour on site plus the standard one-hour travel/setup buffer.
              </p>
            </div>
          </div>

          <div className="mt-5">
            <Label htmlFor="commercial-estimate-staff">
              Assigned technician *
            </Label>
            <select
              id="commercial-estimate-staff"
              required
              className="border-input bg-background mt-1 h-10 w-full rounded-md border px-3 text-sm"
              value={staffId}
              onChange={(event) => {
                setStaffId(event.target.value)
                setStartTime('')
                setPrefillConflict(null)
              }}
            >
              <option value="">Choose technician</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.display_name}
                </option>
              ))}
            </select>
            {staff.length > 1 ? (
              <p className="text-muted-foreground mt-1 text-xs">
                Switch technicians to compare each person&apos;s live openings.
              </p>
            ) : null}
          </div>

          {prefillConflict ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-200"
            >
              {prefillConflict}
            </p>
          ) : null}

          <div className="mt-5">
            <DayTimePicker
              selectedDate={appointmentDate}
              onSelectDate={(nextDate) => {
                setAppointmentDate(nextDate)
                setStartTime('')
                setPrefillConflict(null)
              }}
              selectedTime={startTime}
              onSelectTime={(time) => {
                setStartTime(time)
                setPrefillConflict(null)
              }}
              appointments={selectedDayAppointments}
              availableSlots={slots}
              requiredMinutes={120}
              serviceMinutes={60}
              bufferMinutes={60}
              loadingSlots={slotsLoading}
              useCustomTime={false}
              onToggleCustomTime={() => undefined}
              staffClosed={selectedStaffClosedForDay}
              staffUserId={staffId}
              allowConflictOverride={false}
              showCustomTime={false}
            />
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="commercial-lead-source">Lead source *</Label>
              <select
                id="commercial-lead-source"
                required
                className="border-input bg-background mt-1 h-10 w-full rounded-md border px-3 text-sm"
                value={leadSource}
                onChange={(event) => {
                  setLeadSource(event.target.value)
                  setLeadSourceDetail('')
                }}
              >
                <option value="">Select source</option>
                {leadSourceOptions.map((option) => (
                  <option key={option.key} value={option.value}>
                    {option.customer_label}
                  </option>
                ))}
              </select>
            </div>
            {selectedLeadSource?.requires_detail ? (
              <div>
                <Label htmlFor="commercial-lead-source-detail">
                  {selectedLeadSource.detail_label || 'Lead source details'} *
                </Label>
                <Input
                  id="commercial-lead-source-detail"
                  required
                  value={leadSourceDetail}
                  onChange={(event) => setLeadSourceDetail(event.target.value)}
                />
              </div>
            ) : null}
          </div>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" disabled={!canSubmit || saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Ruler className="mr-2 h-4 w-4" />
            )}
            {saving ? 'Scheduling…' : 'Schedule commercial estimate'}
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={() => router.push('/admin/operations')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
