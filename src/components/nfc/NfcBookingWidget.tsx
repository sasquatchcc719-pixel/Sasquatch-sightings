'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServiceItem {
  id: string
  slug?: string
  name: string
  base_price: number
  category: string
  description: string | null
  pricing_unit: string | null
  duration_minutes?: number
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

export interface NfcBookingWidgetProps {
  couponCode: string
  cardId: string | null
  onTrackClick: (buttonType: string) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MIN_TOTAL = 150
const STEPS = ['Services', 'Schedule', 'Your Info', 'Review']

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

function cartTotal(cart: CartItem[]) {
  return cart.reduce((sum, ci) => sum + ci.service.base_price * ci.quantity, 0)
}

function formatPrice(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function formatPricingUnit(unit: string | null) {
  if (!unit || unit === 'fixed') return ''
  const normalized = unit.replace(/_/g, ' ')
  return normalized.startsWith('per ') ? normalized : `per ${normalized}`
}

function isLeatherService(item: ServiceItem) {
  return (
    item.slug?.includes('leather') ||
    item.name.toLowerCase().includes('leather')
  )
}

function needsDirectInput(unit: string | null) {
  if (!unit) return false
  const normalized = unit.toLowerCase().replace(/_/g, ' ')
  return (
    normalized.includes('sqft') ||
    normalized.includes('square') ||
    normalized.includes('linear')
  )
}

function toLocalISO(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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

// ─── Input / select style shortcuts ──────────────────────────────────────────

const inputCls =
  'w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-white placeholder-white/40 focus:border-green-400 focus:ring-1 focus:ring-green-400/40 focus:outline-none'

const labelCls = 'mb-1.5 block text-xs font-semibold text-white/70'

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div className="mb-6 flex items-center justify-center gap-0">
      {STEPS.map((label, i) => {
        const stepNum = i + 1
        const done = current > stepNum
        const active = current === stepNum
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${
                  done
                    ? 'border-green-500 bg-green-500 text-white'
                    : active
                      ? 'border-green-400 bg-white/10 text-green-300'
                      : 'border-white/20 bg-white/5 text-white/30'
                }`}
              >
                {done ? (
                  <svg
                    className="h-3.5 w-3.5"
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
                className={`mt-1 hidden text-[10px] font-medium sm:block ${active ? 'text-green-300' : done ? 'text-green-500' : 'text-white/30'}`}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-1 h-0.5 w-8 transition-colors sm:w-12 ${current > stepNum ? 'bg-green-500' : 'bg-white/15'}`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Category accordion ───────────────────────────────────────────────────────

function CategorySection({
  category,
  items,
  cart,
  onAdd,
  onRemove,
  onSetQuantity,
}: {
  category: string
  items: ServiceItem[]
  cart: CartItem[]
  onAdd: (s: ServiceItem) => void
  onRemove: (s: ServiceItem) => void
  onSetQuantity: (s: ServiceItem, qty: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [leatherOpen, setLeatherOpen] = useState(false)

  function getQty(id: string) {
    return cart.find((c) => c.service.id === id)?.quantity ?? 0
  }

  const isUpholstery = category === 'Upholstery Cleaning'
  const regularItems = isUpholstery
    ? items.filter((item) => !isLeatherService(item))
    : items
  const leatherItems = isUpholstery ? items.filter(isLeatherService) : []

  function renderServiceItem(item: ServiceItem) {
    const qty = getQty(item.id)
    const unit = formatPricingUnit(item.pricing_unit)

    return (
      <div
        key={item.id}
        className="flex items-center justify-between px-4 py-3"
      >
        <div className="min-w-0 flex-1 pr-4">
          <p className="text-sm leading-tight font-medium text-white">
            {item.name}
          </p>
          {item.description && (
            <p className="mt-0.5 line-clamp-2 text-xs leading-tight text-white/50">
              {item.description}
            </p>
          )}
          <p className="mt-1 text-sm font-semibold text-green-400">
            {formatPrice(item.base_price)}
            {unit && (
              <span className="ml-1 text-xs font-normal text-white/40">
                /{unit}
              </span>
            )}
          </p>
        </div>

        {qty === 0 ? (
          <button
            type="button"
            onClick={() => onAdd(item)}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-green-500"
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
              type="button"
              onClick={() => onRemove(item)}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 text-white/60 transition-colors hover:border-red-400 hover:text-red-400"
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
            {needsDirectInput(item.pricing_unit) ? (
              <input
                type="number"
                inputMode="numeric"
                min="1"
                value={qty}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val) && val > 0) {
                    onSetQuantity(item, val)
                  }
                }}
                onBlur={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (isNaN(val) || val < 1) {
                    onSetQuantity(item, 1)
                  }
                }}
                className="w-16 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-center text-sm font-bold text-white focus:border-green-400 focus:ring-1 focus:ring-green-400/40 focus:outline-none"
              />
            ) : (
              <span className="w-5 text-center text-sm font-bold text-white">
                {qty}
              </span>
            )}
            <button
              type="button"
              onClick={() => onAdd(item)}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-green-500 text-green-400 transition-colors hover:bg-green-600 hover:text-white"
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
  }

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-white/10">
      <button
        type="button"
        className="flex w-full items-center justify-between bg-white/5 px-4 py-3 text-left transition-colors hover:bg-white/10"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-sm font-semibold text-white">{category}</span>
        <svg
          className={`h-4 w-4 text-white/50 transition-transform ${open ? 'rotate-180' : ''}`}
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
        <div className="divide-y divide-white/5">
          {regularItems.map(renderServiceItem)}
          {leatherItems.length > 0 && (
            <div className="bg-white/[0.03]">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/5"
                onClick={() => setLeatherOpen((value) => !value)}
              >
                <div>
                  <span className="text-sm font-semibold text-white">
                    Leather Furniture Cleaning
                  </span>
                  <p className="mt-0.5 text-xs text-white/45">
                    Chairs, loveseats, sofas, and sectionals
                  </p>
                </div>
                <svg
                  className={`h-4 w-4 text-white/50 transition-transform ${leatherOpen ? 'rotate-180' : ''}`}
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
              {leatherOpen && (
                <div className="divide-y divide-white/5 border-t border-white/5">
                  {leatherItems.map(renderServiceItem)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Mini calendar ────────────────────────────────────────────────────────────

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
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const monthLabel = viewMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="select-none">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewMonth(new Date(year, month - 1, 1))}
          className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg
            className="h-4 w-4"
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
        <span className="text-sm font-semibold text-white">{monthLabel}</span>
        <button
          type="button"
          onClick={() => setViewMonth(new Date(year, month + 1, 1))}
          className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg
            className="h-4 w-4"
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
            className="py-1 text-center text-[10px] font-semibold text-white/30"
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
              type="button"
              disabled={isPast || isSunday}
              onClick={() => onSelect(iso)}
              className={`aspect-square w-full rounded-lg text-xs font-medium transition-all ${
                isSelected
                  ? 'bg-green-600 text-white'
                  : isPast || isSunday
                    ? 'cursor-not-allowed text-white/15'
                    : 'text-white/80 hover:bg-green-600/30 hover:text-green-300'
              }`}
            >
              {day}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-center text-[10px] text-white/30">
        Sundays unavailable
      </p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NfcBookingWidget({
  couponCode,
  cardId,
  onTrackClick,
}: NfcBookingWidgetProps) {
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

  // Customer info
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

  // Submit
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState<BookingResult | null>(null)

  /** Line-item math on review (matches POST /api/public/appointments). */
  const [reviewPromo, setReviewPromo] = useState<{
    discountAmount: number
    total: number
  } | null>(null)

  // Portal target for the mobile subtotal bar. The widget card uses
  // backdrop-blur, which makes `position: fixed` children stick to the card
  // instead of the phone viewport — rendering into `body` fixes that.
  const [mobileSubtotalHost, setMobileSubtotalHost] =
    useState<HTMLElement | null>(null)
  useEffect(() => {
    setMobileSubtotalHost(document.body)
  }, [])

  // Load services on mount
  useEffect(() => {
    fetch('/api/public/services')
      .then((r) => r.json())
      .then((d) => setServices(d.services || []))
      .catch(console.error)
      .finally(() => setServicesLoading(false))
  }, [])

  // Fetch slots when date changes
  useEffect(() => {
    if (!selectedDate) return
    setSlotsLoading(true)
    setSelectedSlot(null)

    // Calculate duration based on dollar amount (simple tier system)
    // $0-300 = 2hr, $301-600 = 3hr, $601+ = 4hr
    const totalDollars = cartTotal(cart)
    let requiredMinutes = 120 // 2 hours default
    if (totalDollars > 600) {
      requiredMinutes = 240 // 4 hours
    } else if (totalDollars > 300) {
      requiredMinutes = 180 // 3 hours
    }

    fetch(
      `/api/public/availability?date=${selectedDate}&required_minutes=${requiredMinutes}`,
    )
      .then((r) => r.json())
      .then((d) => setSlots(d.slots || []))
      .catch(console.error)
      .finally(() => setSlotsLoading(false))
  }, [selectedDate, cart])

  // Cart helpers
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

  function setCartQuantity(service: ServiceItem, quantity: number) {
    setCart((prev) => {
      if (quantity <= 0) {
        return prev.filter((c) => c.service.id !== service.id)
      }
      const existing = prev.find((c) => c.service.id === service.id)
      if (existing) {
        return prev.map((c) =>
          c.service.id === service.id ? { ...c, quantity } : c,
        )
      }
      return [...prev, { service, quantity }]
    })
  }

  function setField<K extends keyof CustomerForm>(
    key: K,
    value: CustomerForm[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const subtotal = cartTotal(cart)
  const meetsMinimum = subtotal >= MIN_TOTAL
  const orderedGroups = useMemo(() => groupByCategory(services), [services])

  useEffect(() => {
    if (step !== 4) {
      setReviewPromo(null)
      return
    }
    if (!couponCode.trim()) {
      setReviewPromo({ discountAmount: 0, total: subtotal })
      return
    }
    setReviewPromo(null)
    const ac = new AbortController()
    const u = new URL('/api/public/promo-preview', window.location.origin)
    u.searchParams.set('code', couponCode.trim().toUpperCase())
    u.searchParams.set('subtotal', String(subtotal))
    void fetch(u.toString(), { signal: ac.signal })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (ok && typeof j.total === 'number' && j.discount_amount != null) {
          setReviewPromo({
            discountAmount: Number(j.discount_amount) || 0,
            total: Number(j.total) || subtotal,
          })
        } else {
          setReviewPromo({ discountAmount: 0, total: subtotal })
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          setReviewPromo({ discountAmount: 0, total: subtotal })
        }
      })
    return () => ac.abort()
  }, [step, couponCode, subtotal])

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

  async function handleSubmit() {
    setSubmitting(true)
    setSubmitError('')

    const lineItems = cart.map((ci) => ({
      service_catalog_item_id: ci.service.id,
      name_snapshot: ci.service.name,
      quantity: ci.quantity,
      unit_price: ci.service.base_price,
      duration_minutes: ci.service.duration_minutes ?? 60,
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
        lead_source: cardId ? `NFC Card - ${cardId}` : 'NFC Card',
      },
      line_items: lineItems,
      promo_code: couponCode || undefined,
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
        onTrackClick('booking_widget_submit')
      }
    } catch {
      setSubmitError('Network error. Please call (719) 249-8791.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (step === 5 && result) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/60 p-6 text-center backdrop-blur-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
          <svg
            className="h-8 w-8 text-green-400"
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
        <h3 className="mb-1 text-xl font-bold text-white">
          You&apos;re booked!
        </h3>
        <p className="mb-6 text-sm text-white/60">
          Check your phone — Harry will text you a reminder the day before.
        </p>

        <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4 text-left">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-white/40 uppercase">
              Confirmation
            </span>
            <span className="font-mono text-sm font-bold text-green-400">
              {result.confirmation_number}
            </span>
          </div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-white/50">Date</span>
              <span className="font-medium text-white">
                {formatDateDisplay(selectedDate)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Time</span>
              <span className="font-medium text-white">
                {selectedSlot?.label}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Address</span>
              <span className="max-w-[60%] text-right font-medium text-white">
                {form.street_1}, {form.city}
              </span>
            </div>
            {result.discount_applied > 0 && (
              <div className="flex justify-between text-green-400">
                <span>Discount ({couponCode})</span>
                <span className="font-medium">
                  -{formatPrice(result.discount_applied)}
                </span>
              </div>
            )}
            <div className="mt-2 flex justify-between border-t border-white/10 pt-2">
              <span className="font-semibold text-white">Total</span>
              <span className="font-bold text-green-400">
                {formatPrice(result.total)}
              </span>
            </div>
          </div>
        </div>

        <p className="text-xs text-white/40">
          Need to make changes? Text Harry at (719) 358-6137
        </p>
      </div>
    )
  }

  // ── Step layout ─────────────────────────────────────────────────────────────
  return (
    <>
      <div className="rounded-2xl border border-white/10 bg-black/60 p-4 backdrop-blur-sm">
        <StepBar current={step} />

        {/* ── Step 1: Services ── */}
        {step === 1 && (
          <div>
            <h3 className="mb-1 text-base font-bold text-white">
              Select Services
            </h3>
            <p className="mb-4 text-xs text-white/50">
              Minimum booking {formatPrice(MIN_TOTAL)}.
            </p>

            {servicesLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-20 animate-pulse rounded-xl bg-white/5"
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
                  onSetQuantity={setCartQuantity}
                />
              ))
            )}

            {cart.length > 0 && (
              <>
                {/* In-flow spacer: mobile subtotal is portaled to document.body */}
                <div className="h-14 shrink-0 md:hidden" aria-hidden />

                <div className="mt-4 hidden items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3 md:flex">
                  <div>
                    <p className="text-xs text-white/50">
                      {cart.reduce((s, c) => s + c.quantity, 0)} service
                      {cart.reduce((s, c) => s + c.quantity, 0) !== 1
                        ? 's'
                        : ''}
                    </p>
                    <p className="text-sm font-bold text-white">
                      {formatPrice(subtotal)}
                    </p>
                    {!meetsMinimum && (
                      <p className="text-xs text-red-400">
                        {formatPrice(MIN_TOTAL - subtotal)} more to meet minimum
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!meetsMinimum}
                    onClick={() => setStep(2)}
                    className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Step 2: Schedule ── */}
        {step === 2 && (
          <div>
            <h3 className="mb-1 text-base font-bold text-white">
              Pick a Date & Time
            </h3>
            <p className="mb-4 text-xs text-white/50">
              Select a date, then choose a time window.
            </p>

            <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <MiniCalendar
                selected={selectedDate}
                onSelect={setSelectedDate}
              />
            </div>

            {selectedDate && (
              <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="mb-3 text-xs font-semibold text-white/60">
                  Available windows — {formatDateDisplay(selectedDate)}
                </p>
                {slotsLoading ? (
                  <div className="grid grid-cols-2 gap-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="h-10 animate-pulse rounded-lg bg-white/5"
                      />
                    ))}
                  </div>
                ) : slots.length === 0 ? (
                  <p className="py-3 text-center text-sm text-white/40">
                    No availability. Try another day.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {slots.map((slot) => (
                      <button
                        key={slot.start_time}
                        type="button"
                        onClick={() => setSelectedSlot(slot)}
                        className={`rounded-xl border py-2.5 text-sm font-medium transition-all ${
                          selectedSlot?.start_time === slot.start_time
                            ? 'border-green-500 bg-green-600 text-white'
                            : 'border-white/15 text-white/70 hover:border-green-400 hover:text-green-300'
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
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 rounded-xl border border-white/15 py-3 text-sm font-medium text-white/60 transition-colors hover:bg-white/5"
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={!selectedDate || !selectedSlot}
                onClick={() => setStep(3)}
                className="flex-1 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Your Info ── */}
        {step === 3 && (
          <div>
            <h3 className="mb-1 text-base font-bold text-white">
              Your Information
            </h3>
            <p className="mb-4 text-xs text-white/50">
              We&apos;ll text reminders to your phone.
            </p>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>First Name *</label>
                  <input
                    type="text"
                    autoComplete="given-name"
                    value={form.first_name}
                    onChange={(e) => setField('first_name', e.target.value)}
                    className={inputCls}
                    placeholder="John"
                  />
                </div>
                <div>
                  <label className={labelCls}>Last Name *</label>
                  <input
                    type="text"
                    autoComplete="family-name"
                    value={form.last_name}
                    onChange={(e) => setField('last_name', e.target.value)}
                    className={inputCls}
                    placeholder="Smith"
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Email *</label>
                <input
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                  className={inputCls}
                  placeholder="john@example.com"
                />
              </div>

              <div>
                <label className={labelCls}>Phone *</label>
                <input
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                  className={inputCls}
                  placeholder="(719) 555-0123"
                />
              </div>

              <div className="border-t border-white/10 pt-3">
                <p className="mb-2 text-xs font-semibold text-white/50">
                  Service Address
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    autoComplete="street-address"
                    value={form.street_1}
                    onChange={(e) => setField('street_1', e.target.value)}
                    className={inputCls}
                    placeholder="Street address *"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      autoComplete="address-level2"
                      value={form.city}
                      onChange={(e) => setField('city', e.target.value)}
                      className={inputCls}
                      placeholder="City *"
                    />
                    <div className="flex gap-2">
                      <select
                        value={form.state}
                        onChange={(e) => setField('state', e.target.value)}
                        className="w-14 rounded-xl border border-white/20 bg-white/10 px-2 py-2.5 text-sm text-white focus:border-green-400 focus:outline-none"
                      >
                        {['CO', 'WY', 'NM', 'UT', 'KS', 'NE', 'OK', 'TX'].map(
                          (s) => (
                            <option key={s} className="bg-gray-900">
                              {s}
                            </option>
                          ),
                        )}
                      </select>
                      <input
                        type="text"
                        autoComplete="postal-code"
                        value={form.zip_code}
                        onChange={(e) => setField('zip_code', e.target.value)}
                        className={inputCls}
                        placeholder="ZIP *"
                        maxLength={5}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className={labelCls}>
                  Notes{' '}
                  <span className="font-normal text-white/30">(optional)</span>
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  rows={2}
                  className={`${inputCls} resize-none`}
                  placeholder="Gate codes, pets, parking…"
                />
              </div>
            </div>

            {submitError && (
              <p className="mt-3 text-center text-sm text-red-400">
                {submitError}
              </p>
            )}

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setSubmitError('')
                  setStep(2)
                }}
                className="flex-1 rounded-xl border border-white/15 py-3 text-sm font-medium text-white/60 transition-colors hover:bg-white/5"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => {
                  const err = validateStep3()
                  if (err) {
                    setSubmitError(err)
                    return
                  }
                  setSubmitError('')
                  setStep(4)
                }}
                className="flex-1 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-500"
              >
                Review →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Review & Confirm ── */}
        {step === 4 && (
          <div>
            <h3 className="mb-1 text-base font-bold text-white">
              Review & Confirm
            </h3>
            <p className="mb-4 text-xs text-white/50">
              Double-check before we lock in your appointment.
            </p>

            {/* Services summary */}
            <div className="mb-3 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="mb-2 text-xs font-semibold tracking-wide text-white/40 uppercase">
                Services
              </p>
              <div className="space-y-1.5">
                {cart.map((ci) => (
                  <div
                    key={ci.service.id}
                    className="flex justify-between text-sm"
                  >
                    <span className="text-white/80">
                      {ci.service.name}
                      {ci.quantity > 1 && (
                        <span className="ml-1 text-white/40">
                          × {ci.quantity}
                        </span>
                      )}
                    </span>
                    <span className="font-medium text-white">
                      {formatPrice(ci.service.base_price * ci.quantity)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 space-y-1.5 border-t border-white/10 pt-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/70">Subtotal</span>
                  <span className="font-medium text-white">
                    {formatPrice(subtotal)}
                  </span>
                </div>
                {couponCode.trim() && reviewPromo === null ? (
                  <div className="flex justify-between text-xs text-white/40">
                    <span>Promo and total</span>
                    <span>…</span>
                  </div>
                ) : null}
                {reviewPromo && reviewPromo.discountAmount > 0 ? (
                  <div className="flex justify-between text-green-400/95">
                    <span>
                      Discount (
                      <span className="font-mono font-semibold">
                        {couponCode.trim().toUpperCase()}
                      </span>
                      )
                    </span>
                    <span className="font-semibold">
                      −{formatPrice(reviewPromo.discountAmount)}
                    </span>
                  </div>
                ) : null}
                {reviewPromo ? (
                  <div className="flex justify-between border-t border-white/10 pt-2 text-base font-bold">
                    <span className="text-white">Total</span>
                    <span className="text-green-400">
                      {formatPrice(reviewPromo.total)}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Appointment */}
            <div className="mb-3 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="mb-2 text-xs font-semibold tracking-wide text-white/40 uppercase">
                Appointment
              </p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/50">Date</span>
                  <span className="font-medium text-white">
                    {formatDateDisplay(selectedDate)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Time</span>
                  <span className="font-medium text-white">
                    {selectedSlot?.label}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Address</span>
                  <span className="max-w-[60%] text-right font-medium text-white">
                    {form.street_1}, {form.city}
                  </span>
                </div>
              </div>
            </div>

            {/* Contact */}
            <div className="mb-3 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="mb-2 text-xs font-semibold tracking-wide text-white/40 uppercase">
                Contact
              </p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/50">Name</span>
                  <span className="font-medium text-white">
                    {form.first_name} {form.last_name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Phone</span>
                  <span className="font-medium text-white">{form.phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Email</span>
                  <span className="font-medium text-white">{form.email}</span>
                </div>
              </div>
            </div>

            {couponCode.trim() &&
            reviewPromo &&
            reviewPromo.discountAmount > 0 ? (
              <div className="mb-3 flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/10 p-3">
                <svg
                  className="h-4 w-4 shrink-0 text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                  />
                </svg>
                <p className="text-xs font-medium text-green-300/90">
                  Your card code is included — discount shown in Services above.
                </p>
              </div>
            ) : null}

            {/* Payment notice */}
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
              <svg
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
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
              <p className="text-xs leading-relaxed text-amber-300/80">
                Payment collected day-of. We accept cash, card, Venmo, or
                CashApp. No payment required to confirm.
              </p>
            </div>

            {submitError && (
              <p className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-center text-sm text-red-400">
                {submitError}
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setStep(3)}
                className="flex-1 rounded-xl border border-white/15 py-3 text-sm font-medium text-white/60 transition-colors hover:bg-white/5 disabled:opacity-40"
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-bold text-white transition-colors hover:bg-green-500 disabled:opacity-50"
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
      </div>
      {mobileSubtotalHost &&
        step === 1 &&
        cart.length > 0 &&
        createPortal(
          <div
            className="fixed right-0 bottom-0 left-0 z-[100] flex min-h-12 border-t border-white/15 bg-black/90 px-4 py-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.45)] backdrop-blur-sm md:hidden"
            style={{
              paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))',
            }}
          >
            <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 text-base leading-tight text-white/85">
              <span className="min-w-0 truncate">
                <span className="text-white/55">Subtotal</span>{' '}
                <span className="font-bold text-green-400 tabular-nums">
                  {formatPrice(subtotal)}
                </span>
                {meetsMinimum ? null : (
                  <span className="text-red-300/90">
                    {' '}
                    · {formatPrice(MIN_TOTAL - subtotal)} to min
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={!meetsMinimum}
                onClick={() => setStep(2)}
                className="shrink-0 rounded-lg bg-green-600 px-4 py-2 text-base font-semibold whitespace-nowrap text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>,
          mobileSubtotalHost,
        )}
    </>
  )
}
