'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Ruler,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  computeAreaQuantity,
  describeAreaCalc,
  isAreaUnit,
  isLinearUnit,
  supportsDimensions,
} from '@/lib/ops/estimates'

type ServiceCatalogItem = {
  id: string
  name: string
  category: string | null
  base_price: number | null
  default_duration_minutes: number | null
  pricing_unit: string | null
}

type OpsCustomer = {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  business_name: string | null
  phone: string | null
  email: string | null
  notes: string | null
}

type OpsAddress = {
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

type LineItem = {
  id: string
  service_catalog_item_id: string | null
  name_snapshot: string
  notes: string | null
  quantity: number | string
  unit_price: number | string
  duration_minutes: number | string
  buffer_minutes: number | string
  line_total: number
  length_value: number | string | null
  width_value: number | string | null
  pricing_unit_snapshot: string | null
  // Marker for newly added rows that have no DB id yet.
  _isNew?: boolean
}

type EstimateDetail = {
  id: string
  kind: 'service' | 'estimate'
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  estimate_status: string | null
  converted_appointment_id: string | null
  quoted_total: number | null
  internal_notes: string | null
  ops_customers: OpsCustomer | OpsCustomer[] | null
  ops_service_addresses: OpsAddress | OpsAddress[] | null
  ops_appointment_line_items: Array<{
    id: string
    service_catalog_item_id: string | null
    name_snapshot: string
    notes: string | null
    quantity: number
    unit_price: number
    duration_minutes: number
    buffer_minutes: number
    line_total: number
    length_value: number | null
    width_value: number | null
    pricing_unit_snapshot: string | null
  }>
}

type EstimateDetailProps = {
  estimateId: string
}

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function nextBusinessDay(iso: string, offsetDays = 7): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  dt.setUTCDate(dt.getUTCDate() + offsetDays)
  // Skip Sunday (0) and Saturday (6)
  while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) {
    dt.setUTCDate(dt.getUTCDate() + 1)
  }
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function makeRowKey(): string {
  return `new-${Math.random().toString(36).slice(2, 10)}`
}

function toNumber(
  value: number | string | null | undefined,
  fallback = 0,
): number {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft: {
    label: 'Draft',
    className: 'bg-slate-100 text-slate-700',
  },
  sent: {
    label: 'Sent',
    className: 'bg-sky-100 text-sky-800',
  },
  accepted: {
    label: 'Accepted',
    className: 'bg-emerald-100 text-emerald-800',
  },
  declined: {
    label: 'Declined',
    className: 'bg-rose-100 text-rose-800',
  },
  converted: {
    label: 'Converted',
    className: 'bg-violet-100 text-violet-800',
  },
}

