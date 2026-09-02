'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  Clock3,
  CalendarCheck,
  CheckCircle2,
  Copy,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Ruler,
  Send,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DirectionsButtons } from '@/components/ops/directions-buttons'
import { StreetViewCard } from '@/components/ops/street-view-card'
import type { ServiceAddressLike } from '@/lib/ops/address-links'
import {
  CANONICAL_LEAD_SOURCE_OPTIONS,
  getPublicLeadSourceOptions,
  type PublicLeadSourceOption,
} from '@/lib/lead-sources'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  describeSegmentsSummary,
  isAreaUnit,
  isLinearUnit,
  quantityFromSegments,
  supportsDimensions,
  type AreaSegment,
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

/** One L×W pair (or linear run) in the UI; clientId is React-only. */
type SegmentRow = { clientId: string; length: string; width: string }

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
  /** Legacy single rectangle; kept in sync with first segment when saving. */
  length_value: number | string | null
  width_value: number | string | null
  pricing_unit_snapshot: string | null
  area_segments: SegmentRow[]
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
  lead_source_key: string | null
  lead_source_detail: string | null
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
    area_segments: unknown
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

function segmentsFromApiRow(row: {
  id: string
  area_segments?: unknown
  length_value: number | null
  width_value: number | null
}): SegmentRow[] {
  const raw = row.area_segments
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((s: unknown, i: number) => {
      const o = s as Record<string, unknown>
      return {
        clientId: `seg-${row.id}-${i}`,
        length: o.length != null && o.length !== '' ? String(o.length) : '',
        width: o.width != null && o.width !== '' ? String(o.width) : '',
      }
    })
  }
  if (row.length_value != null || row.width_value != null) {
    return [
      {
        clientId: `legacy-${row.id}`,
        length: row.length_value != null ? String(row.length_value) : '',
        width: row.width_value != null ? String(row.width_value) : '',
      },
    ]
  }
  return []
}

function segmentRowsToAreaSegments(rows: SegmentRow[]): AreaSegment[] {
  const out: AreaSegment[] = []
  for (const r of rows) {
    const l = toNumber(r.length, NaN)
    const w = toNumber(r.width, NaN)
    if (!Number.isFinite(l) && !Number.isFinite(w)) continue
    out.push({
      length: Number.isFinite(l) ? l : 0,
      width: Number.isFinite(w) ? w : 0,
    })
  }
  return out
}

function derivedQuantityFromSegments(
  rows: SegmentRow[],
  unit: string | null,
): number {
  if (!supportsDimensions(unit)) return 0
  const segs = segmentRowsToAreaSegments(rows)
  if (!segs.length) return 0
  const q = quantityFromSegments(segs, unit)
  return q != null && q > 0 ? q : 0
}

function firstSegmentLegacyDims(segs: SegmentRow[]): {
  length_value: number | null
  width_value: number | null
} {
  const n = segmentRowsToAreaSegments(segs)
  if (!n.length) return { length_value: null, width_value: null }
  return { length_value: n[0].length, width_value: n[0].width }
}

