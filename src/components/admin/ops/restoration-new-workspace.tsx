'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Droplets } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * Start a water loss.
 *
 * Deliberately short: on a flood call there is no estimate to give, only an
 * emergency service fee. Everything that drives pricing is captured here
 * because it decides which Xactimate variant every later line item resolves to.
 */

type CustomerAddress = {
  id: string
  label: string | null
  street_1: string
  street_2: string | null
  city: string
  state: string
  zip_code: string
}

type CustomerSearchResult = {
  id: string
  full_name: string
  business_name: string | null
  phone: string
  ops_service_addresses: CustomerAddress[]
}

/**
 * Selecting a source pre-selects the category, because remembering that
 * groundwater is Category 3 at 2 a.m. is exactly the thing that gets missed.
 * Every one stays overridable.
 */
const SOURCES: Array<{ value: string; label: string; category: 1 | 2 | 3 }> = [
  { value: 'supply_line', label: 'Supply line', category: 1 },
  { value: 'water_heater', label: 'Water heater', category: 1 },
  { value: 'toilet_supply', label: 'Toilet supply line', category: 1 },
  { value: 'sprinkler', label: 'Fire sprinkler', category: 1 },
  { value: 'hvac_condensate', label: 'HVAC condensate', category: 2 },
  { value: 'dishwasher', label: 'Dishwasher', category: 2 },
  { value: 'washing_machine', label: 'Washing machine', category: 2 },
  { value: 'toilet_overflow', label: 'Toilet overflow (no solids)', category: 2 },
  { value: 'roof', label: 'Roof / rain intrusion', category: 2 },
  { value: 'sewage_backup', label: 'Sewage backup', category: 3 },
  { value: 'exterior_groundwater', label: 'Exterior / groundwater', category: 3 },
  { value: 'other', label: 'Other', category: 1 },
]

const CATEGORY_HELP: Record<number, string> = {
  1: 'Clean water from a sanitary source.',
  2: 'Grey water — appliance discharge, or Cat 1 left past about 48 hours.',
  3: 'Grossly contaminated — sewage, groundwater, or long dwell time.',
}

function isAfterHours(date: Date): boolean {
  const hour = date.getHours()
  const day = date.getDay()
  return day === 0 || day === 6 || hour < 8 || hour >= 17
}

