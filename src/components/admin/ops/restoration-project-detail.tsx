'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Droplets, Loader2, Mic, Phone, Plus, Trash2, Wind, CheckCircle2, MessageSquare,
  Camera,
  FileText,
  Ruler,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { DirectionsButtons } from '@/components/ops/directions-buttons'
import { buildDryingPlan } from '@/lib/ops/restoration-drying-plan'
import { StreetViewCard } from '@/components/ops/street-view-card'

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
  ops_appointment_line_items: Line[]
}

type ReadingPoint = {
  id: string
  label: string
  material: string | null
  dry_standard: number | null
  restoration_readings: Array<{ id: string; value: number; taken_at: string }>
}

type Detail = {
  project: {
    id: string
    status: string
    water_category: number | null
    after_hours_call: boolean
    source_of_loss: string | null
    cause_narrative: string | null
    loss_date: string | null
    invoice_id: string | null
    ops_customers: { id: string; full_name: string; business_name: string | null; phone: string } | null
    ops_service_addresses: {
      id: string; street_1: string; street_2: string | null
      city: string; state: string; zip_code: string; gate_code: string | null
    } | null
  }
  visits: Visit[]
  queue: Array<{ id: string; visit_type: string; visit_sequence: number | null; status: string }>
  equipment: Array<{ id: string; catalog_code: string; placed_at: string; removed_at: string | null }>
  equipment_billing: Array<{
    catalog_code: string; description: string; unit_price: number
    units: number; unit_days: number; line_total: number
  }>
  reading_points: ReadingPoint[]
  areas: Array<{
    id: string
    name: string
    affected_sqft: number | null
    wall_linear_ft: number | null
    ceiling_height_ft: number | null
  }>
  payments: Array<{ id: string; kind: string; method: string; amount_cents: number }>
  photos: Array<{
    id: string
    public_url: string
    restoration_phase: string | null
    appointment_id: string
  }>
  totals: { work: number; equipment: number; subtotal: number; paid_cents: number; balance_cents: number }
}

type CatalogItem = {
  concept_code: string
  label: string
  code: string
  unit: string
  unit_price: number
  billable: boolean
}

