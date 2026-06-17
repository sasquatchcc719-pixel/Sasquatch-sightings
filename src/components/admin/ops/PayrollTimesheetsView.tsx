'use client'

import { FormEvent, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import {
  getSemiMonthlyPayPeriod,
  mountainDateKey,
  mountainLocalDateTimeToIso,
  shiftSemiMonthlyPayPeriod,
} from '@/lib/ops/timesheet-pay'

type StaffRow = {
  id: string
  user_id: string | null
  display_name: string
  role: string
}

type TimesheetEntry = {
  id: string
  staffUserId: string
  staffDisplayName: string
  staffRole: string
  workDate: string
  startedAt: string
  endedAt: string
  breakMinutes: number
  payableMinutes: number
  hourlyRate: number
  grossPay: number
  gpsShiftId: string | null
  workType: string
  source: string
  status: string
  notes: string | null
  clockState: 'active' | 'on_break' | 'complete'
  breakStartedAt: string | null
}

type EntryFormState = {
  staffUserId: string
  startTime: string
  endTime: string
  breakMinutes: string
  hourlyRate: string
  workType: string
  notes: string
}

type EditFormState = EntryFormState & {
  workDate: string
  status: string
}

const DEFAULT_FORM: EntryFormState = {
  staffUserId: '',
  startTime: '08:00',
  endTime: '17:00',
  breakMinutes: '0',
  hourlyRate: '',
  workType: 'training',
  notes: '',
}

function fmtMin(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function fmtMoney(amount: number): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

function toIso(date: string, time: string): string {
  return mountainLocalDateTimeToIso(date, time) ?? new Date().toISOString()
}

function fmtInputTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'America/Denver',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function fetchStaff(): Promise<StaffRow[]> {
  const res = await fetch('/api/admin/ops/staff')
  if (!res.ok) throw new Error('Failed to load staff')
  const data = await res.json()
  return data.staff || []
}

async function fetchEntries(
  startDate: string,
  endDate: string,
  staffUserId: string,
): Promise<{
  entries: TimesheetEntry[]
  totalPayableMinutes: number
  totalGrossPay: number
}> {
  const params = new URLSearchParams({ startDate, endDate })
  if (staffUserId) params.set('staffUserId', staffUserId)

  const res = await fetch(
    `/api/admin/ops/payroll/timesheet-entries?${params.toString()}`,
  )
  if (!res.ok) throw new Error('Failed to load payroll timesheets')
  return res.json()
}

export function PayrollTimesheetsView() {
  const [date, setDate] = useState(() => mountainDateKey(new Date()))
  const [viewMode, setViewMode] = useState<'day' | 'period'>('day')
  const [periodAnchor, setPeriodAnchor] = useState(() =>
    mountainDateKey(new Date()),
  )
  const [staffFilter, setStaffFilter] = useState('')
  const [form, setForm] = useState<EntryFormState>(DEFAULT_FORM)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditFormState | null>(null)
  const [newWorkerName, setNewWorkerName] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const payPeriod = useMemo(
    () => getSemiMonthlyPayPeriod(periodAnchor),
    [periodAnchor],
  )

  const staffQuery = useQuery({
    queryKey: ['payroll-staff'],
    queryFn: fetchStaff,
  })

  const entriesQuery = useQuery({
    queryKey: [
      'payroll-timesheet-entries',
      viewMode,
      date,
      payPeriod.startDate,
      payPeriod.endDate,
      staffFilter,
    ],
    queryFn: () =>
      fetchEntries(
        viewMode === 'day' ? date : payPeriod.startDate,
        viewMode === 'day' ? date : payPeriod.endDate,
        staffFilter,
      ),
    refetchInterval: 60_000,
  })

  const staff = staffQuery.data || []
  const entries = useMemo(
    () => entriesQuery.data?.entries ?? [],
    [entriesQuery.data?.entries],
  )
  const totalPayableMinutes = entriesQuery.data?.totalPayableMinutes || 0
  const totalGrossPay = entriesQuery.data?.totalGrossPay || 0

  const totalsByStaff = useMemo(() => {
    const totals = new Map<
      string,
      { name: string; minutes: number; grossPay: number }
    >()
    for (const entry of entries) {
      const existing = totals.get(entry.staffUserId) || {
        name: entry.staffDisplayName,
        minutes: 0,
        grossPay: 0,
      }
      existing.minutes += entry.payableMinutes
      existing.grossPay += entry.grossPay
      totals.set(entry.staffUserId, existing)
    }
    return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [entries])

  function changeDate(offset: number) {
    if (viewMode === 'period') {
      setPeriodAnchor(
        shiftSemiMonthlyPayPeriod(periodAnchor, offset < 0 ? -1 : 1).startDate,
      )
      return
    }
    const d = new Date(date)
    d.setDate(d.getDate() + offset)
    setDate(d.toISOString().split('T')[0])
  }

  function startEditing(entry: TimesheetEntry) {
    setEditingEntryId(entry.id)
    setEditForm({
      staffUserId: entry.staffUserId,
      workDate: entry.workDate,
      startTime: fmtInputTime(entry.startedAt),
      endTime: fmtInputTime(entry.endedAt),
      breakMinutes: String(entry.breakMinutes),
      hourlyRate: entry.hourlyRate > 0 ? String(entry.hourlyRate) : '',
      workType: entry.workType,
      status: entry.status,
      notes: entry.notes || '',
    })
    setMessage(null)
  }

  function stopEditing() {
    setEditingEntryId(null)
    setEditForm(null)
  }

  function updateEditForm(field: keyof EditFormState, value: string) {
    setEditForm((current) =>
      current ? { ...current, [field]: value } : current,
    )
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingEntryId || !editForm) return

    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch(
        `/api/admin/ops/payroll/timesheet-entries/${editingEntryId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workDate: editForm.workDate,
            startedAt: toIso(editForm.workDate, editForm.startTime),
            endedAt: toIso(editForm.workDate, editForm.endTime),
            breakMinutes: Number(editForm.breakMinutes || 0),
            hourlyRate: Number(editForm.hourlyRate),
            workType: editForm.workType,
            status: editForm.status,
            notes: editForm.notes,
          }),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save entry')
      stopEditing()
      await entriesQuery.refetch()
      setMessage('Payroll time entry updated.')
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Failed to save entry',
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function addWorker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const displayName = newWorkerName.trim()
    if (!displayName) return

    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/ops/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, role: 'tech' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to add worker')

      await staffQuery.refetch()
      setNewWorkerName('')
      setForm((current) => ({
        ...current,
        staffUserId: data.staff?.id || current.staffUserId,
      }))
      setMessage(`${displayName} was added to the staff roster.`)
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Failed to add worker',
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.staffUserId) {
      setMessage('Choose a staff member before adding time.')
      return
    }

    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/ops/payroll/timesheet-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffUserId: form.staffUserId,
          workDate: date,
          startedAt: toIso(date, form.startTime),
          endedAt: toIso(date, form.endTime),
          breakMinutes: Number(form.breakMinutes || 0),
          hourlyRate: Number(form.hourlyRate),
          workType: form.workType,
          notes: form.notes,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to add time entry')

      await entriesQuery.refetch()
      setForm((current) => ({
        ...DEFAULT_FORM,
        staffUserId: current.staffUserId,
        hourlyRate: current.hourlyRate,
      }))
      setMessage('Payroll time entry added.')
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Failed to add time entry',
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function updateStatus(entry: TimesheetEntry, status: string) {
    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch(
        `/api/admin/ops/payroll/timesheet-entries/${entry.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to update entry')
      await entriesQuery.refetch()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update')
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteEntry(entry: TimesheetEntry) {
    if (!window.confirm('Delete this payroll time entry?')) return

    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch(
        `/api/admin/ops/payroll/timesheet-entries/${entry.id}`,
        { method: 'DELETE' },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to delete entry')
      if (editingEntryId === entry.id) stopEditing()
      await entriesQuery.refetch()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200">
        <strong>Payroll source of truth:</strong> These entries are payable
        time. Clock In/Out creates a draft entry here; GPS location details
        remain separate dispatch history.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-slate-900/50 p-1">
            <button
              type="button"
              onClick={() => setViewMode('day')}
              className={`rounded-md px-3 py-1 text-sm ${
                viewMode === 'day'
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Day
            </button>
            <button
              type="button"
              onClick={() => {
                setPeriodAnchor(date)
                setViewMode('period')
              }}
              className={`rounded-md px-3 py-1 text-sm ${
                viewMode === 'period'
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Pay period
            </button>
          </div>
          <button
            onClick={() => changeDate(-1)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
          >
            ‹ Prev
          </button>
          {viewMode === 'day' ? (
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-800/60 px-3 py-1.5 text-sm text-white"
            />
          ) : (
            <div className="rounded-lg border border-white/10 bg-slate-800/60 px-3 py-1.5 text-sm text-white">
              <span className="font-medium">{payPeriod.label}</span>
              <span className="ml-2 text-slate-400">
                {payPeriod.startDate} to {payPeriod.endDate}
              </span>
            </div>
          )}
          <button
            onClick={() => changeDate(1)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
          >
            Next ›
          </button>
        </div>

        <select
          value={staffFilter}
          onChange={(event) => setStaffFilter(event.target.value)}
          className="rounded-lg border border-white/10 bg-slate-800/60 px-3 py-1.5 text-sm text-white"
        >
          <option value="">All staff</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.display_name}
              {person.user_id ? '' : ' (no login)'}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <form
          onSubmit={addEntry}
          className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/50 p-4"
        >
          <div>
            <h3 className="font-semibold text-white">Add Time Entry</h3>
            <p className="text-sm text-slate-400">
              Use this for training, missed punches, admin time, and other
              payable work.
            </p>
          </div>

          <label className="block text-sm text-slate-300">
            Staff member
            <select
              value={form.staffUserId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  staffUserId: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
            >
              <option value="">Choose staff</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.display_name}
                  {person.user_id ? '' : ' (no login)'}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm text-slate-300">
              Start
              <input
                type="time"
                value={form.startTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    startTime: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
              />
            </label>
            <label className="block text-sm text-slate-300">
              End
              <input
                type="time"
                value={form.endTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    endTime: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Break min
              <input
                type="number"
                min="0"
                value={form.breakMinutes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    breakMinutes: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-300">
              Work type
              <select
                value={form.workType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    workType: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
              >
                <option value="training">Training</option>
                <option value="job">Job</option>
                <option value="admin">Admin</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="block text-sm text-slate-300">
              Hourly rate
              <div className="relative mt-1">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                  $
                </span>
                <input
                  type="number"
                  min="0.01"
                  max="1000"
                  step="0.01"
                  required
                  value={form.hourlyRate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      hourlyRate: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-slate-800/60 py-2 pr-3 pl-7 text-white"
                  placeholder="20.00"
                />
              </div>
            </label>
          </div>

          <label className="block text-sm text-slate-300">
            Notes
            <textarea
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              rows={3}
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
              placeholder="What did they do?"
            />
          </label>

          <button
            type="submit"
            disabled={isSaving || staffQuery.isLoading}
            className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add payable time
          </button>
        </form>

        <div className="space-y-4">
          <form
            onSubmit={addWorker}
            className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/50 p-4"
          >
            <div>
              <h3 className="font-semibold text-white">
                Add Worker Without Login
              </h3>
              <p className="text-sm text-slate-400">
                Add a trainee to the staff roster before software access is
                ready.
              </p>
            </div>
            <div className="flex gap-2">
              <input
                value={newWorkerName}
                onChange={(event) => setNewWorkerName(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
                placeholder="Worker name"
              />
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </form>

          <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm text-slate-400">Total payable time</p>
                <p className="mt-1 text-3xl font-bold text-white">
                  {fmtMin(totalPayableMinutes)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-400">Gross pay</p>
                <p className="mt-1 text-3xl font-bold text-emerald-300">
                  {fmtMoney(totalGrossPay)}
                </p>
              </div>
            </div>
            {totalsByStaff.length > 0 && (
              <div className="mt-4 space-y-2">
                {totalsByStaff.map((total) => (
                  <div
                    key={total.name}
                    className="flex justify-between text-sm text-slate-300"
                  >
                    <span>{total.name}</span>
                    <span className="font-mono">
                      {fmtMin(total.minutes)} · {fmtMoney(total.grossPay)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-slate-200">
          {message}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/10">
        <div className="border-b border-white/10 bg-slate-900/70 px-4 py-3">
          <h3 className="font-semibold text-white">
            {viewMode === 'day'
              ? `Entries for ${date}`
              : `Pay period: ${payPeriod.label} (${payPeriod.startDate} to ${payPeriod.endDate})`}
          </h3>
        </div>

        {entriesQuery.isLoading && (
          <div className="p-6 text-center text-slate-500">Loading…</div>
        )}

        {entriesQuery.error && (
          <div className="p-4 text-sm text-red-400">
            {entriesQuery.error instanceof Error
              ? entriesQuery.error.message
              : 'Failed to load payroll timesheets'}
          </div>
        )}

        {!entriesQuery.isLoading &&
          !entriesQuery.error &&
          entries.length === 0 && (
            <div className="p-6 text-center text-slate-500">
              No payable time entries for this range.
            </div>
          )}

        {entries.length > 0 && (
          <div className="divide-y divide-white/5">
            {entries.map((entry) => (
              <div key={entry.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-white">
                        {entry.staffDisplayName}
                      </p>
                      {entry.clockState !== 'complete' && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            entry.clockState === 'on_break'
                              ? 'bg-amber-500/15 text-amber-200'
                              : 'bg-emerald-500/15 text-emerald-200'
                          }`}
                        >
                          {entry.clockState === 'on_break'
                            ? 'On break'
                            : 'Clocked in'}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-400">
                      {viewMode === 'period' ? `${entry.workDate} · ` : ''}
                      {fmtTime(entry.startedAt)} →{' '}
                      {entry.clockState === 'complete'
                        ? fmtTime(entry.endedAt)
                        : 'Now'}
                      {entry.breakMinutes > 0
                        ? `, ${entry.breakMinutes}m break`
                        : ''}
                    </p>
                    {entry.notes && (
                      <p className="mt-1 text-sm text-slate-500">
                        {entry.notes}
                      </p>
                    )}
                    {entry.gpsShiftId && (
                      <p className="mt-1 text-xs font-medium text-blue-300">
                        Clock In/Out entry
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-mono text-lg font-semibold text-emerald-300">
                        {entry.hourlyRate > 0
                          ? fmtMoney(entry.grossPay)
                          : 'Rate needed'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {fmtMin(entry.payableMinutes)}
                        {entry.hourlyRate > 0
                          ? ` at ${fmtMoney(entry.hourlyRate)}/hr`
                          : ''}
                      </p>
                      <p className="text-xs text-slate-500 capitalize">
                        {entry.workType} ·{' '}
                        {entry.clockState === 'complete'
                          ? entry.status
                          : entry.clockState.replace('_', ' ')}
                      </p>
                    </div>

                    <select
                      value={entry.status}
                      onChange={(event) =>
                        updateStatus(entry, event.target.value)
                      }
                      disabled={
                        isSaving ||
                        entry.status === 'paid' ||
                        entry.hourlyRate <= 0 ||
                        entry.clockState !== 'complete'
                      }
                      title={
                        entry.clockState !== 'complete'
                          ? 'Clocked-in entries can be approved after clock out'
                          : entry.hourlyRate <= 0
                            ? 'Add an hourly rate before approving this entry'
                            : undefined
                      }
                      className="rounded-lg border border-white/10 bg-slate-800/60 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                    >
                      <option value="draft">Draft</option>
                      <option value="approved">Approved</option>
                      <option value="paid">Paid</option>
                    </select>

                    <button
                      onClick={() => startEditing(entry)}
                      disabled={
                        isSaving ||
                        entry.status === 'paid' ||
                        entry.clockState !== 'complete'
                      }
                      className="rounded-lg border border-blue-500/20 p-2 text-blue-300 hover:bg-blue-500/10 disabled:opacity-40"
                      title={
                        entry.clockState !== 'complete'
                          ? 'Clocked-in entries can be edited after clock out'
                          : 'Edit entry'
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </button>

                    <button
                      onClick={() => deleteEntry(entry)}
                      disabled={
                        isSaving ||
                        entry.status === 'paid' ||
                        entry.clockState !== 'complete'
                      }
                      className="rounded-lg border border-red-500/20 p-2 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                      title={
                        entry.clockState !== 'complete'
                          ? 'Clocked-in entries can be deleted after clock out'
                          : 'Delete entry'
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {editingEntryId === entry.id && editForm && (
                  <form
                    onSubmit={saveEntry}
                    className="mt-4 grid gap-3 rounded-xl border border-blue-500/20 bg-slate-950/40 p-4 sm:grid-cols-2 lg:grid-cols-4"
                  >
                    <label className="text-sm text-slate-300">
                      Work date
                      <input
                        type="date"
                        required
                        value={editForm.workDate}
                        onChange={(event) =>
                          updateEditForm('workDate', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
                      />
                    </label>
                    <label className="text-sm text-slate-300">
                      Start
                      <input
                        type="time"
                        required
                        value={editForm.startTime}
                        onChange={(event) =>
                          updateEditForm('startTime', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
                      />
                    </label>
                    <label className="text-sm text-slate-300">
                      End
                      <input
                        type="time"
                        required
                        value={editForm.endTime}
                        onChange={(event) =>
                          updateEditForm('endTime', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
                      />
                    </label>
                    <label className="text-sm text-slate-300">
                      Break min
                      <input
                        type="number"
                        min="0"
                        required
                        value={editForm.breakMinutes}
                        onChange={(event) =>
                          updateEditForm('breakMinutes', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
                      />
                    </label>
                    <label className="text-sm text-slate-300">
                      Work type
                      <select
                        value={editForm.workType}
                        onChange={(event) =>
                          updateEditForm('workType', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
                      >
                        <option value="training">Training</option>
                        <option value="job">Job</option>
                        <option value="admin">Admin</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="text-sm text-slate-300">
                      Hourly rate
                      <input
                        type="number"
                        min="0.01"
                        max="1000"
                        step="0.01"
                        required
                        value={editForm.hourlyRate}
                        onChange={(event) =>
                          updateEditForm('hourlyRate', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
                      />
                    </label>
                    <label className="text-sm text-slate-300">
                      Status
                      <select
                        value={editForm.status}
                        onChange={(event) =>
                          updateEditForm('status', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
                      >
                        <option value="draft">Draft</option>
                        <option value="approved">Approved</option>
                        <option value="paid">Paid</option>
                      </select>
                    </label>
                    <label className="text-sm text-slate-300 sm:col-span-2 lg:col-span-4">
                      Notes
                      <textarea
                        rows={2}
                        value={editForm.notes}
                        onChange={(event) =>
                          updateEditForm('notes', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-white"
                      />
                    </label>
                    <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                      <button
                        type="submit"
                        disabled={isSaving}
                        className="flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" />
                        Save changes
                      </button>
                      <button
                        type="button"
                        onClick={stopEditing}
                        disabled={isSaving}
                        className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5"
                      >
                        <X className="h-4 w-4" />
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