export function EstimateDetail({ estimateId }: EstimateDetailProps) {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [estimate, setEstimate] = useState<EstimateDetail | null>(null)

  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [internalNotes, setInternalNotes] = useState('')
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleStart, setScheduleStart] = useState('')
  const [scheduleEnd, setScheduleEnd] = useState('')

  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([])

  const [showConvertDialog, setShowConvertDialog] = useState(false)
  const [convertDate, setConvertDate] = useState('')
  const [convertStart, setConvertStart] = useState('09:00')
  const [convertSubmitting, setConvertSubmitting] = useState(false)
  const [convertError, setConvertError] = useState<string | null>(null)

  const loadEstimate = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/ops/estimates/${estimateId}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || 'Failed to load estimate')
      }
      const data: { estimate: EstimateDetail } = await res.json()
      setEstimate(data.estimate)
      setInternalNotes(data.estimate.internal_notes || '')
      setScheduleDate(data.estimate.appointment_date)
      setScheduleStart(data.estimate.start_time.slice(0, 5))
      setScheduleEnd(data.estimate.end_time.slice(0, 5))
      setLineItems(
        (data.estimate.ops_appointment_line_items || []).map((row) => ({
          id: row.id,
          service_catalog_item_id: row.service_catalog_item_id,
          name_snapshot: row.name_snapshot,
          notes: row.notes,
          quantity: row.quantity,
          unit_price: row.unit_price,
          duration_minutes: row.duration_minutes,
          buffer_minutes: row.buffer_minutes,
          line_total: row.line_total,
          length_value: row.length_value,
          width_value: row.width_value,
          pricing_unit_snapshot: row.pricing_unit_snapshot,
        })),
      )
      setConvertDate(nextBusinessDay(data.estimate.appointment_date))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load estimate')
    } finally {
      setLoading(false)
    }
  }, [estimateId])

  useEffect(() => {
    void loadEstimate()
  }, [loadEstimate])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/ops/services')
        if (!res.ok) return
        const data: { services: ServiceCatalogItem[] } = await res.json()
        setCatalog(data.services || [])
      } catch (err) {
        console.warn('Failed to load service catalog', err)
      }
    })()
  }, [])

  const customer = useMemo(
    () => unwrapRelation(estimate?.ops_customers),
    [estimate?.ops_customers],
  )
  const address = useMemo(
    () => unwrapRelation(estimate?.ops_service_addresses),
    [estimate?.ops_service_addresses],
  )

  const subtotal = useMemo(() => {
    return lineItems.reduce((sum, line) => {
      const qty = toNumber(line.quantity, 1)
      const price = toNumber(line.unit_price, 0)
      return sum + qty * price
    }, 0)
  }, [lineItems])

  const totalMeasureMinutes = useMemo(() => {
    return lineItems.reduce((sum, line) => {
      return sum + toNumber(line.duration_minutes, 0)
    }, 0)
  }, [lineItems])

  // ── Line item editing ───────────────────────────────────────────────────

  const updateLine = useCallback((id: string, patch: Partial<LineItem>) => {
    setLineItems((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line
        const next = { ...line, ...patch }

        // If L or W is touched and we know the unit, recompute quantity.
        const touchedDimension =
          'length_value' in patch || 'width_value' in patch
        if (
          touchedDimension &&
          supportsDimensions(next.pricing_unit_snapshot)
        ) {
          const l = toNumber(next.length_value, NaN)
          const w = toNumber(next.width_value, NaN)
          const computed = computeAreaQuantity(
            Number.isFinite(l) ? l : null,
            Number.isFinite(w) ? w : null,
            next.pricing_unit_snapshot,
          )
          if (computed != null) {
            next.quantity = computed
          }
        }

        // If quantity is manually edited, clear L/W to avoid drift between
        // the stored quantity and what the dimensions would imply.
        if ('quantity' in patch && !touchedDimension) {
          // Only clear if user actually typed a new quantity (not a derived
          // one coming from the L/W block above).
          next.length_value = null
          next.width_value = null
        }

        return next
      }),
    )
  }, [])

  const handleSelectCatalogItem = useCallback(
    (rowId: string, catalogId: string) => {
      if (!catalogId) {
        updateLine(rowId, {
          service_catalog_item_id: null,
          pricing_unit_snapshot: null,
        })
        return
      }
      const item = catalog.find((c) => c.id === catalogId)
      if (!item) return
      updateLine(rowId, {
        service_catalog_item_id: item.id,
        name_snapshot: item.name,
        unit_price: item.base_price ?? 0,
        duration_minutes: item.default_duration_minutes ?? 30,
        pricing_unit_snapshot: item.pricing_unit || 'fixed',
      })
    },
    [catalog, updateLine],
  )

  const handleAddLine = useCallback(() => {
    const newRow: LineItem = {
      id: makeRowKey(),
      service_catalog_item_id: null,
      name_snapshot: '',
      notes: null,
      quantity: 1,
      unit_price: 0,
      duration_minutes: 30,
      buffer_minutes: 0,
      line_total: 0,
      length_value: null,
      width_value: null,
      pricing_unit_snapshot: 'fixed',
      _isNew: true,
    }
    setLineItems((prev) => [...prev, newRow])
  }, [])

  const handleDeleteLine = useCallback((id: string) => {
    setLineItems((prev) => prev.filter((line) => line.id !== id))
  }, [])

  // ── Save ────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const body = {
        appointment_date: scheduleDate,
        start_time: scheduleStart,
        end_time: scheduleEnd || undefined,
        internal_notes: internalNotes,
        line_items: lineItems.map((line) => ({
          id: line.id,
          service_catalog_item_id: line.service_catalog_item_id,
          name_snapshot: line.name_snapshot,
          notes: line.notes,
          quantity: toNumber(line.quantity, 1),
          unit_price: toNumber(line.unit_price, 0),
          duration_minutes: toNumber(line.duration_minutes, 0),
          buffer_minutes: toNumber(line.buffer_minutes, 0),
          length_value:
            line.length_value === '' || line.length_value == null
              ? null
              : Number(line.length_value),
          width_value:
            line.width_value === '' || line.width_value == null
              ? null
              : Number(line.width_value),
          pricing_unit_snapshot: line.pricing_unit_snapshot,
        })),
      }
      const res = await fetch(`/api/admin/ops/estimates/${estimateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to save estimate')
      }
      await loadEstimate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [
    estimateId,
    internalNotes,
    lineItems,
    loadEstimate,
    scheduleDate,
    scheduleEnd,
    scheduleStart,
  ])

  const handleStatusChange = useCallback(
    async (status: 'draft' | 'sent' | 'accepted' | 'declined') => {
      setActionLoading(status)
      setError(null)
      try {
        const res = await fetch(`/api/admin/ops/estimates/${estimateId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estimate_status: status }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => null)
          throw new Error(payload?.error || 'Failed to update status')
        }
        await loadEstimate()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update status')
      } finally {
        setActionLoading(null)
      }
    },
    [estimateId, loadEstimate],
  )

  const handleDelete = useCallback(async () => {
    if (!confirm('Delete this estimate permanently?')) return
    setActionLoading('delete')
    setError(null)
    try {
      const res = await fetch(`/api/admin/ops/estimates/${estimateId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to delete estimate')
      }
      router.push('/admin/operations/estimates')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
      setActionLoading(null)
    }
  }, [estimateId, router])

  const handleConvert = useCallback(async () => {
    setConvertSubmitting(true)
    setConvertError(null)
    try {
      // Save current edits first so the conversion sees the latest line items.
      await handleSave()

      const res = await fetch(
        `/api/admin/ops/estimates/${estimateId}/convert`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_date: convertDate,
            start_time: convertStart,
          }),
        },
      )
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to convert estimate')
      }
      if (payload?.appointment_id) {
        router.push(`/admin/operations/appointments/${payload.appointment_id}`)
      } else {
        setShowConvertDialog(false)
        await loadEstimate()
      }
    } catch (err) {
      setConvertError(
        err instanceof Error ? err.message : 'Failed to convert estimate',
      )
      setConvertSubmitting(false)
    }
  }, [convertDate, convertStart, estimateId, handleSave, loadEstimate, router])

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading && !estimate) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!estimate) {
    return (
      <div className="p-6">
        <Card className="p-6">
          <p className="font-medium">Estimate not found.</p>
          {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => router.push('/admin/operations/estimates')}
          >
            Back to estimates
          </Button>
        </Card>
      </div>
    )
  }

  const statusKey = estimate.estimate_status || 'draft'
  const badge = STATUS_BADGE[statusKey] || STATUS_BADGE.draft
  const isConverted = !!estimate.converted_appointment_id
  const fullAddress = address
    ? `${address.street_1}${address.street_2 ? `, ${address.street_2}` : ''}, ${address.city}, ${address.state} ${address.zip_code}`
    : null
  const mapsHref = address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`)}`
    : null

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase">
              Estimate · {formatDate(estimate.appointment_date)}
            </p>
            <h1 className="mt-1 text-3xl font-bold">
              {customer?.business_name || customer?.full_name || 'Customer'}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Measuring visit · {estimate.start_time.slice(0, 5)}–
              {estimate.end_time.slice(0, 5)} ·{' '}
              {Math.round(totalMeasureMinutes) || 30} min
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge className={badge.className}>{badge.label}</Badge>
            <p className="text-2xl font-bold tabular-nums">
              ${subtotal.toFixed(2)}
            </p>
            <p className="text-muted-foreground text-xs">Est. job total</p>
          </div>
        </div>

        {/* Contact + address */}
        <div className="mt-6 space-y-3 text-sm">
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
          ) : null}
          {customer?.email ? (
            <div className="text-muted-foreground flex items-center gap-2">
              <Mail className="h-4 w-4 shrink-0" />
              <span>{customer.email}</span>
            </div>
          ) : null}
          {fullAddress && mapsHref ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <MapPin className="text-muted-foreground h-4 w-4 shrink-0" />
                <span className="text-muted-foreground flex-1">
                  {fullAddress}
                </span>
              </div>
              {address?.gate_code ? (
                <p className="text-muted-foreground ml-6 text-xs">
                  Gate: {address.gate_code}
                </p>
              ) : null}
              <Button
                size="default"
                className="w-full gap-2 bg-green-600 font-bold tracking-widest text-white uppercase hover:bg-green-500"
                asChild
              >
                <a href={mapsHref} target="_blank" rel="noopener noreferrer">
                  <MapPin className="h-4 w-4" />
                  Get Directions
                </a>
              </Button>
            </div>
          ) : null}
        </div>

        {isConverted ? (
          <div className="mt-5 rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
            <p className="font-semibold">Converted to a service appointment.</p>
            <Button
              variant="link"
              className="h-auto p-0 text-violet-700"
              onClick={() =>
                router.push(
                  `/admin/operations/appointments/${estimate.converted_appointment_id}`,
                )
              }
            >
              Open the service job <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
        ) : null}
      </Card>

      {/* ── Schedule ────────────────────────────────────────────────── */}
      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          <CalendarClock className="text-muted-foreground h-4 w-4" />
          <h2 className="text-base font-semibold">Measuring visit</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="estimate-date" className="text-xs">
              Date
            </Label>
            <Input
              id="estimate-date"
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="estimate-start" className="text-xs">
              Start time
            </Label>
            <Input
              id="estimate-start"
              type="time"
              value={scheduleStart}
              onChange={(e) => setScheduleStart(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="estimate-end" className="text-xs">
              End time
            </Label>
            <Input
              id="estimate-end"
              type="time"
              value={scheduleEnd}
              onChange={(e) => setScheduleEnd(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="estimate-internal-notes" className="text-xs">
            Internal notes (only visible to the team)
          </Label>
          <Textarea
            id="estimate-internal-notes"
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            rows={2}
            placeholder="Anything you want to remember before the measuring visit…"
          />
        </div>
      </Card>

      {/* ── Line items ──────────────────────────────────────────────── */}
      <Card className="p-4 md:p-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Ruler className="text-muted-foreground h-4 w-4" />
            <h2 className="text-base font-semibold">Line items</h2>
          </div>
          <Button size="sm" className="gap-1" onClick={handleAddLine}>
            <Plus className="h-4 w-4" />
            Add line
          </Button>
        </div>

        {lineItems.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">
            No line items yet. Add one to start capturing measurements.
          </p>
        ) : null}

        <div className="mt-4 space-y-4">
          {lineItems.map((line, idx) => {
            const unit = line.pricing_unit_snapshot
            const showDimensions = supportsDimensions(unit)
            const lengthN = toNumber(line.length_value, NaN)
            const widthN = toNumber(line.width_value, NaN)
            const areaCalc = showDimensions
              ? describeAreaCalc(
                  Number.isFinite(lengthN) ? lengthN : null,
                  Number.isFinite(widthN) ? widthN : null,
                  unit,
                )
              : null

            return (
              <div
                key={line.id}
                className="border-border/60 rounded-lg border p-3 md:p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-muted-foreground text-xs font-medium">
                    Line {idx + 1}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-rose-600 hover:text-rose-700"
                    onClick={() => handleDeleteLine(line.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-6">
                  <div className="md:col-span-3">
                    <Label className="text-xs">Service from catalog</Label>
                    <select
                      className="border-input bg-background focus-visible:ring-ring mt-1 h-9 w-full rounded-md border px-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
                      value={line.service_catalog_item_id || ''}
                      onChange={(e) =>
                        handleSelectCatalogItem(line.id, e.target.value)
                      }
                    >
                      <option value="">— Custom / none —</option>
                      {catalog.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {item.base_price != null
                            ? ` — $${Number(item.base_price).toFixed(2)}`
                            : ''}
                          {item.pricing_unit && item.pricing_unit !== 'fixed'
                            ? ` (${item.pricing_unit})`
                            : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-3">
                    <Label className="text-xs">
                      Description shown to customer
                    </Label>
                    <Input
                      value={line.name_snapshot}
                      onChange={(e) =>
                        updateLine(line.id, { name_snapshot: e.target.value })
                      }
                      placeholder="e.g. Commercial carpet — main hallway"
                    />
                  </div>

                  {showDimensions ? (
                    <>
                      <div className="md:col-span-1">
                        <Label className="text-xs">
                          {isLinearUnit(unit) ? 'Length (ft)' : 'Length (ft)'}
                        </Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          value={line.length_value ?? ''}
                          onChange={(e) =>
                            updateLine(line.id, {
                              length_value:
                                e.target.value === '' ? null : e.target.value,
                            })
                          }
                          placeholder="0"
                        />
                      </div>
                      <div className="md:col-span-1">
                        <Label className="text-xs">
                          {isLinearUnit(unit) ? 'Width (unused)' : 'Width (ft)'}
                        </Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          value={line.width_value ?? ''}
                          onChange={(e) =>
                            updateLine(line.id, {
                              width_value:
                                e.target.value === '' ? null : e.target.value,
                            })
                          }
                          placeholder="0"
                          disabled={isLinearUnit(unit)}
                        />
                      </div>
                    </>
                  ) : null}

                  <div className="md:col-span-1">
                    <Label className="text-xs">
                      Quantity{' '}
                      {isAreaUnit(unit)
                        ? '(sqft)'
                        : isLinearUnit(unit)
                          ? '(linear ft)'
                          : ''}
                    </Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(line.id, {
                          quantity: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div
                    className={
                      showDimensions ? 'md:col-span-2' : 'md:col-span-2'
                    }
                  >
                    <Label className="text-xs">Unit price</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={line.unit_price}
                      onChange={(e) =>
                        updateLine(line.id, { unit_price: e.target.value })
                      }
                    />
                  </div>

                  <div
                    className={
                      showDimensions ? 'md:col-span-2' : 'md:col-span-3'
                    }
                  >
                    <Label className="text-xs">Duration (min)</Label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      step="5"
                      value={line.duration_minutes}
                      onChange={(e) =>
                        updateLine(line.id, {
                          duration_minutes: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>

                {areaCalc ? (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {areaCalc}
                  </p>
                ) : null}

                <div className="mt-3">
                  <Label className="text-xs">
                    Service notes (what, why, technique)
                  </Label>
                  <Textarea
                    value={line.notes ?? ''}
                    onChange={(e) =>
                      updateLine(line.id, { notes: e.target.value })
                    }
                    rows={3}
                    placeholder="Explain in detail what you're doing and why. Example: Running CRB pre-scrub to lift matted fibers in the traffic lane, then hot water extraction with enzyme pre-spray for the pet area by the front door. Stairs need to be protected with plastic corner guards — customer has antique banister."
                    className="min-h-[80px]"
                  />
                </div>

                <div className="text-muted-foreground mt-2 flex justify-end text-xs tabular-nums">
                  Line total: $
                  {(
                    toNumber(line.quantity, 1) * toNumber(line.unit_price, 0)
                  ).toFixed(2)}
                </div>
              </div>
            )
          })}
        </div>

        {/* Subtotal */}
        <div className="border-border/60 mt-6 border-t pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Estimated job total</span>
            <span className="text-2xl font-bold tabular-nums">
              ${subtotal.toFixed(2)}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            No payment collected on estimates. Totals lock in when you schedule
            the actual work.
          </p>
        </div>
      </Card>

      {/* ── Action bar ──────────────────────────────────────────────── */}
      <Card className="flex flex-wrap items-center gap-2 p-4">
        <Button
          onClick={() => void handleSave()}
          disabled={saving}
          className="gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save changes'}
        </Button>

        {!isConverted ? (
          <>
            {statusKey !== 'sent' ? (
              <Button
                variant="outline"
                disabled={actionLoading !== null}
                onClick={() => void handleStatusChange('sent')}
              >
                {actionLoading === 'sent' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Mark sent
              </Button>
            ) : null}
            {statusKey !== 'accepted' ? (
              <Button
                variant="outline"
                disabled={actionLoading !== null}
                onClick={() => void handleStatusChange('accepted')}
              >
                {actionLoading === 'accepted' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Mark accepted
              </Button>
            ) : null}
            {statusKey !== 'declined' ? (
              <Button
                variant="ghost"
                className="text-muted-foreground"
                disabled={actionLoading !== null}
                onClick={() => void handleStatusChange('declined')}
              >
                Mark declined
              </Button>
            ) : null}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                variant="destructive"
                className="gap-2"
                disabled={actionLoading !== null}
                onClick={() => void handleDelete()}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
              <Button
                className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={lineItems.length === 0}
                onClick={() => {
                  setConvertError(null)
                  setShowConvertDialog(true)
                }}
              >
                Schedule the work
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : (
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() =>
              router.push(
                `/admin/operations/appointments/${estimate.converted_appointment_id}`,
              )
            }
          >
            Go to service appointment
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </Card>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {/* ── Convert dialog ──────────────────────────────────────────── */}
      {showConvertDialog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!convertSubmitting) setShowConvertDialog(false)
          }}
        >
          <div
            className="bg-background w-full max-w-md rounded-lg border p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">Schedule the work</h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  Create a new service appointment and invoice from this
                  estimate. Line items will be copied over.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowConvertDialog(false)}
                disabled={convertSubmitting}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <Label htmlFor="convert-date" className="text-xs">
                  Service date
                </Label>
                <Input
                  id="convert-date"
                  type="date"
                  value={convertDate}
                  onChange={(e) => setConvertDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="convert-start" className="text-xs">
                  Start time
                </Label>
                <Input
                  id="convert-start"
                  type="time"
                  value={convertStart}
                  onChange={(e) => setConvertStart(e.target.value)}
                />
              </div>

              <div className="border-border/60 bg-muted/40 rounded-md border p-3 text-sm">
                <p className="font-medium">Copying these line items:</p>
                <ul className="mt-2 space-y-1 text-xs">
                  {lineItems.map((line) => (
                    <li
                      key={line.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate">
                        {line.name_snapshot || '(unnamed)'} ·{' '}
                        {toNumber(line.quantity, 1)}
                        {isAreaUnit(line.pricing_unit_snapshot)
                          ? ' sqft'
                          : isLinearUnit(line.pricing_unit_snapshot)
                            ? ' linear ft'
                            : ''}
                      </span>
                      <span className="tabular-nums">
                        $
                        {(
                          toNumber(line.quantity, 1) *
                          toNumber(line.unit_price, 0)
                        ).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="border-border/60 mt-2 flex justify-between border-t pt-2 font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">${subtotal.toFixed(2)}</span>
                </div>
              </div>

              {convertError ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                  {convertError}
                </div>
              ) : null}

              <div className="flex gap-2 pt-1">
                <Button
                  className="flex-1 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  disabled={convertSubmitting}
                  onClick={() => void handleConvert()}
                >
                  {convertSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {convertSubmitting
                    ? 'Creating service job…'
                    : 'Create service appointment'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setShowConvertDialog(false)}
                  disabled={convertSubmitting}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
