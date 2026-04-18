'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────
interface ServiceItem {
  id: string
  name: string
  base_price: number
  category: string
  description: string | null
  pricing_unit: string | null
}

interface TimeSlot {
  start_time: string
  end_time: string
  label: string
}

interface CartItem {
  service: ServiceItem
  quantity: number
}

interface CustomerForm {
  first_name: string
  last_name: string
  email: string
  phone: string
  street_1: string
  city: string
  state: string
  zip_code: string
  notes: string
}

interface BookingResult {
  confirmation_number: string
  total: number
  discount_applied: number
  appointment_id: string
}

// ─────────────────────────────────────────────
//  Step indicator
// ─────────────────────────────────────────────
const STEPS = ['Services', 'Schedule', 'Your Info', 'Review']

function StepBar({ current }: { current: number }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-0">
      {STEPS.map((label, i) => {
        const stepNum = i + 1
        const done = current > stepNum
        const active = current === stepNum
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors ${
                  done
                    ? 'border-green-600 bg-green-600 text-white'
                    : active
                      ? 'border-green-600 bg-white text-green-600'
                      : 'border-gray-300 bg-white text-gray-400'
                }`}
              >
                {done ? (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  stepNum
                )}
              </div>
              <span
                className={`mt-1 hidden text-xs font-medium sm:block ${
                  active
                    ? 'text-green-700'
                    : done
                      ? 'text-green-500'
                      : 'text-gray-400'
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-1 h-0.5 w-10 transition-colors sm:w-16 ${
                  current > stepNum ? 'bg-green-600' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
const MIN_TOTAL = 150

function cartTotal(cart: CartItem[]): number {
  return cart.reduce((sum, ci) => sum + ci.service.base_price * ci.quantity, 0)
}

function formatPrice(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function formatDateDisplay(iso: string) {
  if (!iso) return ''
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

/** Returns YYYY-MM-DD for a Date in local time */
function toLocalISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const CATEGORY_ORDER = [
  'Carpet Cleaning',
  'Upholstery Cleaning',
  'Hard Surface',
  'rug cleaning',
  'Legendary Restoration Clean',
]

const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  'Carpet Cleaning': 'Standard Carpet Cleaning',
  'Upholstery Cleaning': 'Upholstery Cleaning',
  'Hard Surface': 'Hard Surface',
  'rug cleaning': 'Rug Cleaning',
  'Legendary Restoration Clean': 'Legendary Restoration Clean',
}

/** Group services by category, ordered by CATEGORY_ORDER */
function groupByCategory(items: ServiceItem[]): [string, ServiceItem[]][] {
  const map: Record<string, ServiceItem[]> = {}
  for (const item of items) {
    if (!map[item.category]) map[item.category] = []
    map[item.category].push(item)
  }
  const ordered: [string, ServiceItem[]][] = []
  for (const cat of CATEGORY_ORDER) {
    if (map[cat]) ordered.push([cat, map[cat]])
  }
  for (const cat of Object.keys(map)) {
    if (!CATEGORY_ORDER.includes(cat)) ordered.push([cat, map[cat]])
  }
  return ordered
}

// ─────────────────────────────────────────────
//  Mini calendar component
// ─────────────────────────────────────────────
function MiniCalendar({
  selected,
  onSelect,
}: {
  selected: string
  onSelect: (d: string) => void
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [viewMonth, setViewMonth] = useState<Date>(() => {
    if (selected) {
      const [y, m] = selected.split('-').map(Number)
      return new Date(y, m - 1, 1)
    }
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })

  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()

  const firstDay = new Date(year, month, 1).getDay() // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  function prevMonth() {
    setViewMonth(new Date(year, month - 1, 1))
  }
  function nextMonth() {
    setViewMonth(new Date(year, month + 1, 1))
  }

  const monthLabel = viewMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="select-none">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={prevMonth}
          className="rounded-lg p-1.5 transition-colors hover:bg-gray-100"
          aria-label="Previous month"
        >
          <svg
            className="h-4 w-4 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <span className="font-semibold text-gray-800">{monthLabel}</span>
        <button
          onClick={nextMonth}
          className="rounded-lg p-1.5 transition-colors hover:bg-gray-100"
          aria-label="Next month"
        >
          <svg
            className="h-4 w-4 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <div
            key={d}
            className="py-1 text-center text-xs font-semibold text-gray-400"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} />
          const cellDate = new Date(year, month, day)
          const iso = toLocalISO(cellDate)
          const isPast = cellDate < today
          const isSunday = cellDate.getDay() === 0
          const isSelected = iso === selected

          return (
            <button
              key={iso}
              disabled={isPast || isSunday}
              onClick={() => onSelect(iso)}
              className={`aspect-square w-full rounded-lg text-sm font-medium transition-all ${
                isSelected
                  ? 'bg-green-600 text-white'
                  : isPast || isSunday
                    ? 'cursor-not-allowed text-gray-300'
                    : 'text-gray-700 hover:bg-green-50 hover:text-green-700'
              }`}
            >
              {day}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-center text-xs text-gray-400">
        Sundays unavailable
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────
//  Section accordion row (for category groups)
// ─────────────────────────────────────────────
function CategorySection({
  category,
  items,
  cart,
  onAdd,
  onRemove,
}: {
  category: string
  items: ServiceItem[]
  cart: CartItem[]
  onAdd: (s: ServiceItem) => void
  onRemove: (s: ServiceItem) => void
}) {
  const [open, setOpen] = useState(true)

  function getQty(id: string) {
    return cart.find((c) => c.service.id === id)?.quantity ?? 0
  }

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-gray-200">
      <button
        className="flex w-full items-center justify-between bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-gray-100"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-sm font-semibold text-gray-800">{category}</span>
        <svg
          className={`h-4 w-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <div className="divide-y divide-gray-100">
          {items.map((item) => {
            const qty = getQty(item.id)
            return (
              <div
                key={item.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="min-w-0 flex-1 pr-4">
                  <p className="text-sm leading-tight font-medium text-gray-800">
                    {item.name}
                  </p>
                  {item.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs leading-tight text-gray-500">
                      {item.description}
                    </p>
                  )}
                  <p className="mt-1 text-sm font-semibold text-green-700">
                    {formatPrice(item.base_price)}
                    {item.pricing_unit && (
                      <span className="ml-1 text-xs font-normal text-gray-500">
                        /{item.pricing_unit}
                      </span>
                    )}
                  </p>
                </div>

                {qty === 0 ? (
                  <button
                    onClick={() => onAdd(item)}
                    className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-green-700"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    Add
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onRemove(item)}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 text-gray-600 transition-colors hover:border-red-400 hover:text-red-500"
                      aria-label="Remove one"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M20 12H4"
                        />
                      </svg>
                    </button>
                    <span className="w-5 text-center text-sm font-bold text-gray-800">
                      {qty}
                    </span>
                    <button
                      onClick={() => onAdd(item)}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-green-600 text-green-600 transition-colors hover:bg-green-600 hover:text-white"
                      aria-label="Add one more"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M12 4v16m8-8H4"
                        />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
//  Main page
// ─────────────────────────────────────────────
export default function BookPage() {
  const [step, setStep] = useState(1)

  // Services
  const [services, setServices] = useState<ServiceItem[]>([])
  const [servicesLoading, setServicesLoading] = useState(true)
  const [cart, setCart] = useState<CartItem[]>([])

  // Schedule
  const [selectedDate, setSelectedDate] = useState('')
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)

  // Customer form
  const [form, setForm] = useState<CustomerForm>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    street_1: '',
    city: '',
    state: 'CO',
    zip_code: '',
    notes: '',
  })

  // Review / submit
  const [promoCode, setPromoCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState<BookingResult | null>(null)

  // ── Load services on mount ──
  useEffect(() => {
    fetch('/api/public/services')
      .then((r) => r.json())
      .then((d) => setServices(d.services || []))
      .catch(console.error)
      .finally(() => setServicesLoading(false))
  }, [])

  // ── Fetch slots when date changes ──
  useEffect(() => {
    if (!selectedDate) return
    setSlotsLoading(true)
    setSelectedSlot(null)

    const totalMinutes = cart.reduce(
      (sum, ci) =>
        sum +
          (ci.service as ServiceItem & { duration_minutes?: number })
            .duration_minutes! *
            ci.quantity || 60 * ci.quantity,
      0,
    )

    fetch(
      `/api/public/availability?date=${selectedDate}&required_minutes=${Math.max(totalMinutes, 60)}`,
    )
      .then((r) => r.json())
      .then((d) => setSlots(d.slots || []))
      .catch(console.error)
      .finally(() => setSlotsLoading(false))
  }, [selectedDate, cart])

  // ── Cart helpers ──
  function addToCart(service: ServiceItem) {
    setCart((prev) => {
      const existing = prev.find((c) => c.service.id === service.id)
      if (existing)
        return prev.map((c) =>
          c.service.id === service.id ? { ...c, quantity: c.quantity + 1 } : c,
        )
      return [...prev, { service, quantity: 1 }]
    })
  }

  function removeFromCart(service: ServiceItem) {
    setCart((prev) => {
      const existing = prev.find((c) => c.service.id === service.id)
      if (!existing) return prev
      if (existing.quantity <= 1)
        return prev.filter((c) => c.service.id !== service.id)
      return prev.map((c) =>
        c.service.id === service.id ? { ...c, quantity: c.quantity - 1 } : c,
      )
    })
  }

  // ── Derived totals ──
  const subtotal = cartTotal(cart)
  const meetsMinimum = subtotal >= MIN_TOTAL
  const orderedGroups = useMemo(() => groupByCategory(services), [services])

  // ── Form helpers ──
  function setField<K extends keyof CustomerForm>(
    key: K,
    value: CustomerForm[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function validateStep3(): string {
    if (!form.first_name.trim() || !form.last_name.trim())
      return 'Please enter your full name.'
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email))
      return 'Please enter a valid email address.'
    if (!form.phone.trim() || form.phone.replace(/\D/g, '').length < 10)
      return 'Please enter a valid 10-digit phone number.'
    if (!form.street_1.trim()) return 'Please enter your service address.'
    if (!form.city.trim()) return 'Please enter your city.'
    if (!form.zip_code.trim() || !/^\d{5}/.test(form.zip_code))
      return 'Please enter a valid ZIP code.'
    return ''
  }

  // ── Submit ──
  async function handleSubmit() {
    setSubmitting(true)
    setSubmitError('')

    const lineItems = cart.map((ci) => ({
      service_catalog_item_id: ci.service.id,
      name_snapshot: ci.service.name,
      quantity: ci.quantity,
      unit_price: ci.service.base_price,
      duration_minutes: 60,
    }))

    const payload = {
      customer: {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        notes: form.notes.trim() || null,
      },
      address: {
        street_1: form.street_1.trim(),
        city: form.city.trim(),
        state: form.state,
        zip_code: form.zip_code.trim(),
      },
      appointment: {
        appointment_date: selectedDate,
        start_time: selectedSlot!.start_time,
      },
      line_items: lineItems,
      promo_code: promoCode.trim() || undefined,
    }

    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(
          data.error || 'Something went wrong. Please call (719) 249-8791.',
        )
      } else {
        setResult(data)
        setStep(5)
      }
    } catch {
      setSubmitError('Network error. Please call (719) 249-8791.')
    } finally {
      setSubmitting(false)
    }
  }

  // ──────────────────────────────────────────────
  //  Render
  // ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-100 bg-white shadow-sm">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <Image
            src="/sasquatch-logo.svg"
            alt="Sasquatch Carpet Cleaning"
            width={40}
            height={40}
            className="rounded-full"
          />
          <div>
            <p className="text-sm leading-tight font-bold text-gray-900">
              Sasquatch Carpet Cleaning
            </p>
            <p className="text-xs text-gray-500">
              Colorado Springs, CO · (719) 249-8791
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-8">
        {/* Success screen */}
        {step === 5 && result && (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
              <svg
                className="h-10 w-10 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="mb-2 text-2xl font-bold text-gray-900">
              You&apos;re all set!
            </h1>
            <p className="mb-8 text-gray-500">
              Your appointment is confirmed. Check your email for details.
            </p>

            <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 text-left shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                  Confirmation
                </span>
                <span className="font-mono text-sm font-bold text-green-700">
                  {result.confirmation_number}
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Date</span>
                  <span className="font-medium">
                    {formatDateDisplay(selectedDate)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Time</span>
                  <span className="font-medium">{selectedSlot?.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Address</span>
                  <span className="max-w-[60%] text-right font-medium">
                    {form.street_1}, {form.city}, {form.state} {form.zip_code}
                  </span>
                </div>
                {result.discount_applied > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span>Discount</span>
                    <span className="font-medium">
                      -{formatPrice(result.discount_applied)}
                    </span>
                  </div>
                )}
                <div className="mt-2 flex justify-between border-t border-gray-100 pt-2">
                  <span className="font-semibold text-gray-900">Total</span>
                  <span className="font-bold text-green-700">
                    {formatPrice(result.total)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mb-6 rounded-xl bg-green-50 p-4 text-left text-sm text-green-800">
              <p className="mb-1 font-semibold">What happens next?</p>
              <ul className="list-inside list-disc space-y-1 text-green-700">
                <li>A confirmation email is on its way</li>
                <li>Harry will text you a reminder the day before</li>
                <li>Need to make changes? Text Harry at (719) 358-6137</li>
              </ul>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="w-full rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              Book another appointment
            </button>
          </div>
        )}

        {/* Booking steps */}
        {step < 5 && (
          <>
            <StepBar current={step} />

            {/* ── STEP 1: Select Services ── */}
            {step === 1 && (
              <div>
                <h1 className="mb-1 text-xl font-bold text-gray-900">
                  Select Services
                </h1>
                <p className="mb-6 text-sm text-gray-500">
                  Choose the services you need. Minimum booking is{' '}
                  {formatPrice(MIN_TOTAL)}.
                </p>

                {servicesLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-24 animate-pulse rounded-xl bg-gray-100"
                      />
                    ))}
                  </div>
                ) : (
                  orderedGroups.map(([category, items]) => (
                    <CategorySection
                      key={category}
                      category={CATEGORY_DISPLAY_NAMES[category] || category}
                      items={items}
                      cart={cart}
                      onAdd={addToCart}
                      onRemove={removeFromCart}
                    />
                  ))
                )}

                {/* Sticky cart bar */}
                {cart.length > 0 && (
                  <div className="fixed right-0 bottom-0 left-0 z-20 border-t border-gray-200 bg-white px-4 py-2 shadow-lg">
                    <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="text-xs leading-tight text-gray-500">
                            {cart.reduce((s, c) => s + c.quantity, 0)} service
                            {cart.reduce((s, c) => s + c.quantity, 0) !== 1
                              ? 's'
                              : ''}
                          </p>
                          <p className="text-sm leading-tight font-bold text-gray-900">
                            {formatPrice(subtotal)}
                          </p>
                        </div>
                        {!meetsMinimum && (
                          <p className="text-xs leading-tight text-red-500">
                            {formatPrice(MIN_TOTAL - subtotal)} more
                          </p>
                        )}
                      </div>
                      <button
                        disabled={!meetsMinimum}
                        onClick={() => setStep(2)}
                        className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold whitespace-nowrap text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Select Date →
                      </button>
                    </div>
                  </div>
                )}
                {/* Bottom padding to clear sticky bar */}
                <div className="h-16" />
              </div>
            )}

            {/* ── STEP 2: Schedule ── */}
            {step === 2 && (
              <div>
                <h1 className="mb-1 text-xl font-bold text-gray-900">
                  Pick a Date & Time
                </h1>
                <p className="mb-6 text-sm text-gray-500">
                  Select a date, then choose from available time windows.
                </p>

                <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <MiniCalendar
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                  />
                </div>

                {selectedDate && (
                  <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <p className="mb-3 text-sm font-semibold text-gray-700">
                      Available windows for {formatDateDisplay(selectedDate)}
                    </p>

                    {slotsLoading ? (
                      <div className="grid grid-cols-2 gap-2">
                        {[1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className="h-10 animate-pulse rounded-lg bg-gray-100"
                          />
                        ))}
                      </div>
                    ) : slots.length === 0 ? (
                      <p className="py-4 text-center text-sm text-gray-500">
                        No availability on this date. Please try another day.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {slots.map((slot) => (
                          <button
                            key={slot.start_time}
                            onClick={() => setSelectedSlot(slot)}
                            className={`rounded-xl border py-2.5 text-sm font-medium transition-all ${
                              selectedSlot?.start_time === slot.start_time
                                ? 'border-green-600 bg-green-600 text-white'
                                : 'border-gray-200 text-gray-700 hover:border-green-400 hover:text-green-700'
                            }`}
                          >
                            {slot.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep(1)}
                    className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    ← Back
                  </button>
                  <button
                    disabled={!selectedDate || !selectedSlot}
                    onClick={() => setStep(3)}
                    className="flex-1 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Continue →
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 3: Customer Info ── */}
            {step === 3 && (
              <div>
                <h1 className="mb-1 text-xl font-bold text-gray-900">
                  Your Information
                </h1>
                <p className="mb-6 text-sm text-gray-500">
                  We&apos;ll send a confirmation to your email and text
                  reminders to your phone.
                </p>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                        First Name *
                      </label>
                      <input
                        type="text"
                        autoComplete="given-name"
                        value={form.first_name}
                        onChange={(e) => setField('first_name', e.target.value)}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-200 focus:outline-none"
                        placeholder="John"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                        Last Name *
                      </label>
                      <input
                        type="text"
                        autoComplete="family-name"
                        value={form.last_name}
                        onChange={(e) => setField('last_name', e.target.value)}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-200 focus:outline-none"
                        placeholder="Smith"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                      Email Address *
                    </label>
                    <input
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(e) => setField('email', e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-200 focus:outline-none"
                      placeholder="john@example.com"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                      Phone Number *
                    </label>
                    <input
                      type="tel"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={(e) => setField('phone', e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-200 focus:outline-none"
                      placeholder="(719) 555-0123"
                    />
                  </div>

                  <div className="border-t border-gray-100 pt-4">
                    <p className="mb-3 text-xs font-semibold text-gray-600">
                      Service Address
                    </p>
                    <div className="space-y-3">
                      <input
                        type="text"
                        autoComplete="street-address"
                        value={form.street_1}
                        onChange={(e) => setField('street_1', e.target.value)}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-200 focus:outline-none"
                        placeholder="Street address *"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          type="text"
                          autoComplete="address-level2"
                          value={form.city}
                          onChange={(e) => setField('city', e.target.value)}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-200 focus:outline-none"
                          placeholder="City *"
                        />
                        <div className="flex gap-2">
                          <select
                            value={form.state}
                            onChange={(e) => setField('state', e.target.value)}
                            className="w-16 rounded-xl border border-gray-200 bg-white px-2 py-2.5 text-sm focus:border-green-500 focus:outline-none"
                          >
                            {[
                              'CO',
                              'WY',
                              'NM',
                              'UT',
                              'KS',
                              'NE',
                              'OK',
                              'TX',
                            ].map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            autoComplete="postal-code"
                            value={form.zip_code}
                            onChange={(e) =>
                              setField('zip_code', e.target.value)
                            }
                            className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-200 focus:outline-none"
                            placeholder="ZIP *"
                            maxLength={5}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                      Special Notes{' '}
                      <span className="font-normal text-gray-400">
                        (optional)
                      </span>
                    </label>
                    <textarea
                      value={form.notes}
                      onChange={(e) => setField('notes', e.target.value)}
                      rows={3}
                      className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-200 focus:outline-none"
                      placeholder="Gate codes, pet info, parking instructions, areas of concern…"
                    />
                  </div>
                </div>

                <div className="mt-6 flex gap-3">
                  <button
                    onClick={() => setStep(2)}
                    className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() => {
                      const err = validateStep3()
                      if (err) {
                        setSubmitError(err)
                        return
                      }
                      setSubmitError('')
                      setStep(4)
                    }}
                    className="flex-1 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700"
                  >
                    Review →
                  </button>
                </div>
                {submitError && (
                  <p className="mt-3 text-center text-sm text-red-600">
                    {submitError}
                  </p>
                )}
              </div>
            )}

            {/* ── STEP 4: Review & Submit ── */}
            {step === 4 && (
              <div>
                <h1 className="mb-1 text-xl font-bold text-gray-900">
                  Review & Confirm
                </h1>
                <p className="mb-6 text-sm text-gray-500">
                  Double-check everything before we lock in your appointment.
                </p>

                {/* Order summary */}
                <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <p className="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    Services
                  </p>
                  <div className="space-y-2">
                    {cart.map((ci) => (
                      <div
                        key={ci.service.id}
                        className="flex justify-between text-sm"
                      >
                        <span className="text-gray-700">
                          {ci.service.name}
                          {ci.quantity > 1 && (
                            <span className="ml-1 text-gray-400">
                              × {ci.quantity}
                            </span>
                          )}
                        </span>
                        <span className="font-medium text-gray-900">
                          {formatPrice(ci.service.base_price * ci.quantity)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-between border-t border-gray-100 pt-3 text-sm font-bold">
                    <span>Subtotal</span>
                    <span className="text-green-700">
                      {formatPrice(subtotal)}
                    </span>
                  </div>
                </div>

                {/* Appointment details */}
                <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <p className="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    Appointment
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Date</span>
                      <span className="font-medium">
                        {formatDateDisplay(selectedDate)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Arrival window</span>
                      <span className="font-medium">{selectedSlot?.label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Address</span>
                      <span className="max-w-[60%] text-right font-medium">
                        {form.street_1}, {form.city}, {form.state}{' '}
                        {form.zip_code}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Customer */}
                <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <p className="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    Contact
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Name</span>
                      <span className="font-medium">
                        {form.first_name} {form.last_name}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Email</span>
                      <span className="font-medium">{form.email}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Phone</span>
                      <span className="font-medium">{form.phone}</span>
                    </div>
                    {form.notes && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Notes</span>
                        <span className="max-w-[60%] text-right font-medium">
                          {form.notes}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Promo code */}
                <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <p className="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    Promo Code
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={promoCode}
                      onChange={(e) =>
                        setPromoCode(e.target.value.toUpperCase())
                      }
                      className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-sm uppercase focus:border-green-500 focus:ring-1 focus:ring-green-200 focus:outline-none"
                      placeholder="ENTER CODE"
                    />
                  </div>
                  <p className="mt-2 text-xs text-gray-400">
                    Discount will be applied at checkout if the code is valid.
                  </p>
                </div>

                {/* Payment notice */}
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <svg
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <p className="text-xs leading-relaxed text-amber-800">
                    Payment is collected on the day of service. We accept cash,
                    card, Venmo, or CashApp. No payment is required to confirm
                    your booking.
                  </p>
                </div>

                {submitError && (
                  <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-center text-sm text-red-600">
                    {submitError}
                  </p>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep(3)}
                    disabled={submitting}
                    className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-bold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <svg
                          className="h-4 w-4 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        Booking…
                      </>
                    ) : (
                      'Confirm Booking'
                    )}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
