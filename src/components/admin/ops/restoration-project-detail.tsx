'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Droplets,
  Loader2,
  Mic,
  Phone,
  Plus,
  Trash2,
  Wind,
  CheckCircle2,
  MessageSquare,
  Camera,
  FileText,
  Ruler,
  MapPin,
  CalendarDays,
  DollarSign,
  Mail,
  Truck,
  X,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { DirectionsButtons } from '@/components/ops/directions-buttons'
import {
  hoursSince,
  warningsForLoss,
} from '@/lib/ops/restoration-material-guidance'
import {
  buildDryingPlan,
  type AirflowDensity,
  type LossClass,
} from '@/lib/ops/restoration-drying-plan'
import { GROUP_ORDER } from '@/lib/ops/restoration-catalog-groups'
import {
  WallPlan,
  type PlanPin,
  type WallPlanTool,
} from '@/components/ops/wall-plan'
import type {
  PlanNode,
  PlanWall,
  WallOpening,
} from '@/lib/ops/restoration-walls'
import { CustomerContact } from '@/components/ops/customer-contact'
import { LineCandidateRow } from '@/components/ops/line-candidate-row'
import { dryingDaysFromVisits } from '@/lib/ops/restoration-daily-billing'
import {
  moistureBand,
  defaultDryStandard,
  BAND_LABEL,
} from '@/lib/ops/restoration-moisture'
import { SignatureModal } from '@/components/admin/ops/signature-modal'
import { nextVisitAction, type VisitStatus } from '@/lib/ops/arrival'
import { captureDateFor } from '@/lib/ops/exif-capture-date'
import { downscaleImage } from '@/lib/ops/downscale-image'
import { StreetViewCard } from '@/components/ops/street-view-card'
import { DryingChart } from '@/components/ops/drying-chart'
import {
  AirReadingsCard,
  type AirReading,
} from '@/components/ops/air-readings-card'
import { EquipmentPinEditor } from '@/components/ops/equipment-pin-editor'
import { grainsPerPound } from '@/lib/ops/restoration-psychrometry'
import {
  readingForVisit,
  visitIsFuture,
} from '@/lib/ops/restoration-visit-scope'
import { positionForVisit } from '@/lib/ops/restoration-equipment-position'
import { LOSS_SOURCES } from '@/lib/ops/restoration-loss-sources'
import { noteTextFor, noteIsDirty } from '@/lib/ops/restoration-note-scope'
import {
  equipmentLedger,
  ledgerBatches,
  ledgerAsOf,
  placementsAsOf,
} from '@/lib/ops/restoration-equipment-ledger'

/**
 * The restoration project screen.
 *
 * Day 1 (mitigation) is the heavy screen: intake, line items, equipment, deposit.
 * Monitor days are deliberately light — readings and little else — because they
 * are fifteen minutes of work and a drive, done one-handed on a phone.
 */

type Line = {
  id: string
  name_snapshot: string
  quantity: number
  unit_price: number
  line_total: number
  restoration_catalog_code: string | null
  pricing_unit_snapshot: string | null
}

type Visit = {
  id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  visit_type: 'mitigation' | 'monitor' | 'final' | null
  visit_sequence: number | null
  completed_at: string | null
  restoration_visit_note: string | null
  ops_appointment_line_items: Line[]
}

type ReadingPoint = {
  id: string
  label: string
  material: string | null
  dry_standard: number | null
  map_x: number | null
  map_y: number | null
  area_id: string | null
  restoration_readings: Array<{
    id: string
    value: number
    taken_at: string
    appointment_id: string | null
  }>
}

type Detail = {
  project: {
    id: string
    status: string
    water_category: number | null
    loss_class: number | null
    after_hours_call: boolean
    source_of_loss: string | null
    cause_narrative: string | null
    loss_date: string | null
    loss_time: string | null
    estimate_signed_at: string | null
    estimate_signed_name: string | null
    estimate_signature_url: string | null
    estimate_sent_at: string | null
    estimate_copied_at: string | null
    acknowledged_warnings: string[] | null
    deductible: number | null
    deductible_credit: number | null
    invoice_id: string | null
    ops_customers: {
      id: string
      full_name: string
      business_name: string | null
      phone: string
      email: string | null
    } | null
    ops_service_addresses: {
      id: string
      street_1: string
      street_2: string | null
      city: string
      state: string
      zip_code: string
      gate_code: string | null
    } | null
  }
  visits: Visit[]
  queue: Array<{
    id: string
    visit_type: string
    visit_sequence: number | null
    status: string
  }>
  equipment: Array<{
    id: string
    catalog_code: string
    placed_at: string
    removed_at: string | null
    placed_on: string
    removed_on: string | null
    area_id: string | null
    map_x: number | null
    map_y: number | null
  }>
  equipment_positions: Array<{
    placement_id: string
    appointment_id: string
    map_x: number | null
    map_y: number | null
    visit_date: string | null
    moved_at: string
  }>
  equipment_billing: Array<{
    catalog_code: string
    description: string
    unit_price: number
    units: number
    unit_days: number
    line_total: number
  }>
  reading_points: ReadingPoint[]
  air_readings: AirReading[]
  estimate_lines: Array<{
    id: string
    name_snapshot: string
    quantity: number
    units: number | null
    days: number | null
    unit_price: number
    line_total: number
    unit: string | null
  }>
  areas: Array<{
    id: string
    name: string
    affected_sqft: number | null
    wall_linear_ft: number | null
    ceiling_height_ft: number | null
    affected_wall_ceiling_sqft: number | null
    insets_offsets: number | null
    geometry: { length_ft?: number; width_ft?: number } | null
    plan_x: number | null
    plan_y: number | null
    points: Array<{ x: number; y: number }> | null
  }>
  openings: Array<{
    id: string
    area_id: string
    kind: string
    wall_index: number
    offset_ft: number
    width_ft: number
  }>
  payments: Array<{
    id: string
    kind: string
    method: string
    amount_cents: number
  }>
  photos: Array<{
    id: string
    public_url: string
    restoration_phase: string | null
    appointment_id: string
  }>
  totals: {
    work: number
    equipment: number
    gross_subtotal: number
    deductible_credit: number
    subtotal: number
    paid_cents: number
    balance_cents: number
  }
}

type CatalogItem = {
  concept_code: string
  label: string
  code: string
  unit: string
  unit_price: number
  billable: boolean
  daily: boolean
  group: string
}

type ParsedLine = {
  conceptCode: string
  label: string
  code: string
  unit: string
  unitPrice: number
  quantity: number | null
  daily: boolean
  days: number | null
  heard: string
  confidence: 'high' | 'low'
}

/** Local calendar day, matching how appointment_date is stored. */
function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** The standard arc of a water-loss file, which is also how the report is organised. */
const PHOTO_PHASES = [
  { value: 'arrival', label: 'Arrival' },
  { value: 'source_of_loss', label: 'Source' },
  { value: 'affected_materials', label: 'Affected' },
  { value: 'moisture_reading', label: 'Readings' },
  { value: 'equipment_placement', label: 'Equipment' },
  { value: 'demo', label: 'Demo' },
  { value: 'completion', label: 'Complete' },
]

/**
 * One accent system for the whole screen.
 *
 * Water losses are sky/teal throughout — the same colour as the calendar block —
 * with amber reserved for a wet reading and green for one that has hit its dry
 * standard. Semantic colour stays semantic: it never gets spent on decoration,
 * so when something is amber on this screen it always means "not dry yet".
 */
const SECTION_CARD =
  'border-border/60 bg-card/80 relative overflow-hidden p-5 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-sky-500/70'
const SECTION_TITLE = 'flex items-center gap-2 text-lg font-semibold'
const SECTION_ICON = 'h-4 w-4 text-sky-600 dark:text-sky-400'
const PANEL_HEAD =
  'bg-sky-50 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200 px-3 py-2 text-xs'
const ACTION_BUTTON = 'bg-sky-600 text-white hover:bg-sky-500'

const MATERIALS = [
  'Drywall',
  'Subfloor',
  'Framing',
  'Hardwood',
  'Concrete',
  'Insulation',
  'Plaster',
  'Tile',
  'Cabinet',
  'Trim',
]

/**
 * The four pieces of equipment Charles actually runs. Everything else in the
 * catalog is still addable by hand from the line-item picker; these are the
 * quick buttons, and there are four because there are four.
 *
 * The glyph goes on the map pin — four identical blue dots tell you nothing
 * about what is sitting in the room.
 */
const EQUIPMENT_CODES = [
  { code: 'DRY', label: 'Air mover', glyph: 'AM' },
  { code: 'DHM>>', label: 'Large dehu', glyph: 'LG' },
  { code: 'DHM>', label: 'Small dehu', glyph: 'SM' },
  { code: 'NAFAN', label: 'Air scrubber', glyph: 'AS' },
]

export function equipmentGlyph(code: string): string {
  return EQUIPMENT_CODES.find((e) => e.code === code)?.glyph ?? '◈'
}