type ParsedLine = {
  conceptCode: string
  label: string
  code: string
  unit: string
  unitPrice: number
  quantity: number | null
  heard: string
  confidence: 'high' | 'low'
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

const EQUIPMENT_CODES = [
  { code: 'DRY++', label: 'Axial fan 1 HP' },
  { code: 'DRY+', label: 'Axial fan' },
  { code: 'DRY', label: 'Air mover' },
  { code: 'DHM>>', label: 'LGR dehu' },
  { code: 'DHM>', label: 'Small dehu' },
  { code: 'NAFAN', label: 'Air scrubber' },
]

export function RestorationProjectDetail({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [activeVisitId, setActiveVisitId] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [catalogQuery, setCatalogQuery] = useState('')

  const [areaName, setAreaName] = useState('')
  const [areaLength, setAreaLength] = useState('')
  const [areaWidth, setAreaWidth] = useState('')
  const [areaHeight, setAreaHeight] = useState('8')

  const [depositAmount, setDepositAmount] = useState('1000')

  const [photoPhase, setPhotoPhase] = useState<string>('affected_materials')
  const [uploading, setUploading] = useState(false)

  const [pointLabel, setPointLabel] = useState('')
  const [pointMaterial, setPointMaterial] = useState('Drywall')
  const [pointGoal, setPointGoal] = useState('')

  const [transcript, setTranscript] = useState('')
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
        if (current && result.visits.some((v: Visit) => v.id === current)) return current
        const open = result.visits.find((v: Visit) => v.status !== 'completed')
        return (open ?? result.visits[0])?.id ?? null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

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
      const response = await fetch(`/api/admin/ops/restoration/catalog?${params}`, {
        cache: 'no-store',
      })
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

  const dryingPlan = useMemo(
    () =>
      buildDryingPlan(
        (detail?.areas ?? []).map((area) => ({
          affectedSqft: area.affected_sqft,
          ceilingHeightFt: area.ceiling_height_ft,
        })),
      ),
    [detail],
  )
  const totalPerimeterFt = useMemo(
    () =>
      Math.round(
        (detail?.areas ?? []).reduce((sum, a) => sum + Number(a.wall_linear_ft ?? 0), 0) * 100,
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

  async function addLines(lines: Array<{ concept_code: string; quantity: number | null }>) {
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
          </div>
        </div>
        {customer?.phone ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild className="gap-2">
              <a href={`tel:${customer.phone}`}><Phone className="h-4 w-4" /> Call</a>
            </Button>
            <Button variant="outline" size="sm" asChild className="gap-2">
              <a href={`sms:${customer.phone}`}><MessageSquare className="h-4 w-4" /> Text</a>
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      {address ? (
        <Card className="border-border/60 bg-card/80 p-5">
          <h2 className="mb-2 text-lg font-semibold">Service address</h2>
          <p className="text-sm">
            {address.street_1}
            {address.street_2 ? `, ${address.street_2}` : ''}
          </p>
          <p className="text-muted-foreground mb-3 text-sm">
            {address.city}, {address.state} {address.zip_code}
          </p>
          {address.gate_code ? (
            <p className="text-muted-foreground mb-3 text-xs">Gate: {address.gate_code}</p>
          ) : null}
          <DirectionsButtons address={address} />
        </Card>
      ) : null}

      <StreetViewCard address={address} />

      {/* ── Visits ─────────────────────────────────────────── */}
      <Card className="border-border/60 bg-card/80 p-5">
        <h2 className="mb-3 text-lg font-semibold">Visits</h2>
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
                <span className="font-medium capitalize">{visit.visit_type}</span>
                <span className="text-muted-foreground">
                  {' '}· {visit.appointment_date} {visit.start_time.slice(0, 5)}
                </span>
              </span>
              <Badge variant={visit.status === 'completed' ? 'secondary' : 'outline'}>
                {visit.status}
              </Badge>
            </button>
          ))}
          {detail.queue.filter((q) => q.status === 'queued').length > 0 ? (
            <p className="text-muted-foreground mt-1 text-xs">
              {detail.queue.filter((q) => q.status === 'queued').length} monitor visit(s)
              waiting in the tray — place them from the schedule.
            </p>
          ) : null}
        </div>
      </Card>

      {/* ── Affected areas ─────────────────────────────────── */}
      {!closed ? (
        <Card className="border-border/60 bg-card/80 p-5">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
            <Ruler className="h-4 w-4" /> Affected areas
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Measure once. Square footage fills the line items, and the volume sizes the
            drying equipment.
          </p>

          {detail.areas.length > 0 ? (
            <div className="mb-3 flex flex-col divide-y">
              {detail.areas.map((area) => (
                <div key={area.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{area.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {area.affected_sqft ?? '—'} SF
                      {area.wall_linear_ft ? ` · ${area.wall_linear_ft} LF perimeter` : ''}
                      {area.ceiling_height_ft ? ` · ${area.ceiling_height_ft} ft ceiling` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${area.name}`}
                    onClick={() =>
                      void call(
                        `/api/admin/ops/restoration/areas/${area.id}`,
                        { method: 'DELETE' },
                        `del-area-${area.id}`,
                      )
                    }
                  >
                    <Trash2 className="text-muted-foreground h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-32 flex-1">
              <Label htmlFor="area-name" className="text-xs">Room</Label>
              <Input
                id="area-name"
                className="h-9"
                value={areaName}
                onChange={(e) => setAreaName(e.target.value)}
                placeholder="Basement rec room"
              />
            </div>
            <div className="w-20">
              <Label htmlFor="area-len" className="text-xs">Length</Label>
              <Input id="area-len" className="h-9" type="number" step="any"
                value={areaLength} onChange={(e) => setAreaLength(e.target.value)} />
            </div>
            <div className="w-20">
              <Label htmlFor="area-wid" className="text-xs">Width</Label>
              <Input id="area-wid" className="h-9" type="number" step="any"
                value={areaWidth} onChange={(e) => setAreaWidth(e.target.value)} />
            </div>
            <div className="w-20">
              <Label htmlFor="area-hgt" className="text-xs">Ceiling</Label>
              <Input id="area-hgt" className="h-9" type="number" step="any"
                value={areaHeight} onChange={(e) => setAreaHeight(e.target.value)} />
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy === 'add-area' || !areaName.trim() || !areaLength || !areaWidth}
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
                setAreaName('')
                setAreaLength('')
                setAreaWidth('')
              }}
            >
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>

          {dryingPlan.totalAffectedSqft > 0 ? (
            <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-sm">
              <p className="font-medium text-sky-900">
                {dryingPlan.totalAffectedSqft} SF · {dryingPlan.totalCubicFt.toLocaleString()} cu ft
              </p>
              <p className="mt-1 text-xs text-sky-900">
                Starting point: <strong>{dryingPlan.airMovers} air movers</strong>
                {dryingPlan.suggestedDehu
                  ? ` and ${dryingPlan.dehuCount} × ${
                      dryingPlan.suggestedDehu === 'DHM>>' ? 'LGR' : 'small'
                    } dehumidifier (${dryingPlan.dehumidifierPintsPerDay} PPD)`
                  : ''}
                . Adjust to what the job actually needs — only what you place gets billed.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === 'place-plan'}
                  onClick={async () => {
                    await call(
                      `/api/admin/ops/restoration/projects/${projectId}/equipment`,
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          catalog_code: 'DRY++',
                          count: dryingPlan.airMovers,
                        }),
                      },
                      'place-plan',
                    )
                    if (dryingPlan.suggestedDehu) {
                      await call(
                        `/api/admin/ops/restoration/projects/${projectId}/equipment`,
                        {
                          method: 'POST',
                          body: JSON.stringify({
                            catalog_code: dryingPlan.suggestedDehu,
                            count: dryingPlan.dehuCount,
                          }),
                        },
                        'place-plan',
                      )
                    }
                  }}
                >
                  Place this equipment
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ── Work on this visit ─────────────────────────────── */}
      {activeVisit && !closed ? (
        <Card className="border-border/60 bg-card/80 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Work · <span className="capitalize">{activeVisit.visit_type}</span>
            </h2>
            <span className="text-muted-foreground text-sm">
              {money(
                activeVisit.ops_appointment_line_items.reduce(
                  (s, l) => s + Number(l.line_total),
                  0,
                ),
              )}
            </span>
          </div>

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
                variant="secondary"
                disabled={busy === 'parse' || !transcript.trim()}
                onClick={() => void runParse()}
                className="gap-2"
              >
                {busy === 'parse' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
                Read it
              </Button>
              {proposed.length > 0 ? (
                <Button
                  size="sm"
                  disabled={busy === 'add-lines'}
                  onClick={async () => {
                    await addLines(
                      proposed.map((p) => ({
                        concept_code: p.conceptCode,
                        quantity: p.quantity,
                      })),
                    )
                    setProposed([])
                    setUnmatched([])
                    setTranscript('')
                  }}
                >
                  Add {proposed.length} line{proposed.length === 1 ? '' : 's'}
                </Button>
              ) : null}
            </div>

            {proposed.length > 0 ? (
              <div className="border-border/60 mt-1 rounded-md border p-3">
                <p className="text-muted-foreground mb-2 text-xs">
                  Priced for Category {category}
                  {afterHours ? ', after hours' : ''}. Check before adding.
                </p>
                {proposed.map((line, index) => (
                  <div
                    key={`${line.code}-${index}`}
                    className="flex items-center justify-between gap-2 py-1 text-sm"
                  >
                    <span>
                      <code className="text-xs">{line.code}</code> {line.label}
                      {line.quantity ? (
                        <span className="text-muted-foreground"> · {line.quantity} {line.unit}</span>
                      ) : (
                        <span className="text-muted-foreground"> · qty?</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs">
                        {money(line.unitPrice)}/{line.unit}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${line.label}`}
                        onClick={() =>
                          setProposed((current) => current.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 className="text-muted-foreground h-4 w-4" />
                      </button>
                    </span>
                  </div>
                ))}
                {unmatched.length > 0 ? (
                  <p className="text-muted-foreground mt-2 text-xs">
                    Couldn&apos;t match: {unmatched.join(', ')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mb-3 flex flex-col gap-2">
            <Label htmlFor="catalog-search">Or find it</Label>
            <Input
              id="catalog-search"
              value={catalogQuery}
              onChange={(e) => setCatalogQuery(e.target.value)}
              placeholder="extraction, flood cut, pad…"
            />
            {catalogQuery.trim().length > 1 ? (
              <div className="border-border/60 max-h-56 overflow-y-auto rounded-md border">
                {catalog.slice(0, 25).map((item) => (
                  <button
                    key={item.concept_code}
                    type="button"
                    className="hover:bg-muted/60 flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                    onClick={() =>
                      void addLines([
                        {
                          concept_code: item.concept_code,
                          // Pre-fill from what was measured: area for square-foot
                          // work, perimeter for anything billed by the foot.
                          quantity:
                            item.unit === 'SF' && dryingPlan.totalAffectedSqft > 0
                              ? dryingPlan.totalAffectedSqft
                              : item.unit === 'LF' && totalPerimeterFt > 0
                                ? totalPerimeterFt
                                : 1,
                        },
                      ])
                    }
                  >
                    <span>
                      <code className="text-xs">{item.code}</code> {item.label}
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap text-xs">
                      {money(item.unit_price)}/{item.unit}
                    </span>
                  </button>
                ))}
                {catalog.length === 0 ? (
                  <p className="text-muted-foreground px-3 py-2 text-sm">No match.</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col divide-y">
            {activeVisit.ops_appointment_line_items.map((line) => (
              <div key={line.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1">{line.name_snapshot}</span>
                <Input
                  className="h-8 w-20 text-right"
                  type="number"
                  min={0}
                  step="any"
                  defaultValue={Number(line.quantity)}
                  onBlur={(e) => {
                    const quantity = Number(e.target.value)
                    if (quantity > 0 && quantity !== Number(line.quantity)) {
                      void call(
                        `/api/admin/ops/restoration/line-items/${line.id}`,
                        { method: 'PATCH', body: JSON.stringify({ quantity }) },
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
              <p className="text-muted-foreground py-2 text-sm">Nothing added yet.</p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* ── Equipment ──────────────────────────────────────── */}
      {!closed ? (
        <Card className="border-border/60 bg-card/80 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Wind className="h-4 w-4" /> Equipment
            </h2>
            <span className="text-muted-foreground text-sm">
              {runningEquipment.length} running · {money(detail.totals.equipment)}
            </span>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {EQUIPMENT_CODES.map((equipment) => (
              <Button
                key={equipment.code}
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={busy === `place-${equipment.code}`}
                onClick={() =>
                  void call(
                    `/api/admin/ops/restoration/projects/${projectId}/equipment`,
                    {
                      method: 'POST',
                      body: JSON.stringify({ catalog_code: equipment.code, count: 1 }),
                    },
                    `place-${equipment.code}`,
                  )
                }
              >
                <Plus className="h-3 w-3" /> {equipment.label}
              </Button>
            ))}
          </div>

          {detail.equipment_billing.length > 0 ? (
            <div className="flex flex-col divide-y text-sm">
              {detail.equipment_billing.map((row) => (
                <div key={row.catalog_code} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <code className="text-xs">{row.catalog_code}</code> {row.description}
                  </span>
                  <span className="text-muted-foreground whitespace-nowrap text-xs">
                    {row.units} × {row.unit_days / Math.max(1, row.units)}d
                  </span>
                  <span className="w-20 text-right font-medium">
                    {money(Number(row.line_total))}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {runningEquipment.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {runningEquipment.map((placement) => (
                <Button
                  key={placement.id}
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground gap-1 text-xs"
                  onClick={() =>
                    void call(
                      `/api/admin/ops/restoration/equipment/${placement.id}`,
                      { method: 'PATCH', body: JSON.stringify({}) },
                      `pull-${placement.id}`,
                    )
                  }
                >
                  Pull {placement.catalog_code}
                </Button>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ── Reading points (placed on day 1, tapped on every visit) ── */}
      {!closed ? (
        <Card className="border-border/60 bg-card/80 p-5">
          <h2 className="mb-1 text-lg font-semibold">Moisture readings</h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Points are placed once and re-read on every monitor visit, so you can see a
            spot trending down — or stalling.
          </p>

          <div className="flex flex-col divide-y">
            {detail.reading_points.map((point) => {
              const history = [...point.restoration_readings].sort(
                (a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime(),
              )
              const latest = history[history.length - 1]
              const atGoal =
                point.dry_standard != null &&
                latest != null &&
                Number(latest.value) <= Number(point.dry_standard)
              return (
                <div key={point.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{point.label}</span>
                    {point.material ? (
                      <span className="text-muted-foreground"> · {point.material}</span>
                    ) : null}
                    <span className="text-muted-foreground block text-xs">
                      {history.length > 0
                        ? history.map((r) => r.value).join(' → ')
                        : 'no readings yet'}
                      {point.dry_standard != null ? ` (goal ${point.dry_standard})` : ''}
                      {atGoal ? ' · dry' : ''}
                    </span>
                  </span>
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
                      if (!Number.isFinite(value) || input.value === '') return
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
                </div>
              )
            })}
            {detail.reading_points.length === 0 ? (
              <p className="text-muted-foreground py-2 text-sm">
                No points yet. Add one for each material you are drying.
              </p>
            ) : null}
          </div>

          <div className="border-border/60 mt-4 border-t pt-4">
            <Label className="mb-2 block text-sm">Add a point</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                className="h-9 min-w-40 flex-1"
                value={pointLabel}
                onChange={(e) => setPointLabel(e.target.value)}
                placeholder="North wall, base"
              />
              <select
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                value={pointMaterial}
                onChange={(e) => setPointMaterial(e.target.value)}
              >
                {['Drywall', 'Subfloor', 'Framing', 'Hardwood', 'Concrete', 'Insulation'].map(
                  (material) => (
                    <option key={material} value={material}>
                      {material}
                    </option>
                  ),
                )}
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
                variant="secondary"
                disabled={busy === 'add-point' || !pointLabel.trim()}
                onClick={async () => {
                  await call(
                    `/api/admin/ops/restoration/projects/${projectId}/readings`,
                    {
                      method: 'PUT',
                      body: JSON.stringify({
                        label: pointLabel.trim(),
                        material: pointMaterial,
                        dry_standard: pointGoal === '' ? null : Number(pointGoal),
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

      {/* ── Air + dehumidifier readings ────────────────────── */}
      {!closed && !isMitigation ? (
        <Card className="border-border/60 bg-card/80 p-5">
          <h2 className="mb-1 text-lg font-semibold">Air readings</h2>
          <p className="text-muted-foreground mb-3 text-sm">
            The unaffected reference is what proves the affected area is drying rather
            than the whole house being humid today.
          </p>
          <div className="flex flex-col gap-2">
            {(['affected', 'reference', 'exterior'] as const).map((location) => (
              <AirReadingRow
                key={location}
                location={location}
                busy={busy === `air-${location}`}
                onSubmit={(tempF, rhPct) =>
                  void call(
                    `/api/admin/ops/restoration/projects/${projectId}/readings`,
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        kind: 'air',
                        location,
                        appointment_id: activeVisitId,
                        temp_f: tempF,
                        rh_pct: rhPct,
                      }),
                    },
                    `air-${location}`,
                  )
                }
              />
            ))}
          </div>

          {runningEquipment.filter((e) => e.catalog_code.startsWith('DHM')).length > 0 ? (
            <div className="border-border/60 mt-4 border-t pt-4">
              <Label className="mb-2 block text-sm">Dehumidifier</Label>
              {runningEquipment
                .filter((e) => e.catalog_code.startsWith('DHM'))
                .map((dehu) => (
                  <DehuReadingRow
                    key={dehu.id}
                    code={dehu.catalog_code}
                    busy={busy === `dehu-${dehu.id}`}
                    onSubmit={(values) =>
                      void call(
                        `/api/admin/ops/restoration/projects/${projectId}/readings`,
                        {
                          method: 'POST',
                          body: JSON.stringify({
                            kind: 'dehu',
                            equipment_placement_id: dehu.id,
                            appointment_id: activeVisitId,
                            ...values,
                          }),
                        },
                        `dehu-${dehu.id}`,
                      )
                    }
                  />
                ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ── Photos ─────────────────────────────────────────── */}
      {activeVisitId && !closed ? (
        <Card className="border-border/60 bg-card/80 p-5">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
            <Camera className="h-4 w-4" /> Photos
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Pick the phase once, then shoot as many as you need — they all land tagged.
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
            {uploading ? 'Uploading…' : 'Add photos'}
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
                try {
                  for (const file of files) {
                    const form = new FormData()
                    form.append('image', file)
                    form.append('label', 'general')
                    form.append('restoration_phase', photoPhase)
                    // The camera's own timestamp, so a bulk upload of an earlier
                    // day still lands on the day the work actually happened.
                    if (file.lastModified) {
                      form.append('captured_at', new Date(file.lastModified).toISOString())
                    }
                    const response = await fetch(
                      `/api/admin/ops/appointments/${activeVisitId}/photos`,
                      { method: 'POST', body: form },
                    )
                    if (!response.ok) {
                      const result = await response.json().catch(() => ({}))
                      throw new Error(result.error || 'Upload failed')
                    }
                  }
                  await load()
                } catch (uploadError) {
                  setError(
                    uploadError instanceof Error ? uploadError.message : 'Upload failed',
                  )
                } finally {
                  setUploading(false)
                }
              }}
            />
          </label>

          {detail.photos.length > 0 ? (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {detail.photos.map((photo) => (
                <figure key={photo.id} className="overflow-hidden rounded-md border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.public_url}
                    alt={photo.restoration_phase ?? 'Job photo'}
                    className="h-20 w-full object-cover"
                  />
                  <figcaption className="bg-muted/40 text-muted-foreground truncate px-1.5 py-1 text-[10px]">
                    {PHOTO_PHASES.find((p) => p.value === photo.restoration_phase)?.label ??
                      'Untagged'}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ── Money ──────────────────────────────────────────── */}
      <Card className="border-border/60 bg-card/80 p-5">
        <h2 className="mb-3 text-lg font-semibold">Money</h2>
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Work</span>
            <span>{money(detail.totals.work)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Equipment</span>
            <span>{money(detail.totals.equipment)}</span>
          </div>
          <div className="flex justify-between border-t pt-1 font-semibold">
            <span>Running total</span>
            <span>{money(detail.totals.subtotal)}</span>
          </div>
          {detail.totals.paid_cents !== 0 ? (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deposit taken</span>
                <span>−{money(detail.totals.paid_cents / 100)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Balance</span>
                <span>{money(detail.totals.balance_cents / 100)}</span>
              </div>
            </>
          ) : null}
        </div>

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
                    if (!response.ok) throw new Error(result.error || 'Square is unavailable')
                    // Hands off to the Square app; it returns to this page.
                    window.location.href = result.url
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Square is unavailable')
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
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={busy === 'deposit' || Number(depositAmount) <= 0}
              onClick={() =>
                void call(
                  `/api/admin/ops/restoration/visits/${activeVisitId}/deposit`,
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      amount_cents: Math.round(Number(depositAmount) * 100),
                      method: 'other',
                      kind: 'deposit',
                    }),
                  },
                  'deposit',
                )
              }
            >
              Record cash or check instead
            </Button>
            <p className="text-muted-foreground text-xs">
              Credited against the final invoice when the project closes.
            </p>
          </div>
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
        <Card className="border-border/60 bg-card/80 p-5">
          <h2 className="mb-1 text-lg font-semibold">Dry standard reached?</h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Closing pulls all remaining equipment, cancels the monitor visits you no
            longer need, and builds the single invoice for the whole loss.
          </p>
          <Button
            className="w-full gap-2"
            disabled={busy === 'close'}
            onClick={() =>
              void call(
                `/api/admin/ops/restoration/projects/${projectId}/close`,
                {
                  method: 'POST',
                  body: JSON.stringify({ closing_appointment_id: activeVisitId }),
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

/** One ambient reading: temperature and relative humidity at a location. */
function AirReadingRow({
  location,
  busy,
  onSubmit,
}: {
  location: 'affected' | 'reference' | 'exterior'
  busy: boolean
  onSubmit: (tempF: number | null, rhPct: number | null) => void
}) {
  const [tempF, setTempF] = useState('')
  const [rhPct, setRhPct] = useState('')

  const labels: Record<typeof location, string> = {
    affected: 'Affected area',
    reference: 'Unaffected reference',
    exterior: 'Outside',
  }

  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 text-sm">{labels[location]}</span>
      <Input
        className="h-9 w-20 text-right"
        type="number"
        step="any"
        placeholder="°F"
        aria-label={`${labels[location]} temperature`}
        value={tempF}
        onChange={(e) => setTempF(e.target.value)}
      />
      <Input
        className="h-9 w-20 text-right"
        type="number"
        step="any"
        placeholder="RH%"
        aria-label={`${labels[location]} relative humidity`}
        value={rhPct}
        onChange={(e) => setRhPct(e.target.value)}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || (tempF === '' && rhPct === '')}
        onClick={() => {
          onSubmit(tempF === '' ? null : Number(tempF), rhPct === '' ? null : Number(rhPct))
          setTempF('')
          setRhPct('')
        }}
      >
        Save
      </Button>
    </div>
  )
}

/** Inlet and outlet at a running dehumidifier — the pair that shows it working. */
function DehuReadingRow({
  code,
  busy,
  onSubmit,
}: {
  code: string
  busy: boolean
  onSubmit: (values: {
    inlet_temp_f: number | null
    inlet_rh_pct: number | null
    outlet_temp_f: number | null
    outlet_rh_pct: number | null
  }) => void
}) {
  const [values, setValues] = useState({ it: '', ir: '', ot: '', or: '' })
  const num = (v: string) => (v === '' ? null : Number(v))

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <code className="text-xs">{code}</code>
      {(
        [
          ['it', 'in °F'],
          ['ir', 'in RH'],
          ['ot', 'out °F'],
          ['or', 'out RH'],
        ] as const
      ).map(([key, placeholder]) => (
        <Input
          key={key}
          className="h-9 w-20 text-right"
          type="number"
          step="any"
          placeholder={placeholder}
          aria-label={`${code} ${placeholder}`}
          value={values[key]}
          onChange={(e) => setValues((c) => ({ ...c, [key]: e.target.value }))}
        />
      ))}
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || Object.values(values).every((v) => v === '')}
        onClick={() => {
          onSubmit({
            inlet_temp_f: num(values.it),
            inlet_rh_pct: num(values.ir),
            outlet_temp_f: num(values.ot),
            outlet_rh_pct: num(values.or),
          })
          setValues({ it: '', ir: '', ot: '', or: '' })
        }}
      >
        Save
      </Button>
    </div>
  )
}