function toNumber(
  value: number | string | null | undefined,
  fallback = 0,
): number {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

type SectionTone = 'emerald' | 'sky' | 'amber' | 'violet'

const SECTION_TONE: Record<SectionTone, string> = {
  emerald: 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/30',
  sky: 'bg-sky-500/15 text-sky-600 ring-sky-500/30',
  amber: 'bg-amber-500/15 text-amber-600 ring-amber-500/30',
  violet: 'bg-violet-500/15 text-violet-600 ring-violet-500/30',
}

function SectionTitle({
  icon,
  tone,
  title,
  subtitle,
}: {
  icon: React.ReactNode
  tone: SectionTone
  title: string
  subtitle?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ${SECTION_TONE[tone]}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle ? (
          <p className="text-muted-foreground text-xs">{subtitle}</p>
        ) : null}
      </div>
    </div>
  )
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

  // ── Editable contact / address state ──────────────────────────────────
  const [contactFirstName, setContactFirstName] = useState('')
  const [contactLastName, setContactLastName] = useState('')
  const [contactBusiness, setContactBusiness] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [leadSource, setLeadSource] = useState('')
  const [leadSourceDetail, setLeadSourceDetail] = useState('')
  const [leadSourceOptions, setLeadSourceOptions] = useState<
    PublicLeadSourceOption[]
  >(() => getPublicLeadSourceOptions(CANONICAL_LEAD_SOURCE_OPTIONS))
  const [addrStreet1, setAddrStreet1] = useState('')
  const [addrStreet2, setAddrStreet2] = useState('')
  const [addrCity, setAddrCity] = useState('')
  const [addrState, setAddrState] = useState('CO')
  const [addrZip, setAddrZip] = useState('')
  const [addrGateCode, setAddrGateCode] = useState('')

  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([])
  const [linePickerCategory, setLinePickerCategory] = useState<string>('')

  const [showConvertDialog, setShowConvertDialog] = useState(false)
  const [convertDate, setConvertDate] = useState('')
  const [convertStart, setConvertStart] = useState('09:00')
  const [convertSubmitting, setConvertSubmitting] = useState(false)
  const [convertError, setConvertError] = useState<string | null>(null)

  const [scheduleEmailSending, setScheduleEmailSending] = useState(false)
  const [scheduleEmailSent, setScheduleEmailSent] = useState(false)
  const [quoteEmailSending, setQuoteEmailSending] = useState(false)
  const [quoteEmailSent, setQuoteEmailSent] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

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
          area_segments: segmentsFromApiRow(row),
        })),
      )
      setConvertDate(nextBusinessDay(data.estimate.appointment_date))

      // Populate editable contact fields
      const cust = Array.isArray(data.estimate.ops_customers)
        ? data.estimate.ops_customers[0]
        : data.estimate.ops_customers
      if (cust) {
        setContactFirstName(cust.first_name || '')
        setContactLastName(cust.last_name || '')
        setContactBusiness(cust.business_name || '')
        setContactPhone(cust.phone || '')
        setContactEmail(cust.email || '')
      }
      setLeadSource(data.estimate.lead_source_key || '')
      setLeadSourceDetail(data.estimate.lead_source_detail || '')
      const addr = Array.isArray(data.estimate.ops_service_addresses)
        ? data.estimate.ops_service_addresses[0]
        : data.estimate.ops_service_addresses
      if (addr) {
        setAddrStreet1(addr.street_1 || '')
        setAddrStreet2(addr.street_2 || '')
        setAddrCity(addr.city || '')
        setAddrState(addr.state || 'CO')
        setAddrZip(addr.zip_code || '')
        setAddrGateCode(addr.gate_code || '')
      }
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

  const catalogCategories = useMemo(() => {
    const labels = new Set<string>()
    for (const s of catalog) {
      labels.add((s.category || 'Other').trim() || 'Other')
    }
    return Array.from(labels).sort((a, b) => a.localeCompare(b))
  }, [catalog])

  const servicesInPickerCategory = useMemo(() => {
    const cat = (linePickerCategory || catalogCategories[0] || 'Other').trim()
    return catalog.filter((s) => (s.category || 'Other').trim() === cat)
  }, [catalog, linePickerCategory, catalogCategories])

  useEffect(() => {
    if (catalogCategories.length > 0 && !linePickerCategory) {
      setLinePickerCategory(catalogCategories[0])
    }
  }, [catalogCategories, linePickerCategory])

  const subtotal = useMemo(() => {
    return lineItems.reduce((sum, line) => {
      const unit = line.pricing_unit_snapshot
      const qty = supportsDimensions(unit)
        ? derivedQuantityFromSegments(line.area_segments, unit)
        : toNumber(line.quantity, 1)
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

        if ('area_segments' in patch) {
          const q = derivedQuantityFromSegments(
            next.area_segments,
            next.pricing_unit_snapshot,
          )
          next.quantity = q
          const leg = firstSegmentLegacyDims(next.area_segments)
          next.length_value = leg.length_value
          next.width_value = leg.width_value
        }

        if (
          'quantity' in patch &&
          !('area_segments' in patch) &&
          !supportsDimensions(next.pricing_unit_snapshot)
        ) {
          // fixed-price: keep patched quantity
        } else if (
          'quantity' in patch &&
          !('area_segments' in patch) &&
          supportsDimensions(next.pricing_unit_snapshot)
        ) {
          next.quantity = derivedQuantityFromSegments(
            next.area_segments,
            next.pricing_unit_snapshot,
          )
        }

        return next
      }),
    )
  }, [])

  const handleSelectCatalogItem = useCallback(
    (rowId: string, catalogId: string) => {
      setLineItems((prev) =>
        prev.map((line) => {
          if (line.id !== rowId) return line
          if (!catalogId) {
            return {
              ...line,
              service_catalog_item_id: null,
              pricing_unit_snapshot: 'fixed',
              area_segments: [],
              length_value: null,
              width_value: null,
              quantity: toNumber(line.quantity, 1),
            }
          }
          const item = catalog.find((c) => c.id === catalogId)
          if (!item) return line
          const dim = supportsDimensions(item.pricing_unit || 'fixed')
          return {
            ...line,
            service_catalog_item_id: item.id,
            name_snapshot: item.name,
            unit_price: item.base_price ?? 0,
            duration_minutes: item.default_duration_minutes ?? 30,
            pricing_unit_snapshot: item.pricing_unit || 'fixed',
            area_segments: dim ? [] : [],
            length_value: null,
            width_value: null,
            quantity: dim ? 0 : toNumber(line.quantity, 1),
          }
        }),
      )
    },
    [catalog],
  )

  const handleAddServiceFromCatalog = useCallback(
    (item: ServiceCatalogItem) => {
      const dim = supportsDimensions(item.pricing_unit || 'fixed')
      const newRow: LineItem = {
        id: makeRowKey(),
        service_catalog_item_id: item.id,
        name_snapshot: item.name,
        notes: null,
        quantity: dim ? 0 : 1,
        unit_price: item.base_price ?? 0,
        duration_minutes: item.default_duration_minutes ?? 30,
        buffer_minutes: 0,
        line_total: 0,
        length_value: null,
        width_value: null,
        pricing_unit_snapshot: item.pricing_unit || 'fixed',
        area_segments: [],
        _isNew: true,
      }
      setLineItems((prev) => [...prev, newRow])
    },
    [],
  )

  const handleAddCustomLine = useCallback(() => {
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
      area_segments: [],
      _isNew: true,
    }
    setLineItems((prev) => [...prev, newRow])
  }, [])

  const handleDeleteLine = useCallback((id: string) => {
    setLineItems((prev) => prev.filter((line) => line.id !== id))
  }, [])

  /**
   * Copy a line, measurements and all, directly below the original.
   *
   * Commercial walkthroughs repeat the same service across several spaces, and
   * going back to the catalog picker for each one is the slow part on a phone.
   * The copy lands next to its source rather than at the bottom so the list does
   * not jump. Segments get fresh clientIds — reusing them would collide the two
   * rows' React keys and make the measurement fields edit each other.
   */
  const handleDuplicateLine = useCallback((id: string) => {
    setLineItems((prev) => {
      const idx = prev.findIndex((line) => line.id === id)
      if (idx === -1) return prev
      const source = prev[idx]
      const copy: LineItem = {
        ...source,
        id: makeRowKey(),
        area_segments: source.area_segments.map((seg) => ({
          ...seg,
          clientId: makeRowKey(),
        })),
        _isNew: true,
      }
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)]
    })
  }, [])

  useEffect(() => {
    fetch('/api/public/lead-sources', { cache: 'no-store' })
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error('failed')),
      )
      .then((data) => {
        if (Array.isArray(data.options) && data.options.length > 0) {
          setLeadSourceOptions(data.options)
        }
      })
      .catch(() => {
        setLeadSourceOptions(
          getPublicLeadSourceOptions(CANONICAL_LEAD_SOURCE_OPTIONS),
        )
      })
  }, [])

  // ── Save ────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        appointment_date: scheduleDate,
        start_time: scheduleStart,
        end_time: scheduleEnd || undefined,
        internal_notes: internalNotes,
        lead_source_key: leadSource || null,
        lead_source_detail: leadSourceDetail || null,
        customer: {
          first_name: contactFirstName || null,
          last_name: contactLastName || null,
          full_name:
            [contactFirstName, contactLastName].filter(Boolean).join(' ') ||
            contactBusiness ||
            'Customer',
          business_name: contactBusiness || null,
          phone: contactPhone || null,
          email: contactEmail || null,
        },
        address: {
          street_1: addrStreet1 || null,
          street_2: addrStreet2 || null,
          city: addrCity || null,
          state: addrState || 'CO',
          zip_code: addrZip || null,
          gate_code: addrGateCode || null,
        },
        line_items: lineItems.map((line) => {
          const unit = line.pricing_unit_snapshot
          const segs = segmentRowsToAreaSegments(line.area_segments)
          const qtyMeasured = supportsDimensions(unit)
            ? derivedQuantityFromSegments(line.area_segments, unit)
            : toNumber(line.quantity, 1)
          const leg = firstSegmentLegacyDims(line.area_segments)
          return {
            id: line.id,
            service_catalog_item_id: line.service_catalog_item_id,
            name_snapshot: line.name_snapshot,
            notes: line.notes,
            quantity: supportsDimensions(unit)
              ? qtyMeasured
              : toNumber(line.quantity, 1),
            unit_price: toNumber(line.unit_price, 0),
            duration_minutes: toNumber(line.duration_minutes, 0),
            buffer_minutes: toNumber(line.buffer_minutes, 0),
            length_value: leg.length_value,
            width_value: leg.width_value,
            pricing_unit_snapshot: line.pricing_unit_snapshot,
            area_segments: segs.length > 0 ? segs : null,
          }
        }),
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
    contactFirstName,
    contactLastName,
    contactBusiness,
    contactPhone,
    contactEmail,
    leadSource,
    leadSourceDetail,
    addrStreet1,
    addrStreet2,
    addrCity,
    addrState,
    addrZip,
    addrGateCode,
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
    const isConvertedEstimate = !!estimate?.converted_appointment_id
    const warningMessage = isConvertedEstimate
      ? 'This estimate was converted to an appointment. Deleting it will NOT delete the appointment. Delete the estimate anyway?'
      : 'Delete this estimate permanently?'

    if (!confirm(warningMessage)) return
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
  }, [estimateId, router, estimate])

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

  const handleSendEmail = useCallback(
    async (type: 'booking_confirmation' | 'quote') => {
      const setSending =
        type === 'booking_confirmation'
          ? setScheduleEmailSending
          : setQuoteEmailSending
      const setSent =
        type === 'booking_confirmation'
          ? setScheduleEmailSent
          : setQuoteEmailSent
      setSending(true)
      setEmailError(null)
      try {
        // Save current edits first so the email reflects the latest details
        await handleSave()
        const res = await fetch(
          `/api/admin/ops/estimates/${estimateId}/send-email`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type }),
          },
        )
        const payload = await res.json().catch(() => null)
        if (!res.ok) {
          throw new Error(payload?.error || 'Failed to send email')
        }
        setSent(true)
        // After quote is sent, reload to reflect the new 'sent' status badge
        if (type === 'quote') await loadEstimate()
        setTimeout(() => setSent(false), 4000)
      } catch (err) {
        setEmailError(
          err instanceof Error ? err.message : 'Failed to send email',
        )
      } finally {
        setSending(false)
      }
    },
    [estimateId, handleSave, loadEstimate],
  )

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
  const serviceAddress: ServiceAddressLike | null =
    addrStreet1 && addrCity
      ? {
          street_1: addrStreet1,
          street_2: addrStreet2,
          city: addrCity,
          state: addrState,
          zip_code: addrZip,
        }
      : null
  const displayName =
    contactBusiness ||
    [contactFirstName, contactLastName].filter(Boolean).join(' ') ||
    'New Estimate'
  const visitMinutes = Math.round(totalMeasureMinutes) || 30
  const selectedLeadSource = leadSourceOptions.find(
    (option) => option.key === leadSource,
  )
  const leadSourceMissing =
    !leadSource ||
    (selectedLeadSource?.requires_detail === true && !leadSourceDetail.trim())
  const isPlaceholderName =
    !contactBusiness.trim() &&
    contactFirstName.trim().toLowerCase() === 'new' &&
    contactLastName.trim().toLowerCase() === 'estimate'
  const readyToSend = !leadSourceMissing && !isPlaceholderName
  const notReadyReason = isPlaceholderName
    ? 'Enter the customer or business name first.'
    : leadSourceMissing
      ? 'Pick how they heard about us first.'
      : null

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <Card className="relative overflow-hidden border-emerald-500/30 bg-gradient-to-br from-emerald-950 via-slate-900 to-slate-950 p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-500/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-amber-400/15 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-300/40">
                <Ruler className="h-4 w-4" />
              </span>
              <p className="text-xs font-semibold tracking-[0.25em] text-emerald-200/90 uppercase">
                Estimate
              </p>
              <Badge
                className={`${badge.className} ml-1 shadow-sm ring-1 ring-white/40`}
              >
                {badge.label}
              </Badge>
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
              {displayName}
            </h1>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-medium text-white ring-1 ring-white/15">
                <CalendarDays className="h-4 w-4 text-emerald-300" />
                {formatDate(estimate.appointment_date)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-medium text-white ring-1 ring-white/15">
                <Clock3 className="h-4 w-4 text-sky-300" />
                {estimate.start_time.slice(0, 5)}–
                {estimate.end_time.slice(0, 5)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-medium text-white ring-1 ring-white/15">
                <CalendarClock className="h-4 w-4 text-amber-300" />
                {visitMinutes} min measuring visit
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-start sm:items-end">
            <p className="text-xs font-semibold tracking-[0.2em] text-amber-200/80 uppercase">
              Est. job total
            </p>
            <p className="mt-1 text-4xl font-black text-amber-300 tabular-nums drop-shadow-sm">
              ${subtotal.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-white/60">
              {lineItems.length === 0
                ? 'No line items yet'
                : `${lineItems.length} line item${lineItems.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        {isConverted ? (
          <div className="relative mt-5 rounded-xl border border-violet-300/40 bg-violet-500/15 p-3 text-sm text-violet-100">
            <p className="font-semibold">Converted to a service appointment.</p>
            <Button
              variant="link"
              className="h-auto p-0 text-violet-200"
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

      {/* ── Street View ──────────────────────────────────────────── */}
      <StreetViewCard address={serviceAddress} />

      {/* ── Contact Information ───────────────────────────────────── */}
      <Card className="space-y-4 p-6">
        <SectionTitle
          icon={<User className="h-4 w-4" />}
          tone="emerald"
          title="Contact information"
          subtitle="Who we're measuring for and how to reach them"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">First name</Label>
            <Input
              value={contactFirstName}
              onChange={(e) => setContactFirstName(e.target.value)}
              placeholder="First name"
            />
          </div>
          <div>
            <Label className="text-xs">Last name</Label>
            <Input
              value={contactLastName}
              onChange={(e) => setContactLastName(e.target.value)}
              placeholder="Last name"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Business name (optional)</Label>
            <Input
              value={contactBusiness}
              onChange={(e) => setContactBusiness(e.target.value)}
              placeholder="Business name"
            />
          </div>
          <div>
            <Label className="text-xs">Phone</Label>
            <Input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+1XXXXXXXXXX"
            />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="customer@example.com"
            />
          </div>
          <div>
            <Label htmlFor="estimate-lead-source" className="text-xs">
              How did they hear about us? *
            </Label>
            <select
              id="estimate-lead-source"
              className={`border-input bg-background focus-visible:ring-ring mt-1 h-9 w-full rounded-md border px-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none ${
                leadSource ? '' : 'border-amber-400/70'
              }`}
              value={leadSource}
              onChange={(e) => {
                setLeadSource(e.target.value)
                setLeadSourceDetail('')
              }}
            >
              <option value="">— Select source —</option>
              {leadSourceOptions.map((option) => (
                <option key={option.key} value={option.value}>
                  {option.customer_label}
                </option>
              ))}
            </select>
          </div>
          {selectedLeadSource?.requires_detail ? (
            <div>
              <Label htmlFor="estimate-lead-source-detail" className="text-xs">
                {selectedLeadSource.detail_label || 'Lead source detail'} *
              </Label>
              <Input
                id="estimate-lead-source-detail"
                value={leadSourceDetail}
                onChange={(e) => setLeadSourceDetail(e.target.value)}
              />
            </div>
          ) : null}
        </div>
        {isPlaceholderName ? (
          <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
            This estimate still has the placeholder name. Replace it with the
            customer or business name before scheduling or sending anything.
          </p>
        ) : null}

        {/* Quick action buttons when contact info exists */}
        {contactPhone ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="gap-2 bg-emerald-600 font-semibold text-white hover:bg-emerald-500"
              asChild
            >
              <a href={`tel:${contactPhone}`}>
                <Phone className="h-4 w-4" />
                Call
              </a>
            </Button>
            <Button
              size="sm"
              className="gap-2 bg-sky-600 font-semibold text-white hover:bg-sky-500"
              asChild
            >
              <a href={`sms:${contactPhone}`}>
                <MessageSquare className="h-4 w-4" />
                Text
              </a>
            </Button>
            {contactEmail ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-2 border-amber-400/60 font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-500/10"
                asChild
              >
                <a href={`mailto:${contactEmail}`}>
                  <Mail className="h-4 w-4" />
                  Email
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* ── Service Address ───────────────────────────────────────── */}
      <Card className="space-y-4 p-6">
        <SectionTitle
          icon={<MapPin className="h-4 w-4" />}
          tone="sky"
          title="Service address"
          subtitle="Where the measuring visit happens"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">Street</Label>
            <Input
              value={addrStreet1}
              onChange={(e) => setAddrStreet1(e.target.value)}
              placeholder="123 Main St"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Street 2 (apt, suite, etc.)</Label>
            <Input
              value={addrStreet2}
              onChange={(e) => setAddrStreet2(e.target.value)}
              placeholder="Apt, Suite, Unit"
            />
          </div>
          <div>
            <Label className="text-xs">City</Label>
            <Input
              value={addrCity}
              onChange={(e) => setAddrCity(e.target.value)}
              placeholder="City"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">State</Label>
              <Input
                value={addrState}
                onChange={(e) => setAddrState(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Zip</Label>
              <Input
                value={addrZip}
                onChange={(e) => setAddrZip(e.target.value)}
                placeholder="80xxx"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Gate code</Label>
            <Input
              value={addrGateCode}
              onChange={(e) => setAddrGateCode(e.target.value)}
              placeholder="Gate / access code"
            />
          </div>
        </div>
        {serviceAddress ? <DirectionsButtons address={serviceAddress} /> : null}
      </Card>

      {/* ── Schedule ────────────────────────────────────────────────── */}
      <Card className="space-y-4 p-6">
        <SectionTitle
          icon={<CalendarClock className="h-4 w-4" />}
          tone="amber"
          title="Measuring visit"
          subtitle="When we swing by with the tape measure"
        />
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

        {/* Schedule Estimate — saves + sends booking confirmation to customer */}
        {!isConverted ? (
          <div className="border-border/60 border-t border-dashed pt-4">
            <Button
              className="h-12 w-full gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-base font-bold text-white shadow-md hover:from-emerald-500 hover:to-emerald-400"
              disabled={scheduleEmailSending || !contactEmail || !readyToSend}
              onClick={() => void handleSendEmail('booking_confirmation')}
            >
              {scheduleEmailSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : scheduleEmailSent ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <CalendarCheck className="h-4 w-4" />
              )}
              {scheduleEmailSending
                ? 'Saving & sending…'
                : scheduleEmailSent
                  ? 'Confirmation sent!'
                  : 'Schedule Estimate'}
            </Button>
            {notReadyReason ? (
              <p className="mt-1.5 text-center text-xs text-amber-600">
                {notReadyReason}
              </p>
            ) : !contactEmail ? (
              <p className="mt-1.5 text-center text-xs text-amber-600">
                Add a customer email above to send the booking confirmation.
              </p>
            ) : (
              <p className="text-muted-foreground mt-1.5 text-center text-xs">
                Saves your changes and emails the customer their appointment
                details.
              </p>
            )}
          </div>
        ) : null}
      </Card>

      {/* ── Line items ──────────────────────────────────────────────── */}
      <Card className="p-4 md:p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <SectionTitle
            icon={<Ruler className="h-4 w-4" />}
            tone="violet"
            title="Line items"
            subtitle={
              <>
                Pick a category, tap a service to add a line, then use{' '}
                <span className="font-medium">+ Add L×W</span> to stack floor
                areas on that line. Totals add automatically.
              </>
            }
          />
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1"
            onClick={handleAddCustomLine}
          >
            <Plus className="h-4 w-4" />
            Custom line (no catalog)
          </Button>
        </div>

        <div className="border-border/60 mt-4 rounded-lg border bg-slate-50/80 p-3 dark:bg-slate-900/40">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,200px),1fr]">
            <div>
              <Label className="text-xs">Category</Label>
              <select
                className="border-input bg-background focus-visible:ring-ring mt-1 h-9 w-full rounded-md border px-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
                value={linePickerCategory || catalogCategories[0] || ''}
                onChange={(e) => setLinePickerCategory(e.target.value)}
              >
                {catalogCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Add from catalog (tap to add)</Label>
              <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                {servicesInPickerCategory.length === 0 ? (
                  <p className="text-muted-foreground p-3 text-xs">
                    No services in this category.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {servicesInPickerCategory.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="hover:bg-muted flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                          onClick={() => handleAddServiceFromCatalog(item)}
                        >
                          <span className="line-clamp-2">{item.name}</span>
                          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            {item.base_price != null
                              ? `$${Number(item.base_price).toFixed(2)}`
                              : '—'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>

        {lineItems.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">
            No lines yet. Choose a category above and tap a service, or add a
            custom line.
          </p>
        ) : null}

        <div className="mt-4 space-y-4">
          {lineItems.map((line, idx) => {
            const unit = line.pricing_unit_snapshot
            const showDimensions = supportsDimensions(unit)
            const lineQty = showDimensions
              ? derivedQuantityFromSegments(line.area_segments, unit)
              : toNumber(line.quantity, 1)
            const segNumeric = segmentRowsToAreaSegments(line.area_segments)
            const segmentsSummary =
              showDimensions && segNumeric.length > 0
                ? describeSegmentsSummary(segNumeric, unit)
                : null

            return (
              <div
                key={line.id}
                className="border-border/60 rounded-lg border p-3 md:p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-muted-foreground text-xs font-medium">
                    Line {idx + 1}
                    {line.service_catalog_item_id ? ' · catalog' : ' · custom'}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1"
                      onClick={() => handleDuplicateLine(line.id)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Duplicate
                    </Button>
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
                </div>

                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <Label className="text-xs">Service</Label>
                      <select
                        className="border-input bg-background focus-visible:ring-ring mt-1 h-9 w-full rounded-md border px-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
                        value={line.service_catalog_item_id || ''}
                        onChange={(e) =>
                          handleSelectCatalogItem(line.id, e.target.value)
                        }
                      >
                        <option value="">
                          — Custom (manual name &amp; price) —
                        </option>
                        {catalog.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Name on proposal</Label>
                      <Input
                        className="mt-1"
                        value={line.name_snapshot}
                        onChange={(e) =>
                          updateLine(line.id, {
                            name_snapshot: e.target.value,
                          })
                        }
                        placeholder="Defaults from catalog; edit if needed"
                      />
                    </div>
                  </div>

                  {showDimensions ? (
                    <div className="rounded-md border border-amber-200/80 bg-amber-50/50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
                          {isAreaUnit(unit)
                            ? 'Floor areas (ft × ft → sqft)'
                            : 'Runs (ft; add rows for each run)'}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 border-amber-300 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
                          onClick={() =>
                            updateLine(line.id, {
                              area_segments: [
                                ...line.area_segments,
                                {
                                  clientId: makeRowKey(),
                                  length: '',
                                  width: '',
                                },
                              ],
                            })
                          }
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add L×W
                        </Button>
                      </div>
                      {line.area_segments.length === 0 ? (
                        <p className="text-muted-foreground mt-2 text-xs">
                          Tap <strong>+ Add L×W</strong> to enter length and
                          width for the first area. Use the same button to add
                          more rectangles; square footage adds up for this
                          service.
                        </p>
                      ) : (
                        <ul className="mt-3 space-y-2">
                          {line.area_segments.map((seg, sidx) => (
                            <li
                              key={seg.clientId}
                              className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950"
                            >
                              <span className="text-muted-foreground w-8 pb-2 text-xs">
                                #{sidx + 1}
                              </span>
                              <div className="grid flex-1 grid-cols-2 gap-2 sm:max-w-xs">
                                <div>
                                  <Label className="text-[10px]">
                                    Length (ft)
                                  </Label>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.5"
                                    value={seg.length}
                                    onChange={(e) => {
                                      const next = line.area_segments.map(
                                        (s) =>
                                          s.clientId === seg.clientId
                                            ? {
                                                ...s,
                                                length: e.target.value,
                                              }
                                            : s,
                                      )
                                      updateLine(line.id, {
                                        area_segments: next,
                                      })
                                    }}
                                    placeholder="0"
                                  />
                                </div>
                                <div>
                                  <Label className="text-[10px]">
                                    {isLinearUnit(unit)
                                      ? 'Width (optional)'
                                      : 'Width (ft)'}
                                  </Label>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.5"
                                    value={seg.width}
                                    onChange={(e) => {
                                      const next = line.area_segments.map(
                                        (s) =>
                                          s.clientId === seg.clientId
                                            ? {
                                                ...s,
                                                width: e.target.value,
                                              }
                                            : s,
                                      )
                                      updateLine(line.id, {
                                        area_segments: next,
                                      })
                                    }}
                                    placeholder="0"
                                  />
                                </div>
                              </div>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9 shrink-0 text-rose-600"
                                title="Remove this area"
                                onClick={() =>
                                  updateLine(line.id, {
                                    area_segments: line.area_segments.filter(
                                      (s) => s.clientId !== seg.clientId,
                                    ),
                                  })
                                }
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {segmentsSummary ? (
                        <p className="text-muted-foreground mt-2 text-xs font-medium">
                          {segmentsSummary}
                        </p>
                      ) : null}
                      <p className="text-muted-foreground mt-1 text-xs">
                        Billable{' '}
                        {isAreaUnit(unit)
                          ? 'sqft'
                          : isLinearUnit(unit)
                            ? 'linear ft'
                            : 'qty'}
                        :{' '}
                        <span className="text-foreground font-semibold tabular-nums">
                          {lineQty.toFixed(2)}
                        </span>{' '}
                        × ${toNumber(line.unit_price, 0).toFixed(2)} = $
                        {(lineQty * toNumber(line.unit_price, 0)).toFixed(2)}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <Label className="text-xs">Quantity</Label>
                        <Input
                          className="mt-1"
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
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">Unit price</Label>
                      <Input
                        className="mt-1"
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        value={line.unit_price}
                        onChange={(e) =>
                          updateLine(line.id, { unit_price: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Duration (min)</Label>
                      <Input
                        className="mt-1"
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
                </div>

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
                    placeholder="Explain in detail what you're doing and why. Example: Running CRB pre-scrub to lift matted fibers in the traffic lane, then hot water extraction with enzyme pre-spray for the pet area by the front door."
                    className="min-h-[80px]"
                  />
                </div>

                <div className="text-muted-foreground mt-2 flex justify-end text-xs tabular-nums">
                  Line total: $
                  {(lineQty * toNumber(line.unit_price, 0)).toFixed(2)}
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
      <Card className="flex flex-wrap items-center gap-2 border-t-4 border-t-emerald-500 p-4 shadow-md">
        <Button
          onClick={() => void handleSave()}
          disabled={saving}
          className="gap-2 bg-emerald-600 font-semibold text-white hover:bg-emerald-500"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save changes'}
        </Button>

        {!isConverted ? (
          <>
            {/* Send Quote — appears when there are line items and a customer email */}
            {lineItems.length > 0 && contactEmail ? (
              <Button
                className="gap-2 bg-sky-600 font-semibold text-white hover:bg-sky-500"
                disabled={quoteEmailSending || !readyToSend}
                title={notReadyReason ?? undefined}
                onClick={() => void handleSendEmail('quote')}
              >
                {quoteEmailSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : quoteEmailSent ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {quoteEmailSending
                  ? 'Sending quote…'
                  : quoteEmailSent
                    ? 'Quote sent!'
                    : 'Send Quote'}
              </Button>
            ) : null}

            {statusKey !== 'sent' ? (
              <Button
                variant="outline"
                className="border-sky-400/60 text-sky-700 hover:bg-sky-50 hover:text-sky-800 dark:text-sky-300 dark:hover:bg-sky-500/10"
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
                className="border-emerald-400/60 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
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
                className="gap-2 bg-amber-400 font-bold text-slate-950 shadow-md hover:bg-amber-300"
                disabled={lineItems.length === 0 || !readyToSend}
                title={notReadyReason ?? undefined}
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

        {/* Delete button - always visible for cleanup */}
        <Button
          variant="destructive"
          className="gap-2"
          disabled={actionLoading !== null}
          onClick={() => void handleDelete()}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </Card>

      {emailError ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Email error: {emailError}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {/* ── Convert dialog ──────────────────────────────────────────── */}
      {showConvertDialog ? (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4"
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