export function RestorationProjectDetail({
  projectId,
  visitId,
}: {
  projectId: string
  /**
   * Which visit to open on. The admin screen passes this in the URL; the tech
   * portal renders the component directly for the visit the tech tapped, so it
   * has no query string to put it in.
   */
  visitId?: string
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [activeVisitId, setActiveVisitId] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [openGroup, setOpenGroup] = useState<string | null>(null)

  const [estimateOpen, setEstimateOpen] = useState(false)
  const [estimateTranscript, setEstimateTranscript] = useState('')
  const [estimateProposed, setEstimateProposed] = useState<ParsedLine[]>([])
  const [estimateUnmatched, setEstimateUnmatched] = useState<string[]>([])
  const [estimateQuery, setEstimateQuery] = useState('')
  const [estimateEmail, setEstimateEmail] = useState('')
  const [estimatePhone, setEstimatePhone] = useState('')
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)

  // Move leads and is the default. Every other tool draws or places something,
  // and having Wall lead meant walls got drawn across a finished plan while
  // trying to reach a reading point on a phone.
  const [planTool, setPlanTool] = useState<WallPlanTool>('move')
  // Common sizes, so the usual case is one tap and anything else is one edit.
  const [openingKind, setOpeningKind] = useState<'doorway' | 'window'>(
    'doorway',
  )
  const [openingWidth, setOpeningWidth] = useState(3)
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(
    null,
  )
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(
    null,
  )
  const [placeCount, setPlaceCount] = useState('1')
  const [recordedAmount, setRecordedAmount] = useState('')
  const [recordedMethod, setRecordedMethod] = useState('square_other')
  const [planData, setPlanData] = useState<{
    nodes: PlanNode[]
    walls: PlanWall[]
    openings: WallOpening[]
  }>({ nodes: [], walls: [], openings: [] })
  const [airflowDensity, setAirflowDensity] = useState<AirflowDensity>('normal')
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null)
  const [armedTool, setArmedTool] = useState<{
    kind: 'equipment' | 'reading'
    label: string
    code?: string
  } | null>(null)

  const [areaName, setAreaName] = useState('')
  const [areaLength, setAreaLength] = useState('')
  const [areaWidth, setAreaWidth] = useState('')
  const [areaHeight, setAreaHeight] = useState('8')

  const [depositAmount, setDepositAmount] = useState('1000')
  const [finalPaymentAmount, setFinalPaymentAmount] = useState('')
  const [checkAmount, setCheckAmount] = useState('')

  const [photoPhase, setPhotoPhase] = useState<string>('affected_materials')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{
    done: number
    total: number
  } | null>(null)

  /** ?visit=<id> — which visit the calendar sent us to. */
  const searchVisitId = useSearchParams().get('visit')
  const requestedVisitId = visitId ?? searchVisitId

  const [pointLabel, setPointLabel] = useState('')
  const [pointMaterial, setPointMaterial] = useState('Drywall')
  const [pointGoal, setPointGoal] = useState('')

  const [transcript, setTranscript] = useState('')
  /**
   * The note being edited, tagged with the visit it belongs to.
   *
   * Held as loose state it leaked: drafting today's note and then opening
   * yesterday's showed today's text, because the draft outlived the visit it
   * was written for. Carrying the id means a note can only ever be shown
   * against the day it was written for.
   */
  const [noteEdit, setNoteEdit] = useState<{
    visitId: string
    text: string
  } | null>(null)
  const [noteTranscript, setNoteTranscript] = useState<{
    visitId: string
    text: string
  } | null>(null)
  /** Null until Charles opens or closes the work card himself on this screen. */
  const [workOpenOverride, setWorkOpenOverride] = useState<boolean | null>(null)
  const [proposed, setProposed] = useState<ParsedLine[]>([])
  const [unmatched, setUnmatched] = useState<string[]>([])

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/admin/ops/restoration/projects/${projectId}/detail`,
        { cache: 'no-store' },
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to load')
      setDetail(result)
      setActiveVisitId((current) => {
        if (current && result.visits.some((v: Visit) => v.id === current))
          return current

        // The visit that was clicked to get here. Arriving from the calendar on
        // today's monitor and landing on the mitigation day means readings and
        // photos file to the wrong day unless you notice and change it.
        const asked = requestedVisitId
        if (asked && result.visits.some((v: Visit) => v.id === asked))
          return asked

        // Otherwise today's visit, then the first still open.
        const today = toDateKey(new Date())
        const todays = result.visits.find(
          (v: Visit) =>
            v.appointment_date === today && v.status !== 'completed',
        )
        const open = result.visits.find((v: Visit) => v.status !== 'completed')
        return (todays ?? open ?? result.visits[0])?.id ?? null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [projectId, requestedVisitId])

  const loadPlan = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/admin/ops/restoration/projects/${projectId}/walls`,
        { cache: 'no-store' },
      )
      if (!response.ok) return
      const result = await response.json()
      setPlanData({
        nodes: (result.nodes ?? []).map(
          (n: { id: string; x: string; y: string }) => ({
            id: n.id,
            x: Number(n.x),
            y: Number(n.y),
          }),
        ),
        walls: (result.walls ?? []).map(
          (w: {
            id: string
            start_node_id: string
            end_node_id: string
            is_partial_height: boolean
            label: string | null
          }) => ({
            id: w.id,
            startNodeId: w.start_node_id,
            endNodeId: w.end_node_id,
            isPartialHeight: w.is_partial_height,
            label: w.label,
          }),
        ),
        openings: (result.openings ?? []).map(
          (o: {
            id: string
            wall_id: string
            kind: string
            offset_ft: string
            width_ft: string
          }) => ({
            id: o.id,
            wallId: o.wall_id,
            kind: o.kind as WallOpening['kind'],
            offsetFt: Number(o.offset_ft),
            widthFt: Number(o.width_ft),
          }),
        ),
      })
    } catch {
      // The plan is additive; a failure must not break the screen.
    }
  }, [projectId])

  useEffect(() => {
    void load()
    void loadPlan()
  }, [load, loadPlan])

  // A selection that outlived its door leaves a Delete button that deletes
  // nothing, which reads as the delete being broken.
  useEffect(() => {
    if (!selectedOpeningId) return
    if (!planData.openings.some((o) => o.id === selectedOpeningId)) {
      setSelectedOpeningId(null)
    }
  }, [planData.openings, selectedOpeningId])

  // Contact details come from the customer record, editable in case the person
  // standing there wants it sent somewhere else.
  useEffect(() => {
    const customer = detail?.project.ops_customers
    if (!customer) return
    setEstimateEmail((current) => current || customer.email || '')
    setEstimatePhone((current) => current || customer.phone || '')
  }, [detail])

  const project = detail?.project
  const category = project?.water_category ?? 1
  const afterHours = Boolean(project?.after_hours_call)

  useEffect(() => {
    if (!project) return
    const params = new URLSearchParams({
      category: String(category),
      after_hours: String(afterHours),
      q: catalogQuery,
    })
    let cancelled = false
    const timer = setTimeout(async () => {
      const response = await fetch(
        `/api/admin/ops/restoration/catalog?${params}`,
        {
          cache: 'no-store',
        },
      )
      const result = await response.json()
      if (!cancelled && response.ok) setCatalog(result.items ?? [])
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [project, category, afterHours, catalogQuery])

  const activeVisit = useMemo(
    () => detail?.visits.find((v) => v.id === activeVisitId) ?? null,
    [detail, activeVisitId],
  )
  const isMitigation = activeVisit?.visit_type === 'mitigation'

  const balanceDueDollars = useMemo(() => {
    const cents = detail?.totals.balance_cents ?? 0
    return cents > 0 ? (cents / 100).toFixed(2) : ''
  }, [detail?.totals.balance_cents])

  // Final-payment fields default to the live balance, so "collect what's
  // owed" is a single tap — but only while the customer hasn't edited them,
  // since a balance that drops mid-typing shouldn't clobber a partial amount.
  useEffect(() => {
    if (!balanceDueDollars) return
    setFinalPaymentAmount((prev) => (prev ? prev : balanceDueDollars))
    setCheckAmount((prev) => (prev ? prev : balanceDueDollars))
  }, [balanceDueDollars])

  const dryingPlan = useMemo(
    () =>
      buildDryingPlan(
        (detail?.areas ?? []).map((area) => ({
          name: area.name,
          affectedSqft: area.affected_sqft,
          ceilingHeightFt: area.ceiling_height_ft,
          affectedWallCeilingSqft: area.affected_wall_ceiling_sqft,
          insetsOffsets: area.insets_offsets,
        })),
        {
          lossClass: (detail?.project.loss_class ?? 2) as LossClass,
          dehuType: 'lgr',
          density: airflowDensity,
        },
      ),
    [detail, airflowDensity],
  )
  /** What the next unnamed point will be called, matching the server's rule. */
  const nextPointNumber = useMemo(() => {
    const highest = (detail?.reading_points ?? []).reduce((max, point) => {
      const asNumber = Number(String(point.label ?? '').trim())
      return Number.isInteger(asNumber) && asNumber > max ? asNumber : max
    }, 0)
    return highest + 1
  }, [detail?.reading_points])

  /**
   * The work card is open on a work day and collapsed on a monitor, until
   * Charles says otherwise on this screen. Most monitors add no work at all.
   */
  const workOpen = useMemo(() => {
    if (workOpenOverride != null) return workOpenOverride
    const visit = detail?.visits.find((v) => v.id === activeVisitId) ?? null
    return visit?.visit_type !== 'monitor'
  }, [workOpenOverride, detail?.visits, activeVisitId])

  /** True when the visit being viewed has not been worked yet. */
  const activeVisitNotYet = useMemo(() => {
    const visit = detail?.visits.find((v) => v.id === activeVisitId) ?? null
    return visitIsFuture(visit, toDateKey(new Date()))
  }, [detail?.visits, activeVisitId])

  /** The day being viewed, which scopes every reading on the screen. */
  const activeVisitDate = useMemo(
    () =>
      detail?.visits.find((v) => v.id === activeVisitId)?.appointment_date ??
      null,
    [detail?.visits, activeVisitId],
  )

  /**
   * The per-unit arithmetic behind each equipment line, as of the visit being
   * viewed — so stepping back through the days shows the cost climbing, which
   * is the shape of a drying job and was invisible when every day showed today's
   * total.
   */
  const ledgerMoment = useMemo(
    () => ledgerAsOf(activeVisitDate, toDateKey(new Date())),
    [activeVisitDate],
  )
  const ledger = useMemo(
    () =>
      equipmentLedger(
        placementsAsOf(detail?.equipment ?? [], ledgerMoment),
        ledgerMoment,
      ),
    [detail?.equipment, ledgerMoment],
  )
  /** The same units, grouped by the days they share, so a batch edits at once. */
  const batches = useMemo(
    () =>
      ledgerBatches(
        placementsAsOf(detail?.equipment ?? [], ledgerMoment),
        ledgerMoment,
      ),
    [detail?.equipment, ledgerMoment],
  )

  const ledgerTotal = useMemo(() => {
    const priceByCode = new Map(
      (detail?.equipment_billing ?? []).map((row) => [
        row.catalog_code,
        Number(row.unit_price),
      ]),
    )
    return ledger.reduce(
      (sum, line) => sum + line.unitDays * (priceByCode.get(line.code) ?? 0),
      0,
    )
  }, [ledger, detail?.equipment_billing])

  const planPins = useMemo<PlanPin[]>(() => {
    const pins: PlanPin[] = []
    for (const placement of detail?.equipment ?? []) {
      // Where this unit stood on the visit being viewed. Unlike a reading, a
      // fan nobody moved is still where it was, so an unmoved visit inherits
      // the last position before it.
      const at = positionForVisit(
        placement,
        detail?.equipment_positions ?? [],
        {
          id: activeVisitId,
          appointment_date: activeVisitDate,
        },
      )
      pins.push({
        id: placement.id,
        kind: 'equipment',
        label: placement.catalog_code,
        glyph: equipmentGlyph(placement.catalog_code),
        // Dehus are boxes on the floor; air movers are points.
        shape: placement.catalog_code.startsWith('DHM') ? 'box' : 'dot',
        xFt: at.x,
        yFt: at.y,
        removed: Boolean(placement.removed_at),
      })
    }
    for (const point of detail?.reading_points ?? []) {
      const history = [...point.restoration_readings].sort(
        (a, b) =>
          new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime(),
      )
      // What was read ON this visit. Nothing is carried forward: a day nobody
      // worked has no readings, and showing the previous day's numbers on it
      // makes a visit that has not happened look done.
      const latest = readingForVisit(point.restoration_readings, activeVisitId)
      pins.push({
        id: point.id,
        kind: 'reading',
        label: point.label,
        xFt: point.map_x,
        yFt: point.map_y,
        value: latest ? Number(latest.value) : null,
        // Green / amber / red against this point's own dry standard, falling
        // back to the material's usual one so a pin is coloured from the first
        // reading rather than staying grey until somebody fills in a number.
        band: moistureBand(
          latest ? Number(latest.value) : null,
          point.dry_standard ?? defaultDryStandard(point.material),
        ),
      })
    }
    return pins
  }, [detail, activeVisitId, activeVisitDate])

  const selectedPoint = useMemo(
    () => detail?.reading_points.find((p) => p.id === selectedPointId) ?? null,
    [detail, selectedPointId],
  )

  // Safety conditions that change how the job is run, surfaced rather than
  // buried: contaminated water means no fans yet, and past 48 hours the
  // dry-in-place guidance no longer applies.
  const lossWarnings = useMemo(() => {
    if (!detail?.project) return []
    const lossAt = detail.project.loss_date
      ? `${detail.project.loss_date}T${detail.project.loss_time ?? '00:00'}`
      : null
    return warningsForLoss({
      waterCategory: detail.project.water_category,
      hoursSinceLoss: hoursSince(lossAt),
      acknowledged: detail.project.acknowledged_warnings,
    })
  }, [detail])

  const estimateTotal = useMemo(
    () =>
      Math.round(
        (detail?.estimate_lines ?? []).reduce(
          (sum, l) => sum + Number(l.line_total),
          0,
        ) * 100,
      ) / 100,
    [detail],
  )

  const catalogResults = catalog
  const groupedCatalog = useMemo(() => {
    const map = new Map<string, CatalogItem[]>()
    for (const item of catalog) {
      const list = map.get(item.group)
      if (list) list.push(item)
      else map.set(item.group, [item])
    }
    return map
  }, [catalog])

  const totalPerimeterFt = useMemo(
    () =>
      Math.round(
        (detail?.areas ?? []).reduce(
          (sum, a) => sum + Number(a.wall_linear_ft ?? 0),
          0,
        ) * 100,
      ) / 100,
    [detail],
  )

  async function call(url: string, init: RequestInit, key: string) {
    setBusy(key)
    setError(null)
    try {
      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Request failed')
      await load()
      return result
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
      return null
    } finally {
      setBusy(null)
    }
  }

  /**
   * How long equipment is quoted to run. It goes in on the mitigation day and
   * comes out on the last monitor, so the monitor count is the answer — and it
   * is only ever a starting number, because the box is editable.
   */
  /** The most recent affected-area reading — the air a dehu is actually fed. */
  const latestAffectedGpp = useMemo(() => {
    const latest = (detail?.air_readings ?? [])
      .filter(
        (r) => r.role === 'affected' && r.temp_f != null && r.rh_pct != null,
      )
      .sort(
        (a, b) =>
          new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime(),
      )[0]
    return latest
      ? grainsPerPound(Number(latest.temp_f), Number(latest.rh_pct))
      : null
  }, [detail?.air_readings])

  const selectedEquipment = useMemo(
    () => detail?.equipment.find((e) => e.id === selectedEquipmentId) ?? null,
    [detail?.equipment, selectedEquipmentId],
  )

  const quotedDryingDays = useMemo(
    () => dryingDaysFromVisits(detail?.visits ?? []),
    [detail?.visits],
  )

  /** Pre-fill from what was measured: area for SF work, perimeter for LF work. */
  function suggestedQuantity(unit: string): number {
    if (unit === 'SF' && dryingPlan.totalAffectedSqft > 0)
      return dryingPlan.totalAffectedSqft
    if (unit === 'LF' && totalPerimeterFt > 0) return totalPerimeterFt
    return 1
  }

  async function addEstimateLines(
    lines: Array<{
      concept_code: string
      quantity: number | null
      units?: number
      days?: number
    }>,
  ) {
    if (lines.length === 0) return
    await call(
      `/api/admin/ops/restoration/projects/${projectId}/estimate`,
      { method: 'POST', body: JSON.stringify({ lines }) },
      'add-estimate',
    )
  }

  async function addFromCatalog(item: CatalogItem, quantity: number) {
    await addLines([
      {
        concept_code: item.concept_code,
        quantity: quantity > 0 ? quantity : 1,
      },
    ])
  }

  async function addLines(
    lines: Array<{ concept_code: string; quantity: number | null }>,
  ) {
    if (!activeVisitId || lines.length === 0) return
    await call(
      `/api/admin/ops/restoration/visits/${activeVisitId}/line-items`,
      { method: 'POST', body: JSON.stringify({ lines }) },
      'add-lines',
    )
  }

  async function runParse() {
    if (!transcript.trim()) return
    setBusy('parse')
    setError(null)
    try {
      const response = await fetch('/api/admin/ops/restoration/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, transcript }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not read that')
      setProposed(result.lines ?? [])
      setUnmatched(result.unmatched ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading project…
      </div>
    )
  }
  if (!detail || !project) {
    return <div className="p-6 text-sm">{error ?? 'Project not found.'}</div>
  }

  const address = project.ops_service_addresses
  const customer = project.ops_customers
  const runningEquipment = detail.equipment.filter((e) => !e.removed_at)
  const closed = project.status === 'closed'

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-28">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Droplets className="h-5 w-5 text-sky-600" />
            <h1 className="text-2xl font-semibold">
              {customer?.business_name || customer?.full_name || 'Water loss'}
            </h1>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={category === 3 ? 'destructive' : 'secondary'}>
              Category {category}
            </Badge>
            {afterHours ? <Badge variant="outline">After hours</Badge> : null}
            <Badge variant={closed ? 'secondary' : 'default'}>
              {closed ? 'Closed' : 'Active'}
            </Badge>
            <select
              aria-label="Source of loss"
              className="border-input bg-background h-7 rounded-md border px-2 text-xs"
              value={project.source_of_loss ?? ''}
              onChange={(e) =>
                void call(
                  `/api/admin/ops/restoration/projects/${projectId}`,
                  {
                    method: 'PATCH',
                    body: JSON.stringify({ source_of_loss: e.target.value }),
                  },
                  'source-of-loss',
                )
              }
            >
              <option value="" disabled>
                Source of loss
              </option>
              {LOSS_SOURCES.map((source) => (
                <option key={source.value} value={source.value}>
                  {source.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <CustomerContact phone={customer?.phone} className="min-w-64" />
      </div>

      {/*
        Pinned to the bottom of the screen rather than the top of the page.
        This screen is several thousand pixels long and the work happens far
        down it — an error banner at the top is one Charles scrolled past
        without seeing, while a reading he had just taken quietly failed to
        save. A message about something that just went wrong has to appear
        where the thing that went wrong is.
      */}
      {error ? (
        <div
          role="alert"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-lg sm:inset-x-6"
        >
          <div className="border-destructive/40 bg-destructive text-destructive-foreground flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg">
            <span className="min-w-0 flex-1">{error}</span>
            <button
              type="button"
              aria-label="Dismiss"
              className="shrink-0 opacity-80 hover:opacity-100"
              onClick={() => setError(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {lossWarnings.map((warning) => (
        <Card
          key={warning.key}
          className={`p-4 text-sm ${
            warning.severity === 'critical'
              ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
              : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
          }`}
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            {warning.title}
          </p>
          <p className="mt-1">{warning.detail}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs opacity-70">
              {warning.source} · internal only
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() =>
                void call(
                  `/api/admin/ops/restoration/projects/${projectId}`,
                  {
                    method: 'PATCH',
                    body: JSON.stringify({
                      acknowledge_warning: warning.key,
                    }),
                  },
                  `ack-${warning.key}`,
                )
              }
            >
              Got it
            </Button>
          </div>
        </Card>
      ))}

      {address ? (
        <Card className={SECTION_CARD}>
          <h2 className={`${SECTION_TITLE} mb-2`}>
            <MapPin className={SECTION_ICON} /> Service address
          </h2>
          <p className="text-sm">
            {address.street_1}
            {address.street_2 ? `, ${address.street_2}` : ''}
          </p>
          <p className="text-muted-foreground mb-3 text-sm">
            {address.city}, {address.state} {address.zip_code}
          </p>
          {address.gate_code ? (
            <p className="text-muted-foreground mb-3 text-xs">
              Gate: {address.gate_code}
            </p>
          ) : null}
          <DirectionsButtons address={address} />
        </Card>
      ) : null}

      <StreetViewCard address={address} />

      {/* ── Estimate ───────────────────────────────────────── */}
      <Card className={SECTION_CARD}>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          onClick={() => setEstimateOpen((open) => !open)}
        >
          <span>
            <span className={SECTION_TITLE}>
              <FileText className={SECTION_ICON} /> Estimate
            </span>
            <span className="text-muted-foreground mt-1 block text-sm">
              {estimateTotal > 0
                ? `${detail.estimate_lines.length} line${
                    detail.estimate_lines.length === 1 ? '' : 's'
                  } · ${money(estimateTotal)}`
                : 'What it is going to cost — the first thing they ask.'}
            </span>
          </span>
          <span className="text-muted-foreground text-xs">
            {estimateOpen
              ? 'Hide'
              : estimateTotal > 0
                ? 'Open'
                : 'Give estimate'}
          </span>
        </button>

        {estimateOpen ? (
          <div className="mt-4 flex flex-col gap-3">
            <Label
              htmlFor="estimate-dictate"
              className="flex items-center gap-2"
            >
              <Mic className="h-4 w-4" /> Say what you expect to do
            </Label>
            <Textarea
              id="estimate-dictate"
              rows={2}
              value={estimateTranscript}
              onChange={(e) => setEstimateTranscript(e.target.value)}
              placeholder="extract 400 square feet of carpet, remove pad, 4 foot flood cut 60 feet, dump fee, 3 monitors"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className={`${ACTION_BUTTON} gap-2`}
                disabled={
                  busy === 'estimate-parse' || !estimateTranscript.trim()
                }
                onClick={async () => {
                  setBusy('estimate-parse')
                  setError(null)
                  try {
                    const response = await fetch(
                      '/api/admin/ops/restoration/parse',
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          project_id: projectId,
                          transcript: estimateTranscript,
                        }),
                      },
                    )
                    const result = await response.json()
                    if (!response.ok)
                      throw new Error(result.error || 'Could not read that')
                    setEstimateProposed(result.lines ?? [])
                    setEstimateUnmatched(result.unmatched ?? [])
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : 'Could not read that',
                    )
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                {busy === 'estimate-parse' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
                Scan
              </Button>
              {estimateProposed.length > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await addEstimateLines(
                      estimateProposed.map((p) => {
                        // "Eight fans" heard on equipment is eight units, and
                        // the days come from the schedule unless they were
                        // spoken — never from the unit count.
                        if (p.daily) {
                          const units = p.quantity ?? 1
                          const days = p.days ?? quotedDryingDays
                          return {
                            concept_code: p.conceptCode,
                            quantity: units * days,
                            units,
                            days,
                          }
                        }
                        return {
                          concept_code: p.conceptCode,
                          quantity: p.quantity ?? suggestedQuantity(p.unit),
                        }
                      }),
                    )
                    setEstimateProposed([])
                    setEstimateUnmatched([])
                    setEstimateTranscript('')
                  }}
                >
                  Add all {estimateProposed.length}
                </Button>
              ) : null}
            </div>

            {estimateProposed.length > 0 ? (
              <div className="border-border/60 overflow-hidden rounded-md border">
                <div
                  className={`${PANEL_HEAD} flex items-center justify-between gap-2`}
                >
                  <span>
                    Priced for Category {category}
                    {afterHours ? ', after hours' : ''}. Set a quantity and add.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEstimateProposed([])
                      setEstimateUnmatched([])
                    }}
                  >
                    Clear
                  </button>
                </div>
                {estimateProposed.map((line, index) => (
                  <LineCandidateRow
                    key={`${line.code}-${index}`}
                    code={line.code}
                    label={line.label}
                    unit={line.unit}
                    unitPrice={line.unitPrice}
                    daily={line.daily}
                    defaultDays={line.days ?? quotedDryingDays}
                    defaultQuantity={
                      line.quantity ??
                      (line.daily ? 1 : suggestedQuantity(line.unit))
                    }
                    onAdd={async (quantity, parts) => {
                      await addEstimateLines([
                        { concept_code: line.conceptCode, quantity, ...parts },
                      ])
                      setEstimateProposed((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }}
                    onDismiss={() =>
                      setEstimateProposed((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  />
                ))}
                {estimateUnmatched.length > 0 ? (
                  <p className="text-muted-foreground border-border/60 border-t px-3 py-2 text-xs">
                    Couldn&apos;t match: {estimateUnmatched.join(', ')}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor="estimate-search">Add by hand</Label>
              <Input
                id="estimate-search"
                value={estimateQuery}
                onChange={(e) => setEstimateQuery(e.target.value)}
                placeholder="extraction, flood cut, pad…"
              />
              {estimateQuery.trim().length > 1 ? (
                <div className="border-border/60 max-h-64 overflow-y-auto rounded-md border">
                  {catalog
                    .filter(
                      (item) =>
                        item.label
                          .toLowerCase()
                          .includes(estimateQuery.trim().toLowerCase()) ||
                        item.code
                          .toLowerCase()
                          .includes(estimateQuery.trim().toLowerCase()),
                    )
                    .slice(0, 30)
                    .map((item) => (
                      <LineCandidateRow
                        key={item.concept_code}
                        code={item.code}
                        label={item.label}
                        unit={item.unit}
                        unitPrice={item.unit_price}
                        billable={item.billable}
                        daily={item.daily}
                        defaultDays={quotedDryingDays}
                        defaultQuantity={
                          item.daily ? 1 : suggestedQuantity(item.unit)
                        }
                        onAdd={(quantity, parts) =>
                          addEstimateLines([
                            {
                              concept_code: item.concept_code,
                              quantity,
                              ...parts,
                            },
                          ])
                        }
                      />
                    ))}
                </div>
              ) : null}
            </div>

            {detail.estimate_lines.length > 0 ? (
              <div className="flex flex-col divide-y">
                {detail.estimate_lines.map((line) => (
                  <div
                    key={line.id}
                    className="flex items-center gap-2 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1">{line.name_snapshot}</span>
                    {line.units != null ? (
                      // Equipment keeps the two numbers it was quoted with, so a
                      // day added or a fan pulled is one edit, not mental
                      // arithmetic redone against a bare 24.
                      <>
                        <Input
                          className="h-8 w-14 text-right"
                          type="number"
                          min={0}
                          step="any"
                          aria-label="How many"
                          defaultValue={Number(line.units)}
                          onBlur={(e) => {
                            const units = Number(e.target.value)
                            if (units > 0 && units !== Number(line.units)) {
                              void call(
                                `/api/admin/ops/restoration/estimate-lines/${line.id}`,
                                {
                                  method: 'PATCH',
                                  body: JSON.stringify({ units }),
                                },
                                `est-${line.id}`,
                              )
                            }
                          }}
                        />
                        <span className="text-muted-foreground text-xs">×</span>
                        <Input
                          className="h-8 w-14 text-right"
                          type="number"
                          min={0}
                          step="any"
                          aria-label="Days"
                          defaultValue={Number(line.days ?? 1)}
                          onBlur={(e) => {
                            const days = Number(e.target.value)
                            if (days > 0 && days !== Number(line.days ?? 1)) {
                              void call(
                                `/api/admin/ops/restoration/estimate-lines/${line.id}`,
                                {
                                  method: 'PATCH',
                                  body: JSON.stringify({ days }),
                                },
                                `est-${line.id}`,
                              )
                            }
                          }}
                        />
                        <span className="text-muted-foreground w-10 text-xs">
                          days
                        </span>
                      </>
                    ) : (
                      <>
                        <Input
                          className="h-8 w-20 text-right"
                          type="number"
                          min={0}
                          step="any"
                          aria-label="Quantity"
                          defaultValue={Number(line.quantity)}
                          onBlur={(e) => {
                            const quantity = Number(e.target.value)
                            if (
                              quantity > 0 &&
                              quantity !== Number(line.quantity)
                            ) {
                              void call(
                                `/api/admin/ops/restoration/estimate-lines/${line.id}`,
                                {
                                  method: 'PATCH',
                                  body: JSON.stringify({ quantity }),
                                },
                                `est-${line.id}`,
                              )
                            }
                          }}
                        />
                        <span className="text-muted-foreground w-10 text-xs">
                          {line.unit}
                        </span>
                      </>
                    )}
                    {/*
                      The rate is editable because some of a water loss is
                      bought rather than performed: hired demolition labor costs
                      whatever that contractor charges. The catalog price is the
                      starting number.
                    */}
                    <label className="flex items-center gap-1">
                      <span className="text-muted-foreground text-xs">@</span>
                      <Input
                        className="h-8 w-20 text-right"
                        type="number"
                        min={0}
                        step="any"
                        aria-label="Rate"
                        defaultValue={Number(line.unit_price)}
                        onBlur={(e) => {
                          const unitPrice = Number(e.target.value)
                          if (
                            unitPrice > 0 &&
                            unitPrice !== Number(line.unit_price)
                          ) {
                            void call(
                              `/api/admin/ops/restoration/estimate-lines/${line.id}`,
                              {
                                method: 'PATCH',
                                body: JSON.stringify({ unit_price: unitPrice }),
                              },
                              `est-${line.id}`,
                            )
                          }
                        }}
                      />
                    </label>
                    <span className="w-20 text-right font-medium">
                      {money(Number(line.line_total))}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove estimate line"
                      onClick={() =>
                        void call(
                          `/api/admin/ops/restoration/estimate-lines/${line.id}`,
                          { method: 'DELETE' },
                          `est-del-${line.id}`,
                        )
                      }
                    >
                      <Trash2 className="text-muted-foreground h-4 w-4" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 text-base font-semibold">
                  <span>Estimate total</span>
                  <span className="text-sky-700 tabular-nums dark:text-sky-300">
                    {money(estimateTotal)}
                  </span>
                </div>
              </div>
            ) : null}

            {detail.estimate_lines.length > 0 && !closed ? (
              <Button
                variant="outline"
                className="w-full gap-2"
                disabled={busy === 'copy-estimate'}
                onClick={() =>
                  void call(
                    `/api/admin/ops/restoration/projects/${projectId}/estimate`,
                    { method: 'PUT', body: JSON.stringify({}) },
                    'copy-estimate',
                  )
                }
              >
                <Plus className="h-4 w-4" />
                {detail.project.estimate_copied_at
                  ? 'Copy to the work again'
                  : 'Start the work from this estimate'}
              </Button>
            ) : null}

            {detail.estimate_lines.length > 0 ? (
              <div className="border-border/60 flex flex-col gap-2 border-t pt-3">
                <Label className="text-sm">Send it to them</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    className="h-9 min-w-48 flex-1"
                    type="email"
                    aria-label="Send estimate to email"
                    placeholder="email"
                    value={estimateEmail}
                    onChange={(e) => setEstimateEmail(e.target.value)}
                  />
                  <Input
                    className="h-9 min-w-36 flex-1"
                    type="tel"
                    aria-label="Send estimate to phone"
                    placeholder="phone"
                    value={estimatePhone}
                    onChange={(e) => setEstimatePhone(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className={ACTION_BUTTON}
                    disabled={busy === 'send-estimate'}
                    onClick={async () => {
                      setBusy('send-estimate')
                      setSendResult(null)
                      setError(null)
                      try {
                        const response = await fetch(
                          `/api/admin/ops/restoration/projects/${projectId}/estimate/send`,
                          {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              email: true,
                              sms: true,
                              to_email: estimateEmail || null,
                              to_phone: estimatePhone || null,
                            }),
                          },
                        )
                        const result = await response.json()
                        if (!response.ok)
                          throw new Error(result.error || 'Could not send')
                        setSendResult(
                          [
                            result.sent.length > 0
                              ? `Sent by ${result.sent.join(' and ')}`
                              : 'Nothing sent',
                            ...(result.skipped ?? []),
                          ].join(' · '),
                        )
                        await load()
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : 'Could not send',
                        )
                      } finally {
                        setBusy(null)
                      }
                    }}
                  >
                    {busy === 'send-estimate' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                    Send estimate
                  </Button>

                  {detail.project.estimate_signed_at ? (
                    <span className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      Signed by {detail.project.estimate_signed_name}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSignatureOpen(true)}
                    >
                      Get signature
                    </Button>
                  )}
                </div>

                {detail.project.estimate_sent_at ? (
                  <p className="text-muted-foreground text-xs">
                    Last sent{' '}
                    {new Date(detail.project.estimate_sent_at).toLocaleString()}
                  </p>
                ) : null}
                {sendResult ? (
                  <p className="text-muted-foreground text-xs">{sendResult}</p>
                ) : null}
                {detail.project.estimate_signed_at ? (
                  <p className="text-muted-foreground text-xs">
                    Signed estimates are locked. Changes go on the work below.
                  </p>
                ) : null}
              </div>
            ) : null}

            <SignatureModal
              isOpen={signatureOpen}
              onClose={() => setSignatureOpen(false)}
              totalAmount={estimateTotal}
              customerName={
                detail.project.ops_customers?.business_name ||
                detail.project.ops_customers?.full_name ||
                ''
              }
              onSave={async (signatureData, customerName) => {
                await call(
                  `/api/admin/ops/restoration/projects/${projectId}/estimate/signature`,
                  {
                    method: 'POST',
                    body: JSON.stringify({ signatureData, customerName }),
                  },
                  'estimate-signature',
                )
                setSignatureOpen(false)
              }}
            />
          </div>
        ) : null}
      </Card>

      {/* ── Visits ─────────────────────────────────────────── */}
      <Card className={SECTION_CARD}>
        <h2 className={`${SECTION_TITLE} mb-3`}>
          <CalendarDays className={SECTION_ICON} /> Visits
        </h2>
        <div className="flex flex-col gap-2">
          {detail.visits.map((visit) => (
            <button
              key={visit.id}
              type="button"
              onClick={() => setActiveVisitId(visit.id)}
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
                visit.id === activeVisitId
                  ? 'border-primary bg-primary/5'
                  : 'border-border/60 hover:bg-muted/50'
              }`}
            >
              <span>
                <span className="font-medium capitalize">
                  {visit.visit_type}
                </span>
                <span className="text-muted-foreground">
                  {' '}
                  ·{' '}
                  {new Date(
                    `${visit.appointment_date}T12:00:00`,
                  ).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}{' '}
                  {visit.start_time.slice(0, 5)}
                </span>
                {visit.id === activeVisitId ? (
                  // Picking a visit is what decides the day readings and photos
                  // are filed under, and that was doing its work silently.
                  <span className="mt-0.5 block text-xs text-sky-700 dark:text-sky-300">
                    Readings and photos land on this day
                  </span>
                ) : null}
              </span>
              <Badge
                variant={visit.status === 'completed' ? 'secondary' : 'outline'}
              >
                {visit.status}
              </Badge>
            </button>
          ))}
          {detail.queue.filter((q) => q.status === 'queued').length > 0 ? (
            <p className="text-muted-foreground mt-1 text-xs">
              {detail.queue.filter((q) => q.status === 'queued').length} monitor
              visit(s) waiting in the tray — place them from the schedule.
            </p>
          ) : null}

          {/*
            Three monitors is the starting guess, not a promise. A closet that
            stalls or a customer who unplugged the equipment means a fourth, and
            there was no way to add one. It joins the tray rather than the
            calendar, because a monitor gets fitted around cleaning work by hand.
          */}
          {!closed ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-1 gap-2"
              disabled={busy === 'add-monitor'}
              onClick={() =>
                void call(
                  `/api/admin/ops/restoration/projects/${projectId}/queue`,
                  { method: 'POST', body: JSON.stringify({}) },
                  'add-monitor',
                )
              }
            >
              <Plus className="h-4 w-4" /> Add another monitor visit
            </Button>
          ) : null}
        </div>
      </Card>

      {activeVisit && !closed ? (
        <Card className={SECTION_CARD}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className={SECTION_TITLE}>
                <Truck className={SECTION_ICON} />
                <span className="capitalize">
                  {activeVisit.visit_type}
                </span>{' '}
                visit
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {activeVisit.appointment_date} at{' '}
                {activeVisit.start_time.slice(0, 5)} ·{' '}
                {activeVisit.status.replace(/_/g, ' ')}
              </p>
            </div>
            {(() => {
              const action = nextVisitAction(activeVisit.status as VisitStatus)
              if (!action) return null
              return (
                <Button
                  size="lg"
                  className={ACTION_BUTTON}
                  disabled={busy === 'visit-status'}
                  onClick={() =>
                    void call(
                      `/api/admin/ops/appointments/${activeVisit.id}`,
                      {
                        method: 'PATCH',
                        body: JSON.stringify({ status: action.status }),
                      },
                      'visit-status',
                    )
                  }
                >
                  {busy === 'visit-status' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {action.label}
                </Button>
              )
            })()}
          </div>
          {activeVisit.status === 'booked' ||
          activeVisit.status === 'confirmed' ? (
            <p className="text-muted-foreground mt-2 text-xs">
              On My Way texts the customer that you are heading over.
            </p>
          ) : null}

          {/*
            A monitor visit is thirty minutes of readings. Walking it through
            on-my-way, start work, finish visit is three taps to record that
            nothing happened worth three taps — and leaving it on "on my way"
            afterwards is what actually occurs. One button closes it from
            wherever it got stuck.

            It texts the customer what was done and that the equipment stays
            running, which is the question somebody with fans in their basement
            actually has. Said on the button, because a control that sends a
            message should say so before it is pressed.
          */}
          {activeVisit.status !== 'completed' &&
          activeVisit.status !== 'cancelled' ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full gap-2"
              disabled={busy === 'close-visit'}
              onClick={() =>
                void call(
                  `/api/admin/ops/restoration/visits/${activeVisit.id}/close`,
                  { method: 'POST', body: JSON.stringify({}) },
                  'close-visit',
                )
              }
            >
              {busy === 'close-visit' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Close this visit
            </Button>
          ) : null}
          {activeVisit.status !== 'completed' &&
          activeVisit.status !== 'cancelled' ? (
            <p className="text-muted-foreground mt-1 text-center text-xs">
              Texts the customer that the visit is done and the equipment keeps
              running.
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* ── Affected areas ─────────────────────────────────── */}
      {!closed ? (
        <Card className={SECTION_CARD}>
          <h2 className={`${SECTION_TITLE} mb-1`}>
            <Ruler className={SECTION_ICON} /> Affected areas
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Measure once. Square footage fills the line items, and the volume
            sizes the drying equipment.
          </p>

          {detail.areas.length > 0 ? (
            <div className="mb-3 flex flex-col divide-y">
              {detail.areas.map((area) => (
                <div
                  key={area.id}
                  className="flex flex-wrap items-center gap-2 py-2 text-sm"
                >
                  <Input
                    className="h-9 min-w-32 flex-1"
                    aria-label="Room name"
                    defaultValue={area.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim()
                      if (name && name !== area.name) {
                        void call(
                          `/api/admin/ops/restoration/areas/${area.id}`,
                          { method: 'PATCH', body: JSON.stringify({ name }) },
                          `area-${area.id}`,
                        )
                      }
                    }}
                  />
                  {(
                    [
                      ['affected_sqft', 'SF', area.affected_sqft],
                      ['wall_linear_ft', 'LF', area.wall_linear_ft],
                      ['ceiling_height_ft', 'ceil', area.ceiling_height_ft],
                      [
                        'affected_wall_ceiling_sqft',
                        'wall SF',
                        area.affected_wall_ceiling_sqft,
                      ],
                      ['insets_offsets', 'insets', area.insets_offsets],
                    ] as const
                  ).map(([field, label, value]) => (
                    <label key={field} className="flex items-center gap-1">
                      <Input
                        className="h-9 w-20 text-right"
                        type="number"
                        step="any"
                        aria-label={`${area.name} ${label}`}
                        defaultValue={value ?? ''}
                        onBlur={(e) => {
                          const next =
                            e.target.value === ''
                              ? null
                              : Number(e.target.value)
                          if (next !== (value ?? null)) {
                            void call(
                              `/api/admin/ops/restoration/areas/${area.id}`,
                              {
                                method: 'PATCH',
                                body: JSON.stringify({ [field]: next }),
                              },
                              `area-${area.id}`,
                            )
                          }
                        }}
                      />
                      <span className="text-muted-foreground text-xs">
                        {label}
                      </span>
                    </label>
                  ))}
                  <button
                    type="button"
                    aria-label={`Remove ${area.name}`}
                    onClick={async () => {
                      await call(
                        `/api/admin/ops/restoration/areas/${area.id}`,
                        { method: 'DELETE' },
                        `del-area-${area.id}`,
                      )
                      await loadPlan()
                    }}
                  >
                    <Trash2 className="text-muted-foreground h-4 w-4" />
                  </button>
                </div>
              ))}
              <p className="text-muted-foreground py-2 text-xs">
                Every figure here is editable — measured area, wall perimeter,
                ceiling height, wet wall/ceiling above 2 ft, and insets over 18
                inches.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-32 flex-1">
              <Label htmlFor="area-name" className="text-xs">
                Room
              </Label>
              <Input
                id="area-name"
                className="h-9"
                value={areaName}
                onChange={(e) => setAreaName(e.target.value)}
                placeholder="Basement rec room"
              />
            </div>
            <div className="w-20">
              <Label htmlFor="area-len" className="text-xs">
                Length
              </Label>
              <Input
                id="area-len"
                className="h-9"
                type="number"
                step="any"
                value={areaLength}
                onChange={(e) => setAreaLength(e.target.value)}
              />
            </div>
            <div className="w-20">
              <Label htmlFor="area-wid" className="text-xs">
                Width
              </Label>
              <Input
                id="area-wid"
                className="h-9"
                type="number"
                step="any"
                value={areaWidth}
                onChange={(e) => setAreaWidth(e.target.value)}
              />
            </div>
            <div className="w-20">
              <Label htmlFor="area-hgt" className="text-xs">
                Ceiling
              </Label>
              <Input
                id="area-hgt"
                className="h-9"
                type="number"
                step="any"
                value={areaHeight}
                onChange={(e) => setAreaHeight(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={
                busy === 'add-area' ||
                !areaName.trim() ||
                !areaLength ||
                !areaWidth
              }
              onClick={async () => {
                await call(
                  `/api/admin/ops/restoration/projects/${projectId}/areas`,
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      name: areaName.trim(),
                      length_ft: Number(areaLength),
                      width_ft: Number(areaWidth),
                      ceiling_height_ft: Number(areaHeight) || 8,
                    }),
                  },
                  'add-area',
                )
                // The room is drawn as it is created, so pull the plan too.
                await loadPlan()
                setAreaName('')
                setAreaLength('')
                setAreaWidth('')
              }}
            >
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-sm">Plan</Label>
                <div className="border-border/60 flex rounded-md border p-0.5">
                  {(
                    [
                      ['move', 'Move'],
                      ['wall', 'Wall'],
                      ['resize', 'Resize'],
                      ['corner', 'Corner'],
                      ['door', 'Door'],
                      ['pin', 'Place'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setPlanTool(value)
                        if (value !== 'pin') setArmedTool(null)
                      }}
                      className={`rounded px-2 py-1 text-xs ${
                        planTool === value
                          ? 'bg-sky-600 text-white'
                          : 'text-muted-foreground hover:bg-muted/60'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {detail.areas.length > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    title="Replaces the walls generated from your measured rooms. Hand-drawn walls are left alone."
                    disabled={busy === 'seed-walls'}
                    onClick={async () => {
                      setBusy('seed-walls')
                      await fetch(
                        `/api/admin/ops/restoration/projects/${projectId}/walls`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ from_areas: true }),
                        },
                      )
                      await loadPlan()
                      setBusy(null)
                    }}
                  >
                    Redraw measured rooms
                  </Button>
                ) : null}
                {planData.walls.length > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground h-7 text-xs"
                    disabled={busy === 'clear-plan'}
                    onClick={async () => {
                      setBusy('clear-plan')
                      await fetch(
                        `/api/admin/ops/restoration/projects/${projectId}/walls`,
                        { method: 'DELETE' },
                      )
                      await loadPlan()
                      setBusy(null)
                    }}
                  >
                    Clear plan
                  </Button>
                ) : null}
              </div>

              {planTool === 'door' ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      ['doorway', 'Door'],
                      ['window', 'Window'],
                    ] as const
                  ).map(([kind, label]) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setOpeningKind(kind)}
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        openingKind === kind
                          ? kind === 'window'
                            ? 'border-cyan-400 bg-cyan-500 text-white'
                            : 'border-amber-400 bg-amber-500 text-white'
                          : 'border-border/60 hover:bg-muted/60'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  {(
                    [
                      ['Single', 3],
                      ['Double', 6],
                    ] as const
                  ).map(([label, width]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setOpeningWidth(width)}
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        openingWidth === width
                          ? 'border-sky-500 bg-sky-500/15 text-sky-700 dark:text-sky-300'
                          : 'border-border/60 hover:bg-muted/60'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <label className="flex items-center gap-1">
                    <Input
                      className="h-7 w-16 text-right"
                      type="number"
                      step="any"
                      min={0.5}
                      aria-label="Opening width in feet"
                      value={openingWidth}
                      onChange={(e) =>
                        setOpeningWidth(Number(e.target.value) || 3)
                      }
                    />
                    <span className="text-muted-foreground text-xs">ft</span>
                  </label>
                  {selectedOpeningId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive h-7 text-xs"
                      onClick={async () => {
                        await fetch(
                          `/api/admin/ops/restoration/openings/${selectedOpeningId}`,
                          { method: 'DELETE' },
                        )
                        setSelectedOpeningId(null)
                        await loadPlan()
                      }}
                    >
                      <Trash2 className="mr-1 h-3 w-3" /> Delete selected
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {planTool === 'pin' ? (
                <div className="flex flex-wrap gap-1.5">
                  {armedTool ? (
                    <button
                      type="button"
                      className="rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white"
                      onClick={() => setArmedTool(null)}
                    >
                      Placing {armedTool.label} — tap the plan (cancel)
                    </button>
                  ) : (
                    <>
                      {EQUIPMENT_CODES.map((equipment) => (
                        <button
                          key={equipment.code}
                          type="button"
                          className="border-border/60 hover:bg-muted/60 rounded-full border px-2.5 py-1 text-xs"
                          onClick={() =>
                            setArmedTool({
                              kind: 'equipment',
                              label: equipment.label,
                              code: equipment.code,
                            })
                          }
                        >
                          + {equipment.label}
                        </button>
                      ))}
                      <span className="flex items-center gap-1">
                        <select
                          aria-label="Material for the next reading point"
                          className="border-input bg-background h-7 rounded-full border px-2 text-xs"
                          value={pointMaterial}
                          onChange={(e) => setPointMaterial(e.target.value)}
                        >
                          {MATERIALS.map((material) => (
                            <option key={material} value={material}>
                              {material}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="rounded-full border border-amber-400 px-2.5 py-1 text-xs text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
                          onClick={() =>
                            setArmedTool({
                              kind: 'reading',
                              label: `${pointMaterial} point`,
                            })
                          }
                        >
                          + Reading point
                        </button>
                      </span>
                    </>
                  )}
                </div>
              ) : null}
            </div>

            {/*
              Which visit everything on this screen is being recorded against.
              It was invisible, and readings default to whichever visit is open
              — so Sunday's monitor readings went onto the mitigation day
              without a word. A reading is dated by its visit, so this line is
              also the date that will appear in the report.
            */}
            {activeVisit && !closed ? (
              <div className="border-border/60 bg-muted/30 mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs">
                <span className="text-muted-foreground">Recording against</span>
                <select
                  aria-label="Visit these readings belong to"
                  className="border-input bg-background h-7 rounded-md border px-2 text-xs"
                  value={activeVisitId ?? ''}
                  onChange={(e) => setActiveVisitId(e.target.value)}
                >
                  {detail.visits.map((visit) => (
                    <option key={visit.id} value={visit.id}>
                      {visit.visit_type === 'mitigation'
                        ? 'Mitigation'
                        : visit.visit_type === 'monitor'
                          ? `Monitor${visit.visit_sequence ? ` ${visit.visit_sequence}` : ''}`
                          : 'Final'}
                      {' · '}
                      {new Date(
                        `${visit.appointment_date}T12:00:00`,
                      ).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">
                  — readings and photos land on this day
                </span>
              </div>
            ) : null}

            {/*
              A visit that has not happened has no readings, and blanks on their
              own look like something failed to load. Saying so is the
              difference between an empty day and a broken screen.
            */}
            {activeVisitNotYet ? (
              <p className="border-border/60 bg-muted/30 text-muted-foreground mb-3 rounded-lg border px-3 py-2 text-xs">
                This visit has not happened yet — readings are blank because
                nobody has taken them.
              </p>
            ) : null}

            {planTool === 'pin' &&
            detail.reading_points.some(
              (p) => p.restoration_readings.length > 0,
            ) ? (
              // The colours have to say what they mean somewhere, or they are
              // just decoration on a document that goes to a carrier.
              <div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />{' '}
                  at dry standard
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />{' '}
                  still drying
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-600" /> wet
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-500" /> no
                  standard set
                </span>
              </div>
            ) : null}

            <WallPlan
              nodes={planData.nodes}
              walls={planData.walls}
              openings={planData.openings}
              pins={planPins}
              tool={planTool}
              armedPin={armedTool}
              selectedPinId={selectedPointId ?? selectedEquipmentId}
              pinEditor={
                selectedEquipment ? (
                  <EquipmentPinEditor
                    key={selectedEquipment.id}
                    equipment={selectedEquipment}
                    label={
                      EQUIPMENT_CODES.find(
                        (e) => e.code === selectedEquipment.catalog_code,
                      )?.label ?? selectedEquipment.catalog_code
                    }
                    readings={detail.air_readings}
                    busy={busy === 'dehu-outlet'}
                    roomAirGpp={latestAffectedGpp}
                    onClose={() => setSelectedEquipmentId(null)}
                    onPull={async () => {
                      await fetch(
                        `/api/admin/ops/restoration/equipment/${selectedEquipment.id}`,
                        {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            removed_at: new Date().toISOString(),
                            appointment_id: activeVisitId,
                          }),
                        },
                      )
                      await load()
                    }}
                    onLogOutlet={(reading) =>
                      // Against this unit and this visit, so two dehus on one
                      // job never get each other's numbers.
                      call(
                        `/api/admin/ops/restoration/projects/${projectId}/readings`,
                        {
                          method: 'POST',
                          body: JSON.stringify({
                            kind: 'air',
                            role: 'dehu_outlet',
                            appointment_id: activeVisitId,
                            equipment_placement_id: selectedEquipment.id,
                            location: selectedEquipment.catalog_code,
                            ...reading,
                          }),
                        },
                        'dehu-outlet',
                      )
                    }
                  />
                ) : selectedPoint ? (
                  <MapPointEditor
                    key={selectedPoint.id}
                    point={selectedPoint}
                    activeVisitId={activeVisitId}
                    visitLabel={
                      activeVisit
                        ? `${activeVisit.visit_type === 'mitigation' ? 'Mitigation' : 'Monitor'} · ${new Date(
                            `${activeVisit.appointment_date}T12:00:00`,
                          ).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}`
                        : 'No visit selected'
                    }
                    onClose={() => setSelectedPointId(null)}
                    onSave={(patch) =>
                      call(
                        `/api/admin/ops/restoration/reading-points/${selectedPoint.id}`,
                        { method: 'PATCH', body: JSON.stringify(patch) },
                        `pt-${selectedPoint.id}`,
                      )
                    }
                    onReading={(value) =>
                      call(
                        `/api/admin/ops/restoration/projects/${projectId}/readings`,
                        {
                          method: 'POST',
                          body: JSON.stringify({
                            kind: 'material',
                            reading_point_id: selectedPoint.id,
                            appointment_id: activeVisitId,
                            value,
                          }),
                        },
                        `read-${selectedPoint.id}`,
                      )
                    }
                    onEditReading={(readingId, value) =>
                      call(
                        `/api/admin/ops/restoration/readings/${readingId}`,
                        { method: 'PATCH', body: JSON.stringify({ value }) },
                        `rd-${readingId}`,
                      )
                    }
                    onRemoveReading={(readingId) =>
                      call(
                        `/api/admin/ops/restoration/readings/${readingId}`,
                        { method: 'DELETE' },
                        `rd-${readingId}`,
                      )
                    }
                    onRemove={async () => {
                      await call(
                        `/api/admin/ops/restoration/reading-points/${selectedPoint.id}`,
                        { method: 'DELETE' },
                        `pt-${selectedPoint.id}`,
                      )
                      setSelectedPointId(null)
                    }}
                  />
                ) : null
              }
              onDrawWall={async (segment) => {
                await fetch(
                  `/api/admin/ops/restoration/projects/${projectId}/walls`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(segment),
                  },
                )
                await loadPlan()
              }}
              onMoveRoom={async (moves) => {
                await fetch(
                  `/api/admin/ops/restoration/projects/${projectId}/plan-nodes`,
                  {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ moves }),
                  },
                )
                await loadPlan()
              }}
              onSetWallLength={async (_wallId, endNodeId, x, y) => {
                await fetch(
                  `/api/admin/ops/restoration/plan-nodes/${endNodeId}`,
                  {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ x, y }),
                  },
                )
                await loadPlan()
              }}
              onMoveNode={async (nodeId, x, y) => {
                await fetch(`/api/admin/ops/restoration/plan-nodes/${nodeId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ x, y }),
                })
                await loadPlan()
              }}
              onDeleteWall={async (wallId) => {
                await fetch(`/api/admin/ops/restoration/walls/${wallId}`, {
                  method: 'DELETE',
                })
                await loadPlan()
              }}
              openingKind={openingKind}
              openingWidthFt={openingWidth}
              selectedOpeningId={selectedOpeningId}
              onSelectOpening={setSelectedOpeningId}
              onPlaceDoor={async (wallId, offsetFt) => {
                await fetch(`/api/admin/ops/restoration/areas/none/openings`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    wall_id: wallId,
                    kind: openingKind,
                    offset_ft: offsetFt,
                    width_ft: openingWidth,
                  }),
                })
                await loadPlan()
              }}
              onMoveOpening={async (openingId, wallId, offsetFt) => {
                await fetch(
                  `/api/admin/ops/restoration/openings/${openingId}`,
                  {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      wall_id: wallId,
                      offset_ft: offsetFt,
                    }),
                  },
                )
                await loadPlan()
              }}
              onDeleteOpening={async (openingId) => {
                await fetch(
                  `/api/admin/ops/restoration/openings/${openingId}`,
                  {
                    method: 'DELETE',
                  },
                )
                await loadPlan()
              }}
              onDropPin={async ({ xFt, yFt }) => {
                const tool = armedTool
                if (!tool) return
                setArmedTool(null)
                if (tool.kind === 'equipment' && tool.code) {
                  await call(
                    `/api/admin/ops/restoration/projects/${projectId}/equipment`,
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        catalog_code: tool.code,
                        count: 1,
                        map_x: xFt,
                        map_y: yFt,
                      }),
                    },
                    'place-pin',
                  )
                } else {
                  await call(
                    `/api/admin/ops/restoration/projects/${projectId}/readings`,
                    {
                      method: 'PUT',
                      body: JSON.stringify({
                        label: `${pointMaterial} ${
                          (detail.reading_points.filter(
                            (p) => p.material === pointMaterial,
                          ).length ?? 0) + 1
                        }`,
                        material: pointMaterial,
                        map_x: xFt,
                        map_y: yFt,
                      }),
                    },
                    'place-pin',
                  )
                }
              }}
              onMovePin={(pinId, xFt, yFt) => {
                // The move belongs to the visit being viewed, so moving a fan
                // on Monday leaves Sunday's layout exactly as it was.
                void call(
                  `/api/admin/ops/restoration/equipment/${pinId}`,
                  {
                    method: 'PUT',
                    body: JSON.stringify({
                      appointment_id: activeVisitId,
                      map_x: xFt,
                      map_y: yFt,
                    }),
                  },
                  `move-${pinId}`,
                )
              }}
              onPinClick={(pin) => {
                if (pin.kind === 'equipment') {
                  setSelectedPointId(null)
                  setSelectedEquipmentId((current) =>
                    current === pin.id ? null : pin.id,
                  )
                  return
                }
                setSelectedEquipmentId(null)
                setSelectedPointId((current) =>
                  current === pin.id ? null : pin.id,
                )
              }}
            />
            <p className="text-muted-foreground mt-1 text-xs">
              {planTool === 'move'
                ? 'Drag to move the plan, pinch to zoom in on a point. Tap a wall to select it, then × to delete it.'
                : planTool === 'wall'
                  ? 'Drag anywhere to draw a wall — ends snap to nearby corners so rooms close. A wall that closes nothing is a pony wall. Measurements are out of the way while you draw.'
                  : planTool === 'resize'
                    ? 'Drag inside a room to move the whole thing. Tap any measurement to type an exact length.'
                    : planTool === 'corner'
                      ? 'Drag a corner — every wall meeting there follows. Tap a measurement to delete that wall.'
                      : planTool === 'door'
                        ? 'Tap a wall to place. Drag one to move it along a wall or onto another. Tap to select, then Delete selected.'
                        : 'Pick equipment or a reading point, then tap the plan.'}
            </p>
          </div>

          {dryingPlan.totalAffectedSqft > 0 ? (
            <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/40">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-sky-900 dark:text-sky-200">
                  {dryingPlan.totalAffectedSqft} SF ·{' '}
                  {dryingPlan.totalCubicFt.toLocaleString()} cu ft
                </p>
                <div className="flex items-center gap-2">
                  <Label htmlFor="loss-class" className="text-xs">
                    Class
                  </Label>
                  <select
                    id="loss-class"
                    className="border-input bg-background h-8 rounded-md border px-2 text-sm"
                    value={project.loss_class ?? 2}
                    onChange={(e) =>
                      void call(
                        `/api/admin/ops/restoration/projects/${projectId}`,
                        {
                          method: 'PATCH',
                          body: JSON.stringify({
                            loss_class: Number(e.target.value),
                          }),
                        },
                        'class',
                      )
                    }
                  >
                    {[1, 2, 3, 4].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Build-out density"
                    className="border-input bg-background h-8 rounded-md border px-2 text-sm"
                    value={airflowDensity}
                    onChange={(e) =>
                      setAirflowDensity(e.target.value as AirflowDensity)
                    }
                  >
                    <option value="open">Open</option>
                    <option value="normal">Normal</option>
                    <option value="dense">Dense</option>
                  </select>
                </div>
              </div>

              <p className="text-sky-900 dark:text-sky-200">
                <strong>{dryingPlan.airMovers} air movers</strong>
                {dryingPlan.suggestedDehu
                  ? ` · ${dryingPlan.dehuCount} × ${
                      dryingPlan.suggestedDehu === 'DHM>>' ? 'LGR' : 'small'
                    } dehumidifier`
                  : ''}
                {dryingPlan.dehumidifierPintsPerDay
                  ? ` (${dryingPlan.dehumidifierPintsPerDay} PPD needed)`
                  : ''}
              </p>

              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-sky-800 dark:text-sky-300">
                  How this was worked out
                </summary>
                <div className="text-muted-foreground mt-2 flex flex-col gap-1 text-xs">
                  {dryingPlan.perArea.map((area) => (
                    <span key={area.name}>
                      <strong>{area.name}</strong>: {area.perRoom} for the room
                      {area.forFloor > 0
                        ? ` + ${area.forFloor} for wet floor`
                        : ''}
                      {area.forWallCeiling > 0
                        ? ` + ${area.forWallCeiling} for wall/ceiling`
                        : ''}
                      {area.forInsets > 0
                        ? ` + ${area.forInsets} for insets`
                        : ''}{' '}
                      = {area.total}
                    </span>
                  ))}
                  <span>
                    Dehumidification: {dryingPlan.totalCubicFt.toLocaleString()}{' '}
                    cu ft ÷ {dryingPlan.dehuFactor ?? '—'} (LGR, Class{' '}
                    {project.loss_class ?? 2}) ={' '}
                    {dryingPlan.dehumidifierPintsPerDay ?? '—'} PPD
                  </span>
                  <span className="mt-1">
                    S500-2021 §12.5.3 and the standard dehumidification factor
                    chart. An initial recommendation — readings decide when it
                    is dry.
                  </span>
                </div>
              </details>

              {/*
                This card suggests; it does not act. It used to carry a "Place
                this equipment" button, which turned a calculation into eleven
                billing records in one tap — with nothing on screen to say where
                the number came from. The standard can recommend a count. Only
                Charles puts equipment on the job.
              */}
              <p className="text-muted-foreground mt-2 text-xs">
                A suggestion, not a placement — set what the job actually needs.
              </p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ── Work on this visit ─────────────────────────────── */}
      {activeVisit && !closed ? (
        <Card className={SECTION_CARD}>
          {/*
            Collapsed on a monitor visit. Most monitors add no work at all —
            they are readings and a look around — so this card sat open taking
            half the screen above the things that ARE used every visit. It stays
            available, because occasionally a monitor turns into demolition.
          */}
          <button
            type="button"
            className="mb-3 flex w-full items-center justify-between text-left"
            onClick={() => setWorkOpenOverride(!workOpen)}
          >
            <h2 className={SECTION_TITLE}>
              <Mic className={SECTION_ICON} /> Work ·{' '}
              <span className="capitalize">{activeVisit.visit_type}</span>
            </h2>
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">
                {money(
                  activeVisit.ops_appointment_line_items.reduce(
                    (s, l) => s + Number(l.line_total),
                    0,
                  ),
                )}
              </span>
              <span className="text-muted-foreground text-xs">
                {workOpen ? 'Hide' : 'Add work'}
              </span>
            </span>
          </button>

          {workOpen ? (
            <>
              <div className="mb-4 flex flex-col gap-2">
                <Label htmlFor="dictate" className="flex items-center gap-2">
                  <Mic className="h-4 w-4" /> Say what you did
                </Label>
                <Textarea
                  id="dictate"
                  rows={2}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="remove carpet, 4 foot flood cut, remove pad, spray antimicrobial"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className={`${ACTION_BUTTON} gap-2`}
                    disabled={busy === 'parse' || !transcript.trim()}
                    onClick={() => void runParse()}
                  >
                    {busy === 'parse' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                    Scan
                  </Button>
                  {proposed.length > 0 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === 'add-lines'}
                      onClick={async () => {
                        await addLines(
                          proposed.map((p) => ({
                            concept_code: p.conceptCode,
                            quantity: p.quantity ?? suggestedQuantity(p.unit),
                          })),
                        )
                        setProposed([])
                        setUnmatched([])
                        setTranscript('')
                      }}
                    >
                      Add all {proposed.length}
                    </Button>
                  ) : null}
                </div>

                {proposed.length > 0 ? (
                  <div className="border-border/60 mt-1 overflow-hidden rounded-md border">
                    <div
                      className={`${PANEL_HEAD} flex items-center justify-between gap-2`}
                    >
                      <p className="text-xs">
                        Priced for Category {category}
                        {afterHours ? ', after hours' : ''}. Set a quantity and
                        add.
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => {
                          setProposed([])
                          setUnmatched([])
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                    {proposed.map((line, index) => (
                      <LineCandidateRow
                        key={`${line.code}-${index}`}
                        code={line.code}
                        label={line.label}
                        unit={line.unit}
                        unitPrice={line.unitPrice}
                        // Use a spoken quantity when there was one, otherwise fall
                        // back to what the room measured out at.
                        defaultQuantity={
                          line.quantity ?? suggestedQuantity(line.unit)
                        }
                        onAdd={async (quantity) => {
                          await addLines([
                            { concept_code: line.conceptCode, quantity },
                          ])
                          setProposed((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }}
                        onDismiss={() =>
                          setProposed((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      />
                    ))}
                    {unmatched.length > 0 ? (
                      <p className="text-muted-foreground border-border/60 border-t px-3 py-2 text-xs">
                        Couldn&apos;t match: {unmatched.join(', ')}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="mb-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="catalog-search">Add by hand</Label>
                  <button
                    type="button"
                    className="text-muted-foreground text-xs underline"
                    onClick={() => setCatalogOpen((open) => !open)}
                  >
                    {catalogOpen ? 'Hide list' : 'Browse all items'}
                  </button>
                </div>
                <Input
                  id="catalog-search"
                  value={catalogQuery}
                  onChange={(e) => {
                    setCatalogQuery(e.target.value)
                    if (e.target.value.trim()) setCatalogOpen(true)
                  }}
                  placeholder="extraction, flood cut, pad…"
                />

                {catalogOpen ? (
                  <div className="border-border/60 max-h-80 overflow-hidden overflow-y-auto rounded-md border">
                    <div className={`${PANEL_HEAD} sticky top-0`}>
                      {catalogQuery.trim()
                        ? `Matching "${catalogQuery.trim()}" · priced for Category ${category}${afterHours ? ', after hours' : ''}`
                        : `Priced for Category ${category}${afterHours ? ', after hours' : ''}. Pick a group.`}
                    </div>
                    {catalogQuery.trim().length > 0 ? (
                      // Searching: a flat list is what you want, not folded groups.
                      catalogResults.length > 0 ? (
                        catalogResults
                          .slice(0, 60)
                          .map((item) => (
                            <LineCandidateRow
                              key={item.concept_code}
                              code={item.code}
                              label={item.label}
                              unit={item.unit}
                              unitPrice={item.unit_price}
                              billable={item.billable}
                              defaultQuantity={suggestedQuantity(item.unit)}
                              onAdd={(quantity) =>
                                addFromCatalog(item, quantity)
                              }
                            />
                          ))
                      ) : (
                        <p className="text-muted-foreground px-3 py-2 text-sm">
                          No match.
                        </p>
                      )
                    ) : (
                      GROUP_ORDER.filter((group) =>
                        groupedCatalog.has(group),
                      ).map((group) => {
                        const items = groupedCatalog.get(group) ?? []
                        const open = openGroup === group
                        return (
                          <div
                            key={group}
                            className="border-border/60 border-b last:border-b-0"
                          >
                            <button
                              type="button"
                              className="hover:bg-muted/50 flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium"
                              onClick={() => setOpenGroup(open ? null : group)}
                            >
                              <span className="flex items-center gap-2">
                                <span
                                  className={`text-muted-foreground text-xs transition-transform ${open ? 'rotate-90' : ''}`}
                                  aria-hidden
                                >
                                  ▸
                                </span>
                                {group}
                              </span>
                              <span className="text-muted-foreground text-xs tabular-nums">
                                {items.length}
                              </span>
                            </button>
                            {open
                              ? items.map((item) => (
                                  <LineCandidateRow
                                    key={item.concept_code}
                                    code={item.code}
                                    label={item.label}
                                    unit={item.unit}
                                    unitPrice={item.unit_price}
                                    billable={item.billable}
                                    defaultQuantity={suggestedQuantity(
                                      item.unit,
                                    )}
                                    onAdd={(quantity) =>
                                      addFromCatalog(item, quantity)
                                    }
                                  />
                                ))
                              : null}
                          </div>
                        )
                      })
                    )}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col divide-y">
                {activeVisit.ops_appointment_line_items.map((line) => (
                  <div
                    key={line.id}
                    className="flex items-center gap-2 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1">{line.name_snapshot}</span>
                    <Input
                      className="h-8 w-20 text-right"
                      type="number"
                      min={0}
                      step="any"
                      defaultValue={Number(line.quantity)}
                      onBlur={(e) => {
                        const quantity = Number(e.target.value)
                        if (
                          quantity > 0 &&
                          quantity !== Number(line.quantity)
                        ) {
                          void call(
                            `/api/admin/ops/restoration/line-items/${line.id}`,
                            {
                              method: 'PATCH',
                              body: JSON.stringify({ quantity }),
                            },
                            `qty-${line.id}`,
                          )
                        }
                      }}
                    />
                    <span className="text-muted-foreground w-10 text-xs">
                      {line.pricing_unit_snapshot}
                    </span>
                    <span className="w-20 text-right font-medium">
                      {money(Number(line.line_total))}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove line"
                      onClick={() =>
                        void call(
                          `/api/admin/ops/restoration/line-items/${line.id}`,
                          { method: 'DELETE' },
                          `del-${line.id}`,
                        )
                      }
                    >
                      <Trash2 className="text-muted-foreground h-4 w-4" />
                    </button>
                  </div>
                ))}
                {activeVisit.ops_appointment_line_items.length === 0 ? (
                  <p className="text-muted-foreground py-2 text-sm">
                    Nothing added yet.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </Card>
      ) : null}

      {/* ── Equipment ──────────────────────────────────────── */}
      {!closed ? (
        <Card className={SECTION_CARD}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className={SECTION_TITLE}>
              <Wind className={SECTION_ICON} /> Equipment
            </h2>
            <span className="text-muted-foreground text-right text-sm">
              {ledger.reduce((n, l) => n + l.running, 0)} running ·{' '}
              {money(ledgerTotal)}
              {activeVisitDate && activeVisitDate !== toDateKey(new Date()) ? (
                // Looking back at an earlier visit shows what it had cost by
                // then, not what it costs today.
                <span className="block text-xs">
                  as of{' '}
                  {new Date(`${activeVisitDate}T12:00:00`).toLocaleDateString(
                    'en-US',
                    {
                      month: 'short',
                      day: 'numeric',
                    },
                  )}
                </span>
              ) : null}
            </span>
          </div>

          {/*
            How many, then add. Setting ten fans is one action rather than ten
            taps on a phone in a wet basement — but it is still Charles's number
            and Charles's tap, which is the part that matters.
          */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              className="h-8 w-16 text-right"
              type="number"
              min={1}
              max={60}
              step={1}
              aria-label="How many to place"
              value={placeCount}
              onChange={(e) => setPlaceCount(e.target.value)}
            />
            {EQUIPMENT_CODES.map((equipment) => (
              <Button
                key={equipment.code}
                size="sm"
                variant="outline"
                className="gap-1 border-sky-500/40 text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/40"
                disabled={
                  busy === `place-${equipment.code}` ||
                  !(Number(placeCount) > 0)
                }
                onClick={() =>
                  void call(
                    `/api/admin/ops/restoration/projects/${projectId}/equipment`,
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        catalog_code: equipment.code,
                        count: Math.max(1, Math.floor(Number(placeCount) || 1)),
                        // Set down on the day being worked, not the day it was
                        // typed — equipment gets entered after the fact.
                        appointment_id: activeVisitId,
                      }),
                    },
                    `place-${equipment.code}`,
                  )
                }
              >
                <Plus className="h-3 w-3" /> {equipment.label}
              </Button>
            ))}
          </div>

          {/*
            The old row read "{units} x {unit_days / units}d", an average that
            describes no actual fan — six running two days and two pulled after
            one showed as "8 x 1.75d". And it sat beside a running count that
            disagreed with it, which is how Charles concluded the arithmetic was
            broken when it was the label.
          */}
          {detail.equipment_billing.length > 0 ? (
            <div className="flex flex-col divide-y text-sm">
              {detail.equipment_billing.map((row) => {
                const line = ledger.find((l) => l.code === row.catalog_code)
                return (
                  <div key={row.catalog_code} className="py-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <code className="text-xs">{row.catalog_code}</code>{' '}
                        {row.description}
                      </span>
                      <span className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
                        {money(Number(row.unit_price))} × {line?.unitDays ?? 0}d
                      </span>
                      <span className="w-20 text-right font-medium">
                        {money((line?.unitDays ?? 0) * Number(row.unit_price))}
                      </span>
                    </div>
                    {line ? (
                      <details className="mt-1">
                        <summary className="text-muted-foreground cursor-pointer text-xs">
                          {line.running} running
                          {line.pulled > 0 ? `, ${line.pulled} pulled` : ''} —
                          set the days these ran
                        </summary>
                        <div className="mt-2 flex flex-col gap-2">
                          {/*
                            The day equipment went in is what bills, and it is
                            the thing most often wrong: eight fans set on
                            Saturday, typed in on Monday. Editable, in batches,
                            because correcting eight fans one at a time is not
                            something anybody does twice.
                          */}
                          {batches
                            .filter((batch) => batch.code === row.catalog_code)
                            .map((batch) => (
                              <div
                                key={`${batch.placedOn}-${batch.removedOn ?? 'on'}`}
                                className="border-border/60 flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs"
                              >
                                <span className="tabular-nums">
                                  ×{batch.units}
                                </span>
                                <label className="flex items-center gap-1">
                                  <span className="text-muted-foreground">
                                    in
                                  </span>
                                  <Input
                                    className="h-7 w-32 text-xs"
                                    type="date"
                                    defaultValue={batch.placedOn}
                                    onBlur={(e) => {
                                      if (
                                        !e.target.value ||
                                        e.target.value === batch.placedOn
                                      )
                                        return
                                      void call(
                                        `/api/admin/ops/restoration/projects/${projectId}/equipment/days`,
                                        {
                                          method: 'PATCH',
                                          body: JSON.stringify({
                                            ids: batch.ids,
                                            placed_on: e.target.value,
                                          }),
                                        },
                                        `days-${batch.ids[0]}`,
                                      )
                                    }}
                                  />
                                </label>
                                <label className="flex items-center gap-1">
                                  <span className="text-muted-foreground">
                                    out
                                  </span>
                                  <Input
                                    className="h-7 w-32 text-xs"
                                    type="date"
                                    defaultValue={batch.removedOn ?? ''}
                                    onBlur={(e) => {
                                      const value = e.target.value || null
                                      if (value === batch.removedOn) return
                                      void call(
                                        `/api/admin/ops/restoration/projects/${projectId}/equipment/days`,
                                        {
                                          method: 'PATCH',
                                          body: JSON.stringify({
                                            ids: batch.ids,
                                            removed_on: value,
                                          }),
                                        },
                                        `days-${batch.ids[0]}`,
                                      )
                                    }}
                                  />
                                </label>
                                <span className="text-muted-foreground tabular-nums">
                                  {batch.days} day{batch.days === 1 ? '' : 's'}{' '}
                                  each = {batch.unitDays} unit-day
                                  {batch.unitDays === 1 ? '' : 's'}
                                </span>
                              </div>
                            ))}
                          {line.pulled > 0 ? (
                            <span className="text-muted-foreground text-xs">
                              A unit still bills for the days it ran, so pulling
                              one stops the clock rather than undoing the
                              charge.
                            </span>
                          ) : null}
                        </div>
                      </details>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}

          {runningEquipment.length > 0 ? (
            <div className="border-border/60 mt-3 border-t pt-3">
              <Label className="text-muted-foreground mb-2 block text-xs">
                Pull equipment as you take it out
              </Label>
              <div className="flex flex-col gap-1.5">
                {Object.entries(
                  runningEquipment.reduce<Record<string, string[]>>(
                    (groups, placement) => {
                      const list = groups[placement.catalog_code]
                      if (list) list.push(placement.id)
                      else groups[placement.catalog_code] = [placement.id]
                      return groups
                    },
                    {},
                  ),
                ).map(([code, ids]) => (
                  <div key={code} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <code className="font-mono text-xs text-sky-600 dark:text-sky-400">
                        {code}
                      </code>{' '}
                      <span className="text-muted-foreground">
                        {ids.length} running
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={busy === `pull-${code}`}
                      onClick={() =>
                        void call(
                          `/api/admin/ops/restoration/equipment/${ids[ids.length - 1]}`,
                          {
                            method: 'PATCH',
                            // Pulled on the day being worked, which is the day
                            // that stops the clock.
                            body: JSON.stringify({
                              appointment_id: activeVisitId,
                            }),
                          },
                          `pull-${code}`,
                        )
                      }
                    >
                      Pull 1
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground h-8"
                      disabled={busy === `pull-all-${code}`}
                      onClick={async () => {
                        for (const id of ids) {
                          await fetch(
                            `/api/admin/ops/restoration/equipment/${id}`,
                            {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                appointment_id: activeVisitId,
                              }),
                            },
                          )
                        }
                        await load()
                      }}
                    >
                      Pull all {ids.length}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ── Air readings ───────────────────────────────────── */}
      {!closed ? (
        <Card className={SECTION_CARD}>
          <h2 className={`${SECTION_TITLE} mb-1`}>
            <Wind className={SECTION_ICON} /> Air readings
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Temperature and humidity in the chamber, outside, and out of the
            dehu. Moisture meters say the material is wet; these say what the
            air is doing.
          </p>
          <AirReadingsCard
            readings={detail.air_readings}
            activeVisitId={activeVisitId}
            activeVisitDate={activeVisitDate}
            visitLabel={
              activeVisit
                ? `${activeVisit.visit_type === 'mitigation' ? 'Mitigation' : 'Monitor'} · ${new Date(
                    `${activeVisit.appointment_date}T12:00:00`,
                  ).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}`
                : 'No visit selected'
            }
            busy={busy === 'air-reading'}
            onEdit={(readingId, patch) =>
              call(
                `/api/admin/ops/restoration/air-readings/${readingId}`,
                { method: 'PATCH', body: JSON.stringify(patch) },
                `air-${readingId}`,
              )
            }
            onRemove={(readingId) =>
              call(
                `/api/admin/ops/restoration/air-readings/${readingId}`,
                { method: 'DELETE' },
                `air-${readingId}`,
              )
            }
            onLog={async (reading) => {
              // `call` returns null when the request failed, and the card
              // keeps the numbers rather than clearing them.
              const result = await call(
                `/api/admin/ops/restoration/projects/${projectId}/readings`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    kind: 'air',
                    appointment_id: activeVisitId,
                    ...reading,
                  }),
                },
                'air-reading',
              )
              return result != null
            }}
          />
        </Card>
      ) : null}

      {/* ── The day's note ─────────────────────────────────── */}
      {activeVisit && !closed ? (
        <Card className={SECTION_CARD}>
          <h2 className={`${SECTION_TITLE} mb-1`}>
            <Mic className={SECTION_ICON} /> Today&apos;s note
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Every day of a loss needs its own note — it is what a carrier reads
            to understand why the job took five days. Talk; it gets tidied.
          </p>

          {/*
            Dictate, then clean up. The model is given the day's real figures —
            the readings taken, the equipment running — so it can refer to them,
            and told it may use nothing else. It drafts into the box below rather
            than saving: a note that goes to an adjuster gets read by Charles
            first.
          */}
          <Textarea
            rows={3}
            className="mb-2"
            placeholder="Talk about the day — what you found, what you did, what still needs attention…"
            value={
              noteTranscript?.visitId === activeVisit.id
                ? noteTranscript.text
                : ''
            }
            onChange={(e) =>
              setNoteTranscript({
                visitId: activeVisit.id,
                text: e.target.value,
              })
            }
          />
          <Button
            size="sm"
            className={`${ACTION_BUTTON} mb-3 gap-2`}
            disabled={
              busy === 'note-draft' ||
              noteTranscript?.visitId !== activeVisit.id ||
              !noteTranscript.text.trim()
            }
            onClick={async () => {
              const result = await call(
                `/api/admin/ops/restoration/visits/${activeVisit.id}/note-draft`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    transcript: noteTranscript?.text ?? '',
                  }),
                },
                'note-draft',
              )
              if (result?.note) {
                setNoteEdit({ visitId: activeVisit.id, text: result.note })
                setNoteTranscript(null)
              }
            }}
          >
            {busy === 'note-draft' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
            Write it up
          </Button>

          <Label htmlFor="visit-note" className="mb-1 block">
            The note for{' '}
            {activeVisit.visit_type === 'monitor' ? 'this monitor' : 'this day'}
          </Label>
          <Textarea
            id="visit-note"
            rows={4}
            placeholder="What you saw, what moved, what still needs attention…"
            value={noteTextFor(noteEdit, activeVisit)}
            onChange={(e) =>
              setNoteEdit({ visitId: activeVisit.id, text: e.target.value })
            }
          />
          {/*
            An explicit Save. A drafted note that was never touched afterwards
            fired no blur and was never written — Charles wrote today's note,
            saw it on screen, and the database kept nothing.
          */}
          <Button
            size="sm"
            variant="outline"
            className="mt-2 gap-2"
            disabled={
              busy === 'visit-note' || !noteIsDirty(noteEdit, activeVisit)
            }
            onClick={async () => {
              await call(
                `/api/admin/ops/restoration/visits/${activeVisit.id}/note`,
                {
                  method: 'PUT',
                  body: JSON.stringify({ note: noteEdit?.text ?? '' }),
                },
                'visit-note',
              )
              setNoteEdit(null)
            }}
          >
            {busy === 'visit-note' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            {noteIsDirty(noteEdit, activeVisit) ? 'Save this note' : 'Saved'}
          </Button>
          <p className="text-muted-foreground mt-1 text-xs">
            Editable, and yours — it goes into the final report in date order.
          </p>
        </Card>
      ) : null}

      {/* ── Reading points (placed on day 1, tapped on every visit) ── */}
      {!closed ? (
        <Card className={SECTION_CARD}>
          <h2 className={`${SECTION_TITLE} mb-1`}>
            <Droplets className={SECTION_ICON} /> Material moisture readings
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Points are placed once and re-read on every monitor visit, so you
            can see a spot trending down — or stalling.
          </p>

          {/*
            One note per visit, written for whoever reads the report later.
            Readings say the numbers moved; this says the closet still smells
            and the customer moved a fan — which is how a carrier understands
            why a job took five days rather than three.
          */}
          {/*
            The chart is the one artefact that shows a carrier the job was
            worked rather than merely billed: points falling toward their
            standard over four days is an argument no invoice line makes.
          */}
          <div className="mb-4">
            <DryingChart points={detail.reading_points} />
          </div>

          <div className="flex flex-col divide-y">
            {detail.reading_points.map((point) => {
              const history = [...point.restoration_readings].sort(
                (a, b) =>
                  new Date(a.taken_at).getTime() -
                  new Date(b.taken_at).getTime(),
              )
              const latest = history[history.length - 1]
              const atGoal =
                moistureBand(
                  latest ? Number(latest.value) : null,
                  point.dry_standard ?? defaultDryStandard(point.material),
                ) === 'dry'
              return (
                <div
                  key={point.id}
                  id={`reading-point-${point.id}`}
                  className={`flex flex-col gap-2 rounded-md py-3 transition-colors ${
                    selectedPointId === point.id
                      ? 'bg-sky-50 dark:bg-sky-950/40'
                      : ''
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="h-9 min-w-40 flex-1"
                      defaultValue={point.label}
                      aria-label="Point name"
                      onBlur={(e) => {
                        const label = e.target.value.trim()
                        if (label && label !== point.label) {
                          void call(
                            `/api/admin/ops/restoration/reading-points/${point.id}`,
                            {
                              method: 'PATCH',
                              body: JSON.stringify({ label }),
                            },
                            `pt-${point.id}`,
                          )
                        }
                      }}
                    />
                    <select
                      className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                      aria-label="Material"
                      value={point.material ?? ''}
                      onChange={(e) =>
                        void call(
                          `/api/admin/ops/restoration/reading-points/${point.id}`,
                          {
                            method: 'PATCH',
                            body: JSON.stringify({
                              material: e.target.value || null,
                            }),
                          },
                          `pt-${point.id}`,
                        )
                      }
                    >
                      {MATERIALS.map((material) => (
                        <option key={material} value={material}>
                          {material}
                        </option>
                      ))}
                    </select>
                    <Input
                      className="h-9 w-24"
                      type="number"
                      step="any"
                      placeholder="goal %"
                      aria-label="Dry standard"
                      defaultValue={point.dry_standard ?? ''}
                      onBlur={(e) =>
                        void call(
                          `/api/admin/ops/restoration/reading-points/${point.id}`,
                          {
                            method: 'PATCH',
                            body: JSON.stringify({
                              dry_standard: e.target.value,
                            }),
                          },
                          `pt-${point.id}`,
                        )
                      }
                    />
                    <Input
                      className="h-9 w-20 text-right"
                      type="number"
                      step="any"
                      placeholder="%"
                      aria-label={`Reading for ${point.label}`}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        const input = e.target as HTMLInputElement
                        const value = Number(input.value)
                        if (!Number.isFinite(value) || input.value === '')
                          return
                        input.value = ''
                        void call(
                          `/api/admin/ops/restoration/projects/${projectId}/readings`,
                          {
                            method: 'POST',
                            body: JSON.stringify({
                              kind: 'material',
                              reading_point_id: point.id,
                              appointment_id: activeVisitId,
                              value,
                            }),
                          },
                          `read-${point.id}`,
                        )
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${point.label}`}
                      onClick={() =>
                        void call(
                          `/api/admin/ops/restoration/reading-points/${point.id}`,
                          { method: 'DELETE' },
                          `pt-${point.id}`,
                        )
                      }
                    >
                      <Trash2 className="text-muted-foreground h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {history.length > 0
                      ? history.map((r) => `${r.value}%`).join(' → ')
                      : 'no readings yet'}
                    {atGoal ? ' · dry' : ''}
                  </p>
                </div>
              )
            })}
            {detail.reading_points.length === 0 ? (
              <p className="text-muted-foreground py-2 text-sm">
                No points yet. Add one for each material you are drying — they
                number themselves.
              </p>
            ) : null}
          </div>

          <div className="border-border/60 mt-4 border-t pt-4">
            <Label className="mb-2 block text-sm">Add a point</Label>
            <div className="flex flex-wrap gap-2">
              {/* Blank means the next number. A name is optional, and rare. */}
              <Input
                className="h-9 min-w-40 flex-1"
                value={pointLabel}
                onChange={(e) => setPointLabel(e.target.value)}
                placeholder={`${nextPointNumber} — or type a name`}
              />
              <select
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                value={pointMaterial}
                onChange={(e) => setPointMaterial(e.target.value)}
              >
                {[
                  'Drywall',
                  'Subfloor',
                  'Framing',
                  'Hardwood',
                  'Concrete',
                  'Insulation',
                ].map((material) => (
                  <option key={material} value={material}>
                    {material}
                  </option>
                ))}
              </select>
              <Input
                className="h-9 w-24"
                type="number"
                step="any"
                value={pointGoal}
                onChange={(e) => setPointGoal(e.target.value)}
                placeholder="goal %"
              />
              <Button
                size="sm"
                className={ACTION_BUTTON}
                disabled={busy === 'add-point'}
                onClick={async () => {
                  await call(
                    `/api/admin/ops/restoration/projects/${projectId}/readings`,
                    {
                      method: 'PUT',
                      body: JSON.stringify({
                        label: pointLabel.trim(),
                        material: pointMaterial,
                        dry_standard:
                          pointGoal === '' ? null : Number(pointGoal),
                      }),
                    },
                    'add-point',
                  )
                  setPointLabel('')
                  setPointGoal('')
                }}
              >
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* ── Photos ─────────────────────────────────────────── */}
      {activeVisitId && !closed ? (
        <Card className={SECTION_CARD}>
          <h2 className={`${SECTION_TITLE} mb-1`}>
            <Camera className={SECTION_ICON} /> Photos
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Pick the phase once, then shoot as many as you need — they all land
            tagged. Uploading a backlog sorts each photo onto the visit it was
            taken on.
          </p>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {PHOTO_PHASES.map((phase) => (
              <button
                key={phase.value}
                type="button"
                onClick={() => setPhotoPhase(phase.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  photoPhase === phase.value
                    ? 'border-sky-600 bg-sky-600 text-white'
                    : 'border-border/60 hover:bg-muted/60'
                }`}
              >
                {phase.label}
              </button>
            ))}
          </div>

          <label className="border-border/60 hover:bg-muted/40 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm">
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            {uploading
              ? uploadProgress
                ? `Uploading ${uploadProgress.done + 1} of ${uploadProgress.total}…`
                : 'Uploading…'
              : 'Add photos'}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={uploading}
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length === 0 || !activeVisitId) return
                e.target.value = ''
                setUploading(true)
                setError(null)
                setUploadProgress({ done: 0, total: files.length })
                const failures: string[] = []

                for (const [index, file] of files.entries()) {
                  try {
                    // EXIF DateTimeOriginal off the ORIGINAL file, before any
                    // re-encode: a canvas drops EXIF, and that date is what
                    // sorts a backlog onto the right day.
                    const capturedAt = await captureDateFor(file)

                    // A phone photo is megabytes the server only resizes away,
                    // and a big enough one never arrives at all.
                    const upload = await downscaleImage(file)

                    const form = new FormData()
                    form.append('image', upload)
                    form.append('label', 'general')
                    form.append('restoration_phase', photoPhase)
                    if (capturedAt) {
                      form.append('captured_at', capturedAt.toISOString())
                    }
                    // Attach to the visit that happened on the day the photo was
                    // taken, so uploading a backlog sorts itself onto the right
                    // days instead of piling onto whichever visit is open.
                    const targetVisitId = capturedAt
                      ? (detail.visits.find(
                          (v) => v.appointment_date === toDateKey(capturedAt),
                        )?.id ?? activeVisitId)
                      : activeVisitId
                    const response = await fetch(
                      `/api/admin/ops/appointments/${targetVisitId}/photos`,
                      { method: 'POST', body: form },
                    )
                    if (!response.ok) {
                      const result = await response.json().catch(() => ({}))
                      throw new Error(result.error || `HTTP ${response.status}`)
                    }
                  } catch (uploadError) {
                    // One bad photo must not abandon the other nineteen.
                    failures.push(
                      `${file.name}: ${
                        uploadError instanceof Error
                          ? uploadError.message
                          : 'failed'
                      }`,
                    )
                  }
                  setUploadProgress({ done: index + 1, total: files.length })
                }

                await load()
                setUploading(false)
                setUploadProgress(null)
                if (failures.length > 0) {
                  setError(
                    `${failures.length} of ${files.length} photos did not upload — ${failures[0]}`,
                  )
                }
              }}
            />
          </label>

          {detail.photos.length > 0 ? (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {detail.photos.map((photo) => (
                <figure
                  key={photo.id}
                  className="overflow-hidden rounded-md border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.public_url}
                    alt={photo.restoration_phase ?? 'Job photo'}
                    className="h-20 w-full object-cover"
                  />
                  <figcaption className="bg-muted/40 text-muted-foreground truncate px-1.5 py-1 text-[10px]">
                    {PHOTO_PHASES.find(
                      (p) => p.value === photo.restoration_phase,
                    )?.label ?? 'Untagged'}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ── Money ──────────────────────────────────────────── */}
      <Card className={SECTION_CARD}>
        <h2 className={`${SECTION_TITLE} mb-3`}>
          <DollarSign className={SECTION_ICON} /> Money
        </h2>
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Work</span>
            <span>{money(detail.totals.work)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Equipment{' '}
              <span className="text-xs">
                — whole job to date, not the visit above
              </span>
            </span>
            <span>{money(detail.totals.equipment)}</span>
          </div>
          {/*
            What the job came to before any concession. Without it the deductible
            split appears to come off a number that is never shown, and there is
            no line to check the work and equipment add up to.
          */}
          <div className="flex justify-between border-t pt-2 font-medium">
            <span>Subtotal</span>
            <span className="tabular-nums">
              {money(detail.totals.gross_subtotal)}
            </span>
          </div>
          {/*
            Splitting the deductible is routine on an insurance job: they owe
            $1,000, and we discount $500 of our own work so they are not out of
            pocket for all of it. Half is the usual starting number and never a
            rule, so the box is prefilled and editable, and it comes off the
            bottom line rather than off any one line item.
          */}
          <div className="flex items-center justify-between gap-2 border-t pt-2">
            <span className="text-muted-foreground">
              Deductible split
              {detail.project.deductible ? (
                <span className="ml-1 text-xs">
                  (deductible {money(Number(detail.project.deductible))})
                </span>
              ) : null}
            </span>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground text-xs">−$</span>
              <Input
                className="h-8 w-24 text-right"
                type="number"
                min={0}
                step="any"
                aria-label="Deductible credit"
                placeholder={
                  detail.project.deductible
                    ? String(Number(detail.project.deductible) / 2)
                    : '0'
                }
                defaultValue={
                  detail.project.deductible_credit != null
                    ? Number(detail.project.deductible_credit)
                    : ''
                }
                disabled={closed}
                onBlur={(e) => {
                  const raw = e.target.value.trim()
                  const credit = raw === '' ? null : Number(raw)
                  if (credit != null && !(credit >= 0)) return
                  if (
                    credit === Number(detail.project.deductible_credit ?? NaN)
                  )
                    return
                  void call(
                    `/api/admin/ops/restoration/projects/${projectId}`,
                    {
                      method: 'PATCH',
                      body: JSON.stringify({ deductible_credit: credit }),
                    },
                    'deductible-credit',
                  )
                }}
              />
            </div>
          </div>

          <div className="mt-1 flex justify-between border-t pt-2 text-base font-semibold">
            <span>
              {detail.totals.deductible_credit > 0
                ? 'Customer owes'
                : 'Running total'}
            </span>
            <span className="text-sky-700 tabular-nums dark:text-sky-300">
              {money(detail.totals.subtotal)}
            </span>
          </div>
          {detail.totals.paid_cents !== 0 ? (
            <>
              {/*
                Listed individually, not just summed. The same $1,000 recorded
                twice halves what the customer is billed, and a total alone
                cannot show that it happened.
              */}
              {detail.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-muted-foreground text-xs">
                    {payment.kind} · {payment.method.replace(/_/g, ' ')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span>−{money(payment.amount_cents / 100)}</span>
                    {!closed ? (
                      <button
                        type="button"
                        aria-label="Remove this payment"
                        onClick={() =>
                          void call(
                            `/api/admin/ops/restoration/payments/${payment.id}`,
                            { method: 'DELETE' },
                            `pay-${payment.id}`,
                          )
                        }
                      >
                        <Trash2 className="text-muted-foreground h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </span>
                </div>
              ))}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid so far</span>
                <span>−{money(detail.totals.paid_cents / 100)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <span>
                  {detail.totals.balance_cents < 0 ? 'Refund due' : 'Balance'}
                </span>
                <span
                  className={
                    detail.totals.balance_cents < 0
                      ? 'text-amber-600 tabular-nums dark:text-amber-400'
                      : 'text-sky-700 tabular-nums dark:text-sky-300'
                  }
                >
                  {money(Math.abs(detail.totals.balance_cents) / 100)}
                </span>
              </div>
            </>
          ) : null}
        </div>

        {detail.totals.balance_cents > 0 ? (
          <div className="mt-4 flex flex-col gap-3 border-t pt-4">
            <Label>Collect final payment</Label>
            <div className="flex gap-2">
              <Input
                aria-label="Final payment amount"
                className="w-28"
                type="number"
                min={1}
                step="any"
                value={finalPaymentAmount}
                onChange={(e) => setFinalPaymentAmount(e.target.value)}
              />
              <Button
                className="flex-1"
                disabled={
                  busy === 'final-payment-tap' ||
                  !(Number(finalPaymentAmount) > 0) ||
                  !activeVisitId
                }
                onClick={async () => {
                  setBusy('final-payment-tap')
                  setError(null)
                  try {
                    const response = await fetch(
                      `/api/admin/ops/restoration/visits/${activeVisitId}/deposit-link`,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          amount_cents: Math.round(
                            Number(finalPaymentAmount) * 100,
                          ),
                          kind: 'payment',
                          returnTo: `/admin/operations/restoration/${projectId}`,
                        }),
                      },
                    )
                    const result = await response.json()
                    if (!response.ok)
                      throw new Error(result.error || 'Square is unavailable')
                    window.location.href = result.url
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : 'Square is unavailable',
                    )
                    setBusy(null)
                  }
                }}
              >
                {busy === 'final-payment-tap' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Tap to Pay'
                )}
              </Button>
            </div>
            <Button
              variant="outline"
              disabled={busy === 'final-payment-link'}
              onClick={() =>
                call(
                  `/api/admin/ops/restoration/projects/${projectId}/final-payment-link`,
                  { method: 'POST' },
                  'final-payment-link',
                )
              }
            >
              {busy === 'final-payment-link' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Text pay link'
              )}
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Check amount"
                className="w-28"
                type="number"
                min={0}
                step="any"
                value={checkAmount}
                onChange={(e) => setCheckAmount(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={
                  busy === 'final-payment-check' ||
                  !(Number(checkAmount) > 0) ||
                  !activeVisitId
                }
                onClick={async () => {
                  await call(
                    `/api/admin/ops/restoration/visits/${activeVisitId}/deposit`,
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        amount_cents: Math.round(Number(checkAmount) * 100),
                        method: 'check',
                        kind: 'payment',
                        note: 'Check received',
                      }),
                    },
                    'final-payment-check',
                  )
                  setCheckAmount('')
                }}
              >
                Record a check
              </Button>
            </div>
          </div>
        ) : null}

        {isMitigation && !closed && detail.totals.paid_cents === 0 ? (
          <div className="mt-4 flex flex-col gap-2">
            <Label htmlFor="deposit-amount">Deposit</Label>
            <div className="flex gap-2">
              <Input
                id="deposit-amount"
                className="w-28"
                type="number"
                min={1}
                step="any"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
              />
              <Button
                className="flex-1"
                disabled={busy === 'deposit-link' || Number(depositAmount) <= 0}
                onClick={async () => {
                  setBusy('deposit-link')
                  setError(null)
                  try {
                    const response = await fetch(
                      `/api/admin/ops/restoration/visits/${activeVisitId}/deposit-link`,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          amount_cents: Math.round(Number(depositAmount) * 100),
                          returnTo: `/admin/operations/restoration/${projectId}`,
                        }),
                      },
                    )
                    const result = await response.json()
                    if (!response.ok)
                      throw new Error(result.error || 'Square is unavailable')
                    // Hands off to the Square app; it returns to this page.
                    window.location.href = result.url
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : 'Square is unavailable',
                    )
                    setBusy(null)
                  }
                }}
              >
                {busy === 'deposit-link' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Tap to Pay'
                )}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Credited against the final invoice when the project closes.
            </p>
          </div>
        ) : null}

        {/*
          Money already taken, recorded rather than charged again. Square Tap to
          Pay above is for collecting now; this is for a payment that happened
          elsewhere — on the Square app, in cash, by check — including one taken
          before this job existed in the system. It stays available for the whole
          job, because gating it to the mitigation day meant a deposit taken on
          day one could not be entered on day three, and it allows more than one,
          because a customer can pay twice.
        */}
        {!closed ? (
          <div className="mt-4 flex flex-col gap-2">
            <Label htmlFor="recorded-amount">
              Record a payment already taken
            </Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="recorded-amount"
                className="w-28"
                type="number"
                min={0}
                step="any"
                placeholder="1000"
                value={recordedAmount}
                onChange={(e) => setRecordedAmount(e.target.value)}
              />
              <select
                aria-label="How it was paid"
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                value={recordedMethod}
                onChange={(e) => setRecordedMethod(e.target.value)}
              >
                <option value="square_other">Square</option>
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="card_other">Card, elsewhere</option>
                <option value="other">Other</option>
              </select>
              <Button
                variant="outline"
                disabled={
                  busy === 'deposit' ||
                  !(Number(recordedAmount) > 0) ||
                  !activeVisitId
                }
                onClick={async () => {
                  await call(
                    `/api/admin/ops/restoration/visits/${activeVisitId}/deposit`,
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        amount_cents: Math.round(Number(recordedAmount) * 100),
                        method: recordedMethod,
                        kind: 'deposit',
                        note: 'recorded by hand — taken outside the app',
                      }),
                    },
                    'deposit',
                  )
                  setRecordedAmount('')
                }}
              >
                Record
              </Button>
            </div>
          </div>
        ) : null}

        {!closed ? (
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 mt-4 w-full gap-2"
            disabled={busy === 'delete-project'}
            onClick={async () => {
              const visits = detail.visits.length
              const queued = detail.queue.filter(
                (q) => q.status === 'queued',
              ).length
              if (
                !window.confirm(
                  `Delete this water loss?\n\nThis removes ${visits} scheduled visit${
                    visits === 1 ? '' : 's'
                  }${queued > 0 ? ` and ${queued} still in the tray` : ''}, plus all rooms, ` +
                    'equipment, readings and photos. It cannot be undone.',
                )
              ) {
                return
              }
              setBusy('delete-project')
              const response = await fetch(
                `/api/admin/ops/restoration/projects/${projectId}`,
                { method: 'DELETE' },
              )
              if (!response.ok) {
                const result = await response.json().catch(() => ({}))
                setError(result.error || 'Could not delete this loss')
                setBusy(null)
                return
              }
              window.location.href = '/admin/operations'
            }}
          >
            {busy === 'delete-project' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete this water loss
          </Button>
        ) : null}

        <Button asChild variant="outline" className="mt-4 w-full gap-2">
          <a
            href={`/api/admin/ops/restoration/projects/${projectId}/report`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <FileText className="h-4 w-4" />
            Drying report (PDF)
          </a>
        </Button>

        <Button
          variant="outline"
          className="mt-2 w-full gap-2"
          disabled={busy === 'email-report'}
          onClick={() =>
            call(
              `/api/admin/ops/restoration/projects/${projectId}/report/email`,
              { method: 'POST' },
              'email-report',
            )
          }
        >
          {busy === 'email-report' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Mail className="h-4 w-4" />
          )}
          Email report to customer
        </Button>

        {project.invoice_id ? (
          <Button asChild variant="outline" className="mt-2 w-full">
            <Link href={`/admin/operations/invoices/${project.invoice_id}`}>
              Open invoice
            </Link>
          </Button>
        ) : null}
      </Card>

      {/* ── Close ──────────────────────────────────────────── */}
      {!closed && activeVisit && !isMitigation ? (
        <Card className={SECTION_CARD}>
          <h2 className="mb-1 text-lg font-semibold">Dry standard reached?</h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Closing pulls all remaining equipment, cancels the monitor visits
            you no longer need, and builds the single invoice for the whole
            loss.
          </p>

          {/*
            What the invoice will say, before it says it. The deposit was taken
            on day one against a total nobody knew yet, so seeing the deposit and
            the deductible credit land is the difference between confidence and
            opening the invoice afterwards to check.
          */}
          <div className="border-border/60 mb-3 flex flex-col gap-1 rounded-md border p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Work and equipment</span>
              <span className="tabular-nums">
                {money(detail.totals.gross_subtotal)}
              </span>
            </div>
            {detail.totals.deductible_credit > 0 ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deductible split</span>
                <span className="tabular-nums">
                  −{money(detail.totals.deductible_credit)}
                </span>
              </div>
            ) : null}
            {detail.totals.paid_cents > 0 ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Deposit already taken
                </span>
                <span className="tabular-nums">
                  −{money(detail.totals.paid_cents / 100)}
                </span>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between border-t pt-2 font-semibold">
              <span>
                {detail.totals.balance_cents < 0
                  ? 'Refund to the customer'
                  : 'Customer owes'}
              </span>
              <span
                className={
                  detail.totals.balance_cents < 0
                    ? 'text-amber-600 tabular-nums dark:text-amber-400'
                    : 'text-sky-700 tabular-nums dark:text-sky-300'
                }
              >
                {money(Math.abs(detail.totals.balance_cents) / 100)}
              </span>
            </div>
          </div>
          <Button
            className="w-full gap-2"
            disabled={busy === 'close'}
            onClick={() =>
              void call(
                `/api/admin/ops/restoration/projects/${projectId}/close`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    closing_appointment_id: activeVisitId,
                  }),
                },
                'close',
              )
            }
          >
            {busy === 'close' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Close project and invoice
          </Button>
        </Card>
      ) : null}

      {!closed && isMitigation ? (
        <p className="text-muted-foreground px-1 text-center text-xs">
          Nothing is dry on day one — the project closes from a monitor visit.
        </p>
      ) : null}
    </div>
  )
}

/**
 * Editing a moisture point where it actually is, on the plan.
 *
 * The reading box is first and focused, because that is the thing being done
 * ninety percent of the time: walk to the wall, hold the meter, type the number.
 * Renaming the point or changing its material is right there for the times the
 * point was dropped before it was known what it was measuring.
 */
function MapPointEditor({
  point,
  activeVisitId,
  visitLabel,
  onSave,
  onReading,
  onEditReading,
  onRemoveReading,
  onRemove,
  onClose,
}: {
  point: ReadingPoint
  activeVisitId: string | null
  visitLabel: string
  onSave: (patch: Record<string, unknown>) => void | Promise<unknown>
  onReading: (value: number) => void | Promise<unknown>
  onEditReading: (readingId: string, value: number) => void | Promise<unknown>
  onRemoveReading: (readingId: string) => void | Promise<unknown>
  onRemove: () => void | Promise<unknown>
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [expanded, setExpanded] = useState(false)

  const history = [...point.restoration_readings].sort(
    (a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime(),
  )
  // What was read on the visit being viewed, and nothing else. A visit with no
  // reading shows none — the history is below, dated, for context.
  const mine = readingForVisit(point.restoration_readings, activeVisitId)
  const standard = point.dry_standard ?? defaultDryStandard(point.material)
  const band = moistureBand(mine ? Number(mine.value) : null, standard)

  // Taking a reading is the whole reason the bubble opened, so saving one closes
  // it. On a monitor day that is a dozen points in a row, and dismissing each
  // one by hand afterwards is a dozen taps that say nothing.
  function submit() {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || value === '') return
    // Re-reading a point on the same visit corrects that visit's number rather
    // than stacking a second one on the same day.
    if (mine) {
      void onEditReading(mine.id, numeric)
    } else {
      void onReading(numeric)
    }
    setValue('')
    if (!expanded) onClose()
  }

  return (
    <Card className="bg-card border-sky-400/60 p-3 shadow-lg dark:border-sky-500/50">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-medium">{point.label}</span>
        <button type="button" aria-label="Close" onClick={onClose}>
          <X className="text-muted-foreground h-4 w-4" />
        </button>
      </div>

      <p className="text-muted-foreground mb-1 text-xs">{visitLabel}</p>
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          className="h-10 flex-1 text-right text-base"
          type="number"
          step="any"
          inputMode="decimal"
          placeholder={mine ? String(mine.value) : 'reading %'}
          aria-label={`Reading for ${point.label}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <Button size="sm" className={ACTION_BUTTON} onClick={submit}>
          {mine ? 'Update' : 'Save'}
        </Button>
      </div>

      {/*
        Every reading is editable and removable. They are typed one-handed in a
        wet basement, and a 340 where 34 was meant rescales the drying chart,
        drags the trend, and goes into the report an adjuster reads. Until now
        the only remedy was deleting the point and losing its whole history.
      */}
      {history.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {history.map((reading) => (
            <span
              key={reading.id}
              className="border-border/60 flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
            >
              <input
                className="w-9 bg-transparent text-right tabular-nums outline-none"
                type="number"
                step="any"
                min={0}
                aria-label={`Reading taken ${new Date(reading.taken_at).toLocaleDateString()}`}
                title={new Date(reading.taken_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
                defaultValue={Number(reading.value)}
                onBlur={(e) => {
                  const value = Number(e.target.value)
                  if (value >= 0 && value !== Number(reading.value)) {
                    void onEditReading(reading.id, value)
                  }
                }}
              />
              <span className="text-muted-foreground">%</span>
              <button
                type="button"
                aria-label="Remove this reading"
                onClick={() => void onRemoveReading(reading.id)}
              >
                <X className="text-muted-foreground h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground mt-2 text-xs">no readings yet</p>
      )}
      <p className="text-muted-foreground mt-1 text-xs">
        {standard != null ? (
          <>
            dry at {standard}%
            {band !== 'unknown' ? ` · ${BAND_LABEL[band]}` : ''}
          </>
        ) : (
          // No invented number for this material. Say what is missing and why,
          // rather than colouring the pin against a figure nobody chose.
          <>
            Set a dry standard — read an unaffected spot of the same material.
          </>
        )}
      </p>

      {expanded ? (
        <div className="mt-3 flex flex-col gap-2 border-t pt-3">
          <Input
            className="h-9"
            defaultValue={point.label}
            aria-label="Point name"
            onBlur={(e) => {
              const label = e.target.value.trim()
              if (label && label !== point.label) void onSave({ label })
            }}
          />
          <div className="flex gap-2">
            <select
              className="border-input bg-background h-9 flex-1 rounded-md border px-2 text-sm"
              aria-label="Material"
              value={point.material ?? ''}
              onChange={(e) =>
                void onSave({ material: e.target.value || null })
              }
            >
              {MATERIALS.map((material) => (
                <option key={material} value={material}>
                  {material}
                </option>
              ))}
            </select>
            <Input
              className="h-9 w-24"
              type="number"
              step="any"
              placeholder="goal %"
              aria-label="Dry standard"
              defaultValue={point.dry_standard ?? ''}
              onBlur={(e) => void onSave({ dry_standard: e.target.value })}
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground justify-start"
            onClick={() => void onRemove()}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Remove point
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className="text-muted-foreground mt-2 text-xs underline"
          onClick={() => setExpanded(true)}
        >
          Rename, material, goal
        </button>
      )}
    </Card>
  )
}
