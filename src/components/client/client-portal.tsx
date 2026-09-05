'use client'

import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import Image from 'next/image'
import { createClient } from '@/supabase/client'
import {
  ClientCommercialDetails,
  Field,
  fieldClass,
} from '@/components/client/commercial-details'
import {
  formatTime,
  formatMoney,
  type ClientPortalData,
  type ClientAppointment,
  type ClientTemplate,
} from '@/lib/ops/client-portal'
import { getFloorPlanMap } from '@/lib/ops/floor-plan-maps'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Repeat,
  StickyNote,
  CircleSlash,
  Send,
  X,
} from 'lucide-react'

type Props = {
  businessName: string
  managerName: string
  initialData: ClientPortalData
  mustChangePassword: boolean
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoToDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const REQUEST_TYPES = [
  { value: 'skip_visit', label: 'Request cancellation of a visit' },
  { value: 'reschedule', label: 'Reschedule a visit' },
  { value: 'add_visit', label: 'Add an extra visit' },
  { value: 'scope_change', label: 'Change cleaning scope' },
  { value: 'other', label: 'Other request' },
] as const

export function ClientPortal({
  businessName,
  managerName,
  initialData,
  mustChangePassword,
}: Props) {
  const [data, setData] = useState<ClientPortalData>(initialData)
  const [tab, setTab] = useState<'schedule' | 'business'>('schedule')
  const today = todayStr()

  // Default the calendar to the month of the next upcoming visit, else current month.
  const firstUpcoming =
    data.appointments.find((a) => a.appointment_date >= today)
      ?.appointment_date ?? today
  const [viewYear, setViewYear] = useState(
    isoToDate(firstUpcoming).getFullYear(),
  )
  const [viewMonth, setViewMonth] = useState(
    isoToDate(firstUpcoming).getMonth(),
  )
  const [selectedDate, setSelectedDate] = useState<string>(firstUpcoming)

  const [showPasswordGate, setShowPasswordGate] = useState(mustChangePassword)
  const [datesTemplate, setDatesTemplate] = useState<ClientTemplate | null>(
    null,
  )

  async function refresh() {
    try {
      const res = await fetch('/api/client/overview')
      if (res.ok) setData((await res.json()) as ClientPortalData)
    } catch {
      // best-effort refresh
    }
  }

  // Map date -> appointments for fast calendar lookups.
  const byDate = useMemo(() => {
    const map = new Map<string, ClientAppointment[]>()
    for (const a of data.appointments) {
      const arr = map.get(a.appointment_date) ?? []
      arr.push(a)
      map.set(a.appointment_date, arr)
    }
    return map
  }, [data.appointments])

  const selectedAppts = byDate.get(selectedDate) ?? []

  // Build the calendar grid for the viewed month.
  const grid = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1)
    const startDow = first.getDay()
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const cells: Array<string | null> = []
    for (let i = 0; i < startDow; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(
        `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      )
    }
    return cells
  }, [viewYear, viewMonth])

  function shiftMonth(delta: number) {
    const m = viewMonth + delta
    const d = new Date(viewYear, m, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  const pendingCount = data.requests.filter(
    (r) => r.status === 'pending',
  ).length

  return (
    <div className="space-y-6 text-slate-100">
      {showPasswordGate && (
        <PasswordGate onDone={() => setShowPasswordGate(false)} />
      )}

      {datesTemplate && (
        <TemplateDatesModal
          template={datesTemplate}
          appointments={data.appointments.filter(
            (a) => a.recurring_template_id === datesTemplate.id,
          )}
          today={today}
          onClose={() => setDatesTemplate(null)}
        />
      )}

      {/* Intro */}
      <div>
        <h1 className="text-2xl font-bold">Welcome, {managerName}</h1>
        <p className="text-sm text-slate-400">
          {businessName} · Your service schedule, business details, and
          agreements.
        </p>
      </div>

      <div className="flex gap-2" aria-label="Portal sections">
        <Button
          variant={tab === 'schedule' ? 'default' : 'outline'}
          onClick={() => setTab('schedule')}
        >
          Schedule & requests
        </Button>
        <Button
          variant={tab === 'business' ? 'default' : 'outline'}
          onClick={() => setTab('business')}
        >
          Business & agreements
        </Button>
      </div>
      {tab === 'business' && <ClientCommercialDetails />}
      <div className="space-y-6" hidden={tab !== 'schedule'}>
        {/* Recurring intervals */}
        <Card className="border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-3 flex items-center gap-2">
            <Repeat className="h-4 w-4 text-emerald-400" />
            <h2 className="text-lg font-semibold">Recurring schedule</h2>
          </div>
          {data.templates.length === 0 ? (
            <p className="text-sm text-slate-400">No active recurring jobs.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDatesTemplate(t)}
                  className="rounded-lg border border-white/10 bg-black/20 p-3 text-left transition hover:border-emerald-500/40 hover:bg-black/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{t.label}</p>
                    <span className="flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-emerald-400">
                      <CalendarDays className="h-3 w-3" /> View dates
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {t.schedule.map((s, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="bg-emerald-500/15 text-emerald-300"
                      >
                        {s}
                      </Badge>
                    ))}
                    {t.start_time && (
                      <Badge
                        variant="secondary"
                        className="bg-white/10 text-slate-300"
                      >
                        <Clock className="mr-1 h-3 w-3" />
                        {formatTime(t.start_time)}
                      </Badge>
                    )}
                  </div>
                  {t.lineItems.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {t.lineItems.map((li, i) => (
                        <li key={i} className="text-xs">
                          <div className="flex justify-between gap-2">
                            <span className="font-medium text-slate-200">
                              {li.name}
                            </span>
                            <span className="shrink-0 text-slate-300">
                              {formatMoney(li.quantity * li.unitPrice)}
                            </span>
                          </div>
                          {li.notes && (
                            <span className="block text-slate-400">
                              {li.notes}
                            </span>
                          )}
                          <span className="block text-slate-500">
                            {li.quantity.toLocaleString()} ×{' '}
                            {formatMoney(li.unitPrice)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(t.total > 0 || t.discount > 0) && (
                    <div className="mt-2 border-t border-white/10 pt-2 text-xs">
                      {t.discount > 0 && (
                        <div className="flex justify-between text-slate-400">
                          <span>Discount</span>
                          <span>−{formatMoney(t.discount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold text-emerald-300">
                        <span>Per visit</span>
                        <span>{formatMoney(t.total)}</span>
                      </div>
                    </div>
                  )}
                  {t.address && (
                    <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                      <MapPin className="h-3 w-3" /> {t.address}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Calendar + day detail */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-white/10 bg-white/5 p-5 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-emerald-400" />
                <h2 className="text-lg font-semibold">
                  {MONTHS[viewMonth]} {viewYear}
                </h2>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/15 bg-transparent px-2"
                  onClick={() => shiftMonth(-1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/15 bg-transparent px-2"
                  onClick={() => shiftMonth(1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1 font-medium">
                  {d}
                </div>
              ))}
              {grid.map((iso, i) => {
                if (!iso) return <div key={`e${i}`} />
                const has = byDate.has(iso)
                const isToday = iso === today
                const isSelected = iso === selectedDate
                const dayNum = Number(iso.split('-')[2])
                return (
                  <button
                    key={iso}
                    onClick={() => setSelectedDate(iso)}
                    className={[
                      'relative aspect-square rounded-md text-sm transition',
                      isSelected
                        ? 'bg-emerald-500 font-semibold text-black'
                        : has
                          ? 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                          : 'text-slate-400 hover:bg-white/5',
                      isToday && !isSelected ? 'ring-1 ring-white/40' : '',
                    ].join(' ')}
                  >
                    {dayNum}
                    {has && !isSelected && (
                      <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-emerald-400" />
                    )}
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Highlighted days have scheduled visits. Tap a day to see details.
            </p>
          </Card>

          {/* Day detail */}
          <Card className="border-white/10 bg-white/5 p-5 backdrop-blur">
            <h2 className="mb-3 text-lg font-semibold">
              {isoToDate(selectedDate).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </h2>
            {selectedAppts.length === 0 ? (
              <p className="text-sm text-slate-400">
                No visits scheduled this day.
              </p>
            ) : (
              <div className="space-y-3">
                {selectedAppts.map((a) => (
                  <VisitCard
                    key={a.id}
                    appt={a}
                    isPast={a.appointment_date < today}
                    onChanged={refresh}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Request a change */}
        <RequestForm appointments={data.appointments} onSubmitted={refresh} />

        {/* My requests */}
        <Card className="border-white/10 bg-white/5 p-5 backdrop-blur">
          <h2 className="mb-3 text-lg font-semibold">
            My requests{' '}
            {pendingCount > 0 && (
              <span className="text-sm font-normal text-amber-300">
                ({pendingCount} pending)
              </span>
            )}
          </h2>
          {data.requests.length === 0 ? (
            <p className="text-sm text-slate-400">No requests yet.</p>
          ) : (
            <div className="space-y-2">
              {data.requests.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm"
                >
                  <div>
                    <p className="font-medium capitalize">
                      {r.request_type.replace('_', ' ')}
                    </p>
                    {r.message && <p className="text-slate-400">{r.message}</p>}
                    {Object.entries(r.details)
                      .filter(([, v]) => typeof v === 'string' && v)
                      .map(([k, v]) => (
                        <p key={k} className="text-xs text-slate-400">
                          {k.replaceAll('_', ' ')}: {String(v)}
                        </p>
                      ))}
                    {r.admin_notes && (
                      <p className="mt-1 text-xs text-emerald-300">
                        Reply: {r.admin_notes}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(r.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-300',
    approved: 'bg-emerald-500/15 text-emerald-300',
    declined: 'bg-red-500/15 text-red-300',
    done: 'bg-slate-500/15 text-slate-300',
  }
  return (
    <Badge variant="secondary" className={map[status] ?? 'bg-white/10'}>
      {status === 'approved'
        ? 'Approved · awaiting update'
        : status === 'done'
          ? 'Applied'
          : status}
    </Badge>
  )
}

function VisitCard({
  appt,
  isPast,
  onChanged,
}: {
  appt: ClientAppointment
  isPast: boolean
  onChanged: () => void
}) {
  const [note, setNote] = useState(appt.client_note ?? '')
  const [editingNote, setEditingNote] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function saveNote() {
    setBusy('note')
    setError(null)
    try {
      const res = await fetch(`/api/client/visits/${appt.id}/note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      if (!res.ok) throw new Error('Failed to save note')
      setEditingNote(false)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  async function skip() {
    const reason = window.prompt(
      'Skip this visit? Optionally add a reason (e.g. building closed):',
      '',
    )
    if (reason === null) return // cancelled the prompt
    setBusy('skip')
    setError(null)
    try {
      const res = await fetch(`/api/client/visits/${appt.id}/skip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const d = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(d.error || 'Failed to skip visit')
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
      setBusy(null)
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 font-medium">
          <Clock className="h-3.5 w-3.5 text-emerald-400" />
          {formatTime(appt.start_time)} – {formatTime(appt.end_time)}
        </p>
        <Badge
          variant="secondary"
          className={
            isPast
              ? 'bg-slate-500/15 text-slate-300'
              : 'bg-emerald-500/15 text-emerald-300'
          }
        >
          {isPast ? 'past' : appt.status}
        </Badge>
      </div>
      {appt.template_label && (
        <p className="mt-1 text-sm text-slate-300">{appt.template_label}</p>
      )}
      {appt.line_items.length > 0 && (
        <ul className="mt-1 space-y-1.5">
          {appt.line_items.map((li) => (
            <li key={li.id} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="font-medium text-slate-300">
                  {li.name_snapshot}
                </span>
                <span className="shrink-0 text-slate-300">
                  {formatMoney(li.line_total)}
                </span>
              </div>
              {li.notes && (
                <span className="block text-slate-400">{li.notes}</span>
              )}
              <span className="block text-slate-500">
                {li.quantity.toLocaleString()} × {formatMoney(li.unit_price)}
              </span>
            </li>
          ))}
          {(() => {
            const total = appt.line_items.reduce(
              (sum, li) => sum + li.line_total,
              0,
            )
            if (total <= 0) return null
            return (
              <li className="flex justify-between border-t border-white/10 pt-1.5 text-xs font-semibold text-emerald-300">
                <span>Visit total</span>
                <span>{formatMoney(total)}</span>
              </li>
            )
          })()}
        </ul>
      )}

      {/* Area map — building diagram with the cleaning areas highlighted */}
      {(() => {
        const map = getFloorPlanMap(appt.recurring_template_id)
        if (!map) return null
        return (
          <div className="mt-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <MapPin className="h-3.5 w-3.5 text-emerald-400" />
              Area map — {map.label}
            </p>
            <div className="overflow-hidden rounded-lg border border-white/10">
              <Image
                src={`/maps/${map.file}`}
                alt={`Area map — ${map.label}`}
                width={1300}
                height={900}
                className="w-full"
              />
            </div>
          </div>
        )
      })()}

      {/* Note */}
      {editingNote ? (
        <div className="mt-2 space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for the crew (gate code, areas to focus, etc.)"
            className="border-white/15 bg-black/30 text-sm"
            rows={2}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={saveNote} disabled={busy === 'note'}>
              {busy === 'note' ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Save note
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setNote(appt.client_note ?? '')
                setEditingNote(false)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {appt.client_note ? (
            <p className="flex items-start gap-1.5 text-sm text-amber-200">
              <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {appt.client_note}
            </p>
          ) : null}
        </div>
      )}

      {!isPast && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!editingNote && (
            <Button
              size="sm"
              variant="outline"
              className="border-white/15 bg-transparent"
              onClick={() => setEditingNote(true)}
            >
              <StickyNote className="mr-1 h-3.5 w-3.5" />
              {appt.client_note ? 'Edit note' : 'Add note'}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="border-red-500/30 bg-transparent text-red-300 hover:bg-red-500/10"
            onClick={skip}
            disabled={busy === 'skip'}
          >
            {busy === 'skip' ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CircleSlash className="mr-1 h-3.5 w-3.5" />
            )}
            Skip this visit
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  )
}

function RequestForm({
  appointments,
  onSubmitted,
}: {
  appointments: ClientAppointment[]
  onSubmitted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<string>('reschedule')
  const [apptId, setApptId] = useState<string>('')
  const [message, setMessage] = useState('')
  const [details, setDetails] = useState({
    service: '',
    area: '',
    frequency: '',
    preferred_date: '',
    preferred_time: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const today = todayStr()
  const upcoming = appointments.filter((a) => a.appointment_date >= today)

  async function submit() {
    if (!message.trim()) {
      setError('Please describe what you need.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/client/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_type: type,
          message,
          details,
          appointment_id: apptId || undefined,
        }),
      })
      const d = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(d.error || 'Failed to submit')
      setDone(true)
      setMessage('')
      setDetails({
        service: '',
        area: '',
        frequency: '',
        preferred_date: '',
        preferred_time: '',
      })
      setApptId('')
      onSubmitted()
      setTimeout(() => {
        setDone(false)
        setOpen(false)
      }, 1800)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="border-white/10 bg-white/5 p-5 backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Request a change</h2>
          <p className="text-sm text-slate-400">
            Reschedules, extra visits, and scope changes go to Charles for
            approval — they won&apos;t change your schedule until he confirms.
          </p>
        </div>
        {!open && (
          <Button onClick={() => setOpen(true)}>
            <Send className="mr-1.5 h-4 w-4" />
            New request
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          <div>
            <Label className="text-slate-300">Type of request</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm"
            >
              {REQUEST_TYPES.map((t) => (
                <option key={t.value} value={t.value} className="bg-slate-900">
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {(type === 'reschedule' ||
            type === 'scope_change' ||
            type === 'skip_visit') &&
            upcoming.length > 0 && (
              <div>
                <Label className="text-slate-300">Which visit?</Label>
                <select
                  value={apptId}
                  onChange={(e) => setApptId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm"
                >
                  <option value="" className="bg-slate-900">
                    (optional) select a visit
                  </option>
                  {upcoming.map((a) => (
                    <option key={a.id} value={a.id} className="bg-slate-900">
                      {isoToDate(a.appointment_date).toLocaleDateString(
                        'en-US',
                        {
                          month: 'short',
                          day: 'numeric',
                        },
                      )}{' '}
                      · {formatTime(a.start_time)}
                      {a.template_label ? ` · ${a.template_label}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Service needed">
              <Input
                list="commercial-service-options"
                className={fieldClass}
                value={details.service}
                onChange={(e) =>
                  setDetails({ ...details, service: e.target.value })
                }
              />
              <datalist id="commercial-service-options">
                {[
                  'Carpet — hot water extraction',
                  'Carpet — low moisture maintenance',
                  'Tile and grout cleaning',
                  'Upholstery cleaning',
                  'Spot / stain treatment',
                  'Odor treatment',
                  'Floor protection',
                  'Furniture handling',
                ].map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Area / approximate measurements">
              <Input
                className={fieldClass}
                value={details.area}
                onChange={(e) =>
                  setDetails({ ...details, area: e.target.value })
                }
              />
            </Field>
            <Field label="Preferred date">
              <Input
                type="date"
                min={today}
                className={fieldClass}
                value={details.preferred_date}
                onChange={(e) =>
                  setDetails({ ...details, preferred_date: e.target.value })
                }
              />
            </Field>
            <Field label="Preferred time / access window">
              <Input
                className={fieldClass}
                value={details.preferred_time}
                onChange={(e) =>
                  setDetails({ ...details, preferred_time: e.target.value })
                }
              />
            </Field>
            <Field label="Frequency / season">
              <Input
                placeholder="One-time, monthly, winter only…"
                className={fieldClass}
                value={details.frequency}
                onChange={(e) =>
                  setDetails({ ...details, frequency: e.target.value })
                }
              />
            </Field>
          </div>
          <div>
            <Label className="text-slate-300">Details</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell Charles what you'd like changed…"
              className="mt-1 border-white/15 bg-black/30 text-sm"
              rows={3}
            />
          </div>

          {error && <p className="text-sm text-red-300">{error}</p>}
          {done && (
            <p className="text-sm text-emerald-300">
              Sent! Charles has been notified.
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={submit} disabled={busy || done}>
              {busy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : null}
              Submit request
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function TemplateDatesModal({
  template,
  appointments,
  today,
  onClose,
}: {
  template: ClientTemplate
  appointments: ClientAppointment[]
  today: string
  onClose: () => void
}) {
  const sorted = [...appointments].sort((a, b) =>
    a.appointment_date.localeCompare(b.appointment_date),
  )
  const upcomingCount = sorted.filter((a) => a.appointment_date >= today).length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur"
      onClick={onClose}
    >
      <Card
        className="flex max-h-[85vh] w-full max-w-lg flex-col border-white/10 bg-slate-900 p-0 text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
          <div>
            <h2 className="text-lg font-semibold">{template.label}</h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {template.schedule.map((s, i) => (
                <Badge
                  key={i}
                  variant="secondary"
                  className="bg-emerald-500/15 text-emerald-300"
                >
                  {s}
                </Badge>
              ))}
              {template.start_time && (
                <Badge
                  variant="secondary"
                  className="bg-white/10 text-slate-300"
                >
                  <Clock className="mr-1 h-3 w-3" />
                  {formatTime(template.start_time)}
                </Badge>
              )}
            </div>
            {template.lineItems.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {template.lineItems.map((li, i) => (
                  <li key={i} className="text-xs text-slate-400">
                    {li.name}
                    {li.notes ? ` — ${li.notes}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="shrink-0 px-2"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="overflow-y-auto p-5">
          <p className="mb-3 text-sm text-slate-400">
            {sorted.length} visit{sorted.length === 1 ? '' : 's'} on the
            calendar
            {upcomingCount > 0 ? ` · ${upcomingCount} upcoming` : ''}
          </p>
          {sorted.length === 0 ? (
            <p className="text-sm text-slate-400">No dates scheduled yet.</p>
          ) : (
            <ol className="space-y-1.5">
              {sorted.map((a) => {
                const isPast = a.appointment_date < today
                return (
                  <li
                    key={a.id}
                    className={[
                      'flex items-center justify-between rounded-md border px-3 py-2 text-sm',
                      isPast
                        ? 'border-white/5 bg-black/20 text-slate-500'
                        : 'border-emerald-500/20 bg-emerald-500/5 text-slate-200',
                    ].join(' ')}
                  >
                    <span className="flex items-center gap-2">
                      <CalendarDays
                        className={
                          isPast
                            ? 'h-3.5 w-3.5 text-slate-600'
                            : 'h-3.5 w-3.5 text-emerald-400'
                        }
                      />
                      {isoToDate(a.appointment_date).toLocaleDateString(
                        'en-US',
                        {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        },
                      )}
                    </span>
                    <span className="text-xs">{formatTime(a.start_time)}</span>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </Card>
    </div>
  )
}

function PasswordGate({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (pw.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (pw !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: updErr } = await supabase.auth.updateUser({ password: pw })
      if (updErr) throw new Error(updErr.message)
      await fetch('/api/client/password-flag', { method: 'POST' })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur">
      <Card className="w-full max-w-md border-white/10 bg-slate-900 p-6 text-slate-100">
        <h2 className="text-lg font-semibold">Set your password</h2>
        <p className="mt-1 text-sm text-slate-400">
          You&apos;re using a temporary password. Please choose a new one to
          continue.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <Label className="text-slate-300">New password</Label>
            <Input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="mt-1 border-white/15 bg-black/30"
            />
          </div>
          <div>
            <Label className="text-slate-300">Confirm password</Label>
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 border-white/15 bg-black/30"
            />
          </div>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Save and continue
          </Button>
        </div>
      </Card>
    </div>
  )
}