export function RestorationNewWorkspace() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [customer, setCustomer] = useState<CustomerSearchResult | null>(null)
  const [addressId, setAddressId] = useState('')

  // Most flood calls are somebody who has never used us before.
  const [isNewCustomer, setIsNewCustomer] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newStreet, setNewStreet] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newState, setNewState] = useState('CO')
  const [newZip, setNewZip] = useState('')

  const [sourceOfLoss, setSourceOfLoss] = useState('supply_line')
  const [waterCategory, setWaterCategory] = useState<1 | 2 | 3>(1)
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [lossDate, setLossDate] = useState('')
  const [standingWater, setStandingWater] = useState(false)
  const [afterHours, setAfterHours] = useState(() => isAfterHours(new Date()))
  const [narrative, setNarrative] = useState('')

  const [appointmentDate, setAppointmentDate] = useState(
    searchParams.get('date') || new Date().toISOString().slice(0, 10),
  )
  const [startTime, setStartTime] = useState(searchParams.get('time') || '09:00')
  const [durationMinutes, setDurationMinutes] = useState(240)
  const [monitorVisits, setMonitorVisits] = useState(3)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (customerQuery.trim().length < 2) {
      setCustomerResults([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const response = await fetch(
          `/api/admin/ops/customers?q=${encodeURIComponent(customerQuery)}`,
          { cache: 'no-store' },
        )
        const result = await response.json()
        if (!cancelled && response.ok) setCustomerResults(result.customers || [])
      } catch {
        // A failed lookup should not block the form; the field stays usable.
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [customerQuery])

  const emergencyFee = afterHours ? 295.92 : 197.29

  const selectedAddress = useMemo(
    () => customer?.ops_service_addresses.find((a) => a.id === addressId) ?? null,
    [customer, addressId],
  )

  function chooseSource(value: string) {
    setSourceOfLoss(value)
    const match = SOURCES.find((s) => s.value === value)
    // Only steer the category while the user has not set it themselves.
    if (match && !categoryTouched) setWaterCategory(match.category)
  }

  async function handleCreate() {
    if (isNewCustomer) {
      if (!newName.trim() || !newPhone.trim()) {
        setError('A name and phone number are needed to open the job.')
        return
      }
      if (!newStreet.trim() || !newCity.trim()) {
        setError('A street and city are needed so the crew can get there.')
        return
      }
    } else if (!customer || !addressId) {
      setError('Pick a customer and a service address first.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/ops/restoration/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isNewCustomer
            ? {
                customer: {
                  full_name: newName.trim(),
                  phone: newPhone.trim(),
                  email: newEmail.trim() || null,
                },
                address: {
                  street_1: newStreet.trim(),
                  city: newCity.trim(),
                  state: newState.trim() || 'CO',
                  zip_code: newZip.trim() || null,
                },
              }
            : { customer_id: customer!.id, service_address_id: addressId }),
          water_category: waterCategory,
          source_of_loss: sourceOfLoss,
          loss_date: lossDate || null,
          standing_water: standingWater,
          after_hours_call: afterHours,
          cause_narrative: narrative || null,
          appointment_date: appointmentDate,
          start_time: startTime,
          duration_minutes: durationMinutes,
          monitor_visits: monitorVisits,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to start the project')
      router.push(`/admin/operations/restoration/${result.project_id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start the project')
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-24">
      <div className="flex items-center gap-3">
        <Droplets className="h-6 w-6 text-sky-600" />
        <div>
          <h1 className="text-2xl font-semibold">Start a water loss</h1>
          <p className="text-muted-foreground text-sm">
            No estimate over the phone — only the emergency service fee. Pricing happens on site.
          </p>
        </div>
      </div>

      <Card className="border-border/60 bg-card/80 p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Customer</h2>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={isNewCustomer ? 'outline' : 'default'}
              onClick={() => setIsNewCustomer(false)}
            >
              Existing
            </Button>
            <Button
              type="button"
              size="sm"
              variant={isNewCustomer ? 'default' : 'outline'}
              onClick={() => {
                setIsNewCustomer(true)
                setCustomer(null)
                setAddressId('')
              }}
            >
              New
            </Button>
          </div>
        </div>

        {isNewCustomer ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-name">Name</Label>
                <Input
                  id="new-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Jill Andersen"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-phone">Phone</Label>
                <Input
                  id="new-phone"
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="(719) 555-0134"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-email">
                Email <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="new-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-street">Service address</Label>
              <Input
                id="new-street"
                value={newStreet}
                onChange={(e) => setNewStreet(e.target.value)}
                placeholder="742 Spruce Rd"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-city">City</Label>
                <Input
                  id="new-city"
                  value={newCity}
                  onChange={(e) => setNewCity(e.target.value)}
                  placeholder="Monument"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-state">State</Label>
                <Input
                  id="new-state"
                  value={newState}
                  onChange={(e) => setNewState(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-zip">ZIP</Label>
                <Input
                  id="new-zip"
                  value={newZip}
                  onChange={(e) => setNewZip(e.target.value)}
                  placeholder="80132"
                />
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              If this number is already on file the existing customer is reused, so a
              repeat caller does not become a duplicate.
            </p>
          </div>
        ) : customer ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{customer.business_name || customer.full_name}</p>
              <p className="text-muted-foreground text-sm">{customer.phone}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCustomer(null)
                setAddressId('')
              }}
            >
              Change
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="loss-customer">Find customer</Label>
            <Input
              id="loss-customer"
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              placeholder="Name, phone, or address"
              autoComplete="off"
            />
            {searching ? (
              <p className="text-muted-foreground text-sm">Searching…</p>
            ) : null}
            <div className="flex flex-col gap-1">
              {customerResults.slice(0, 8).map((result) => (
                <button
                  key={result.id}
                  type="button"
                  className="hover:bg-muted/60 rounded-md border border-transparent px-3 py-2 text-left text-sm"
                  onClick={() => {
                    setCustomer(result)
                    const first = result.ops_service_addresses[0]
                    if (first) setAddressId(first.id)
                    setCustomerResults([])
                    setCustomerQuery('')
                  }}
                >
                  <span className="font-medium">
                    {result.business_name || result.full_name}
                  </span>
                  <span className="text-muted-foreground"> · {result.phone}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!isNewCustomer && customer && customer.ops_service_addresses.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2">
            <Label htmlFor="loss-address">Service address</Label>
            <select
              id="loss-address"
              className="border-input bg-background h-10 rounded-md border px-3 text-sm"
              value={addressId}
              onChange={(e) => setAddressId(e.target.value)}
            >
              {customer.ops_service_addresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {address.street_1}, {address.city} {address.zip_code}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </Card>

      <Card className="border-border/60 bg-card/80 p-5">
        <h2 className="mb-3 text-lg font-semibold">The loss</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="loss-source">Source of loss</Label>
            <select
              id="loss-source"
              className="border-input bg-background h-10 rounded-md border px-3 text-sm"
              value={sourceOfLoss}
              onChange={(e) => chooseSource(e.target.value)}
            >
              {SOURCES.map((source) => (
                <option key={source.value} value={source.value}>
                  {source.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="loss-date">Date of loss</Label>
            <Input
              id="loss-date"
              type="date"
              value={lossDate}
              onChange={(e) => setLossDate(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <Label>Water category</Label>
          <div className="flex gap-2">
            {([1, 2, 3] as const).map((category) => (
              <Button
                key={category}
                type="button"
                variant={waterCategory === category ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => {
                  setWaterCategory(category)
                  setCategoryTouched(true)
                }}
              >
                Cat {category}
              </Button>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">{CATEGORY_HELP[waterCategory]}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={standingWater}
              onChange={(e) => setStandingWater(e.target.checked)}
            />
            Standing water on site
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={afterHours}
              onChange={(e) => setAfterHours(e.target.checked)}
            />
            After-hours call
          </label>
        </div>

        <p className="text-muted-foreground mt-3 text-sm">
          Emergency service fee:{' '}
          <span className="text-foreground font-semibold">${emergencyFee.toFixed(2)}</span>{' '}
          ({afterHours ? 'after hours' : 'business hours'})
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <Label htmlFor="loss-narrative">What happened</Label>
          <Textarea
            id="loss-narrative"
            rows={3}
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            placeholder="Water came in through a basement window, sat about four days, carried mud with it."
          />
        </div>
      </Card>

      <Card className="border-border/60 bg-card/80 p-5">
        <h2 className="mb-3 text-lg font-semibold">Mitigation day</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="loss-appt-date">Date</Label>
            <Input
              id="loss-appt-date"
              type="date"
              value={appointmentDate}
              onChange={(e) => setAppointmentDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="loss-appt-time">Start</Label>
            <Input
              id="loss-appt-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="loss-duration">Hours on site</Label>
            <Input
              id="loss-duration"
              type="number"
              min={1}
              max={12}
              value={durationMinutes / 60}
              onChange={(e) =>
                setDurationMinutes(Math.max(60, Number(e.target.value) * 60 || 240))
              }
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <Label htmlFor="loss-monitors">Monitor visits to queue</Label>
          <Input
            id="loss-monitors"
            type="number"
            min={0}
            max={6}
            value={monitorVisits}
            onChange={(e) => setMonitorVisits(Math.max(0, Math.min(6, Number(e.target.value))))}
          />
          <p className="text-muted-foreground text-xs">
            These are not put on the calendar. They wait in the tray so you can fit them
            around cleaning jobs.
          </p>
        </div>
      </Card>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          size="lg"
          disabled={
            saving ||
            (isNewCustomer
              ? !newName.trim() || !newPhone.trim() || !newStreet.trim()
              : !customer || !addressId)
          }
          onClick={() => void handleCreate()}
          className="gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Droplets className="h-4 w-4" />}
          Start mitigation
        </Button>
        {selectedAddress ? (
          <span className="text-muted-foreground text-sm">
            {selectedAddress.street_1}, {selectedAddress.city}
          </span>
        ) : null}
      </div>
    </div>
  )
}
